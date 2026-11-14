import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import express from "express";
import { once } from "node:events";
import pg from "pg";
import { adminClient } from "../scripts/local-admin.js";
import { platformAdminDatabaseUrl } from "../server/localConfig.js";
import { createPlatformAdminApp } from "../server/platformAdminApp.js";
import { selfServiceRoutes } from "../server/selfServiceRoutes.js";
import { stripeBillingService, type StripeRequest } from "../server/services/stripeBilling.js";
import { createLocalDatabase } from "../server/db/local.js";
import { createUserInvite, acceptEmployeeInvite, userCapacity } from "../server/services/workshopUsers.js";
import { readUserAccess } from "../server/services/userAccess.js";
import { defaultWorkshopModules } from "../shared/workshopModules.js";
import type { Context } from "../server/auth/session.js";
import { digest } from "../server/auth/session.js";

test("three plans: registration, email activation, settled payment, seats and isolated user access on PostgreSQL17", async () => {
  const root = adminClient(); await root.connect();
  const pool = new pg.Pool({ connectionString: platformAdminDatabaseUrl(process.env.PLATFORM_ADMIN_DATABASE_URL), ssl: false });
  const db = await createLocalDatabase();
  const suffix = randomBytes(6).toString("hex"), plans = ["basic", "professional", "premium"] as const;
  const emails = plans.map(p => `${p}-${suffix}@testes.osdrive.com.br`), tokens = new Map<string, string>();
  const previousPlans = (await root.query("SELECT * FROM platform_admin.plan_defaults")).rows;
  for (const [plan, max] of [["basic",2],["professional",5],["premium",10]]) await root.query("UPDATE platform_admin.plan_defaults SET configured=true,max_users=$2 WHERE plan_code=$1", [plan,max]);
  const previous = { enabled: process.env.SELF_SERVICE_TEST_ENABLED, emails: process.env.SELF_SERVICE_TEST_EMAILS };
  process.env.SELF_SERVICE_TEST_ENABLED = "true"; process.env.SELF_SERVICE_TEST_EMAILS = emails.join(",");
  const app = express(); app.use(express.json());
  app.use(selfServiceRoutes(pool, async i => { tokens.set(i.email, i.token); return { tokenHash: digest(i.token) }; }));
  app.use(createPlatformAdminApp(pool, "a".repeat(64)));
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const post = (path: string, body: unknown) => fetch(`http://127.0.0.1:${address.port}` + path, { method: "POST", headers: { Origin: "http://127.0.0.1:5173", "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const resources = new Map<string, any>();
  const transport: StripeRequest = async (path, input) => {
    if (path === "/checkout/sessions" && input) {
      const id = "cs_test_" + String(input.client_reference_id).replaceAll("-", "");
      const r = { id, livemode: false, url: "https://checkout.stripe.com/c/" + id, customer: "cus_" + id, client_reference_id: input.client_reference_id, status: "open", payment_status: "unpaid", amount_total: (input.line_items as any)[0].price_data.unit_amount, currency: "brl" };
      resources.set(path + "/" + id, r); return r;
    }
    assert.ok(resources.has(path), "unexpected mock provider resource"); return resources.get(path);
  };
  const billing = stripeBillingService(pool, transport, "http://127.0.0.1:5173", [], emails);
  const offices: string[] = [];
  try {
    for (let i = 0; i < plans.length; i++) {
      const plan = plans[i], email = emails[i];
      const registration = await post("/admin-api/workshop-registration", { workshop: { name: `Oficina Fictícia ${plan}`, responsible_name: "Master Fictício", responsible_email: email }, plan_code: plan });
      assert.equal(registration.status, 202); assert.ok(tokens.has(email));
      const token = tokens.get(email)!;
      const pending = (await root.query("SELECT tenant_id,status,email_verified_at FROM platform_admin.workshops WHERE responsible_email=$1", [email])).rows[0];
      offices.push(pending.tenant_id); assert.equal(pending.status, "pending_verification"); assert.equal(pending.email_verified_at, null);
      await assert.rejects(billing.summary(pending.tenant_id), /não está autorizada/);
      const preview = await post("/admin-api/workshop-activation/validate", { token }); assert.equal(preview.status, 200);
      assert.equal(JSON.stringify(await preview.json()).includes(email), false);
      const activation = await post("/admin-api/workshop-activation/complete", { token, password: randomBytes(24).toString("base64url") });
      assert.equal(activation.status, 200); assert.ok(activation.headers.get("set-cookie")?.includes("HttpOnly"));
      assert.equal((await post("/admin-api/workshop-activation/complete", { token, password: "Fictitious-Replay-Only" })).status, 400);
      const owner = (await root.query("SELECT user_id FROM horse_power.memberships WHERE tenant_id=$1", [pending.tenant_id])).rows[0].user_id;
      assert.equal((await billing.summary(pending.tenant_id)).can_subscribe_during_trial, true);
      const priceId = randomUUID(), amount = [9900, 19900, 29900][i];
      await root.query("INSERT INTO platform_admin.stripe_prices(id,plan_code,amount_cents,active,reason) VALUES($1,$2,$3,false,'Isolated test fixture')", [priceId, plan, amount]);
      // Existing offers stay unchanged. This private synthetic offer is enabled only while selecting it.
      const old = (await root.query("SELECT id FROM platform_admin.stripe_prices WHERE plan_code=$1 AND active", [plan])).rows;
      await root.query("UPDATE platform_admin.stripe_prices SET active=false WHERE plan_code=$1 AND active", [plan]);
      await root.query("UPDATE platform_admin.stripe_prices SET active=true WHERE id=$1", [priceId]);
      let checkout;
      try { checkout = await billing.checkout(pending.tenant_id, email, { price_id: priceId, method: "pix" }); }
      finally {
        await root.query("UPDATE platform_admin.stripe_prices SET active=false WHERE id=$1", [priceId]);
        for (const row of old) await root.query("UPDATE platform_admin.stripe_prices SET active=true WHERE id=$1", [row.id]);
      }
      assert.match(checkout.url, /^https:\/\/checkout.stripe.com\//);
      const cs = [...resources.values()].find(v => v.url === checkout.url);
      assert.equal((await billing.summary(pending.tenant_id)).payments.length, 0);
      const pi = "pi_" + cs.id;
      Object.assign(cs, { status: "complete", payment_status: "paid", payment_intent: pi });
      resources.set(`/payment_intents/${pi}?expand[]=latest_charge`, { id: pi, livemode: false, customer: cs.customer, status: "succeeded", amount_received: amount, currency: "brl", latest_charge: { amount_refunded: 0, disputed: false } });
      await billing.syncSession(cs.id); await billing.syncSession(cs.id);
      const paid = await billing.summary(pending.tenant_id);
      assert.equal(paid.payments.length, 1); assert.equal(paid.payments[0].status, "paid"); assert.equal(paid.account.plan_code, plan);
      assert.equal((await root.query("SELECT horse_power.local_tenant_access_state($1) s", [pending.tenant_id])).rows[0].s, "active");
      const entitlements = (await root.query("SELECT platform_admin.effective_workshop_entitlements($1) v", [pending.tenant_id])).rows[0].v;
      assert.equal(entitlements.effective_plan_code, plan); assert.equal(entitlements.trial_active, false);
      const limit = Number(entitlements.max_users); assert.ok(limit >= 2 && limit <= 10);
      const settings = { "app.tenant_id": pending.tenant_id, "app.user_id": owner };
      let invite = "";
      for (let slot = 1; slot < limit; slot++) {
        await db.withRequestContext!(settings, async () => {
          const ctx: Context = { tenantId: pending.tenant_id, userId: owner, role: "owner", modules: { ...defaultWorkshopModules } };
          ctx.access = await readUserAccess(db, ctx);
          await createUserInvite(db, ctx, { email: `${plan}-${suffix}-${slot}@testes.osdrive.com.br`, profile: "mechanic", order_scope: "assigned" }, "", async v => { invite = v.token; });
        });
        await acceptEmployeeInvite(db, invite, "", { name: "Mecânico Fictício", password: randomBytes(24).toString("base64url") });
      }
      await db.withRequestContext!(settings, async () => {
        const ctx: Context = { tenantId: pending.tenant_id, userId: owner, role: "owner", modules: { ...defaultWorkshopModules } };
        const cap = await userCapacity(db, ctx); assert.equal(cap.active, limit); assert.equal(cap.available, 0);
        await assert.rejects(createUserInvite(db, ctx, { email: `excess-${suffix}@testes.osdrive.com.br`, profile: "mechanic" }, "", async () => {}));
        if (offices.length > 1) assert.equal((await db.prepare("SELECT * FROM tenants WHERE id=?").all(offices[0])).length, 0);
      });
    }
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve())); await db.close(); await pool.end();
    for (const p of previousPlans) await root.query("UPDATE platform_admin.plan_defaults SET configured=$2,max_users=$3 WHERE plan_code=$1",[p.plan_code,p.configured,p.max_users]);
    await root.end();
    for (const [key, value] of [["SELF_SERVICE_TEST_ENABLED", previous.enabled], ["SELF_SERVICE_TEST_EMAILS", previous.emails]]) if (value === undefined) delete process.env[key!]; else process.env[key!] = value;
  }
});
