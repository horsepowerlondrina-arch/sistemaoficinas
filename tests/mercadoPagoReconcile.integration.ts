import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import pg from "pg";
import { adminClient } from "../scripts/local-admin.js";
import { localDatabaseUrl } from "../server/localConfig.js";
import { reconcileMercadoPagoInvoice } from "../server/services/mercadoPagoReconcile.js";

test("PostgreSQL: repeated and reversed invoice notifications stay isolated", async () => {
  const check = adminClient();
  await check.connect();
  await check.end();
  const pool = new pg.Pool({
    connectionString: localDatabaseUrl(process.env.LOCAL_ADMIN_DATABASE_URL, true),
    ssl: false,
  });
  const tenant = randomUUID(), subscription = randomUUID(), invoiceId = "101987654321";
  const amountCents = 12035;
  try {
    await pool.query("INSERT INTO horse_power.tenants(id,name) VALUES($1,'Oficina Fictícia Cobrança')", [tenant]);
    await pool.query(`INSERT INTO platform_admin.billing_subscriptions
      (id,tenant_id,plan_code,price_version,monthly_price_cents,provider_subscription_id,payment_mode)
      VALUES($1,$2,'professional',1,$3,$4,'card')`,
      [subscription,tenant,amountCents,"provider-"+subscription]);
    let status = "approved";
    const send = (async () => ({
      ok: true,
      json: async () => ({
        id: Number(invoiceId), preapproval_id: "provider-"+subscription,
        currency_id: "BRL", transaction_amount: "120.35",
        debit_date: "2026-11-05T11:12:25.892-03:00",
        payment: { id: 90987, status },
      }),
    } as Response)) as typeof fetch;
    const firstEvent = randomUUID();
    assert.equal(await reconcileMercadoPagoInvoice(pool, firstEvent, invoiceId, "test-token", send), "processed");
    assert.equal(await reconcileMercadoPagoInvoice(pool, firstEvent, invoiceId, "test-token", send), "processed");
    const paid = await pool.query("SELECT status,amount_cents FROM platform_admin.billing_invoices WHERE subscription_id=$1", [subscription]);
    assert.equal(paid.rowCount, 1);
    assert.equal(paid.rows[0].status, "approved");
    assert.equal(paid.rows[0].amount_cents, amountCents);
    status = "refunded";
    assert.equal(await reconcileMercadoPagoInvoice(pool, randomUUID(), invoiceId, "test-token", send), "processed");
    const reversed = await pool.query("SELECT status FROM platform_admin.billing_invoices WHERE subscription_id=$1", [subscription]);
    assert.equal(reversed.rowCount, 1);
    assert.equal(reversed.rows[0].status, "refunded");
    const snapshot = await pool.query("SELECT last_confirmed_paid_until FROM platform_admin.billing_subscriptions WHERE id=$1", [subscription]);
    assert.equal(snapshot.rows[0].last_confirmed_paid_until, null);
  } finally {
    await pool.query("DELETE FROM platform_admin.billing_webhook_events WHERE resource_id=$1", [invoiceId]).catch(() => {});
    await pool.query("DELETE FROM platform_admin.billing_invoices WHERE subscription_id=$1", [subscription]).catch(() => {});
    await pool.query("DELETE FROM platform_admin.billing_subscriptions WHERE id=$1", [subscription]).catch(() => {});
    await pool.query("DELETE FROM horse_power.tenants WHERE id=$1", [tenant]).catch(() => {});
    await pool.end();
  }
});
