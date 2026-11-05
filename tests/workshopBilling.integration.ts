import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import pg from "pg";
import { adminClient } from "../scripts/local-admin.js";
import { localDatabaseUrl } from "../server/localConfig.js";
import { createWorkshopBilling } from "../server/services/workshopBilling.js";

test("PostgreSQL: owner checkout reservation is priced and idempotent", async () => {
  const check = adminClient();
  await check.connect(); await check.end();
  const pool = new pg.Pool({
    connectionString: localDatabaseUrl(process.env.LOCAL_ADMIN_DATABASE_URL, true), ssl: false,
  });
  const tenant = randomUUID(), email = `owner-${tenant}@example.test`;
  try {
    await pool.query("INSERT INTO horse_power.tenants(id,name) VALUES($1,'Oficina Fictícia Pagamento')", [tenant]);
    await pool.query(`INSERT INTO platform_admin.workshops
      (tenant_id,source,name,responsible_name,responsible_email,status,plan_code,email_verified_at)
      VALUES($1,'admin','Oficina Fictícia Pagamento','Responsável Fictício',$2,'active','professional',now())`,
      [tenant,email]);
    await pool.query("UPDATE platform_admin.plan_prices SET monthly_price_cents=12990,price_version=1 WHERE plan_code='professional'");
    let calls = 0;
    const send = (async (_url: string | URL | Request, init?: RequestInit) => {
      calls++;
      const request = JSON.parse(String(init?.body));
      assert.equal(request.payer_email,email);
      assert.equal(request.auto_recurring.transaction_amount,129.9);
      assert.equal(request.status,"pending");
      const providerId = "provider-"+request.external_reference;
      return {ok:true,json:async()=>({
        id:providerId,status:"pending",
        init_point:`https://www.mercadopago.com.br/subscriptions/checkout?preapproval_id=${providerId}`,
      })} as Response;
    }) as typeof fetch;
    const billing = createWorkshopBilling(pool,{
      accessToken:"test-token",returnOrigin:"https://example.test",send,
    });
    await pool.query("UPDATE platform_admin.workshops SET status='trial',trial_started_at=now(),trial_ends_at=now()+interval '14 days' WHERE tenant_id=$1",[tenant]);
    assert.equal(await billing.offer(tenant),null);
    await assert.rejects(billing.startCheckout({
      tenantId:tenant,payerEmail:email,expectedPriceCents:12990,
    }),/indisponível/i);
    await pool.query("UPDATE platform_admin.workshops SET status='active' WHERE tenant_id=$1",[tenant]);
    const restricted = createWorkshopBilling(pool,{
      accessToken:"test-token",returnOrigin:"https://example.test",testTenantId:randomUUID(),send,
    });
    assert.equal(await restricted.offer(tenant),null);
    await assert.rejects(restricted.startCheckout({
      tenantId:tenant,payerEmail:email,expectedPriceCents:12990,
    }),/oficina de teste/);
    const offer = await billing.offer(tenant);
    assert.equal(offer?.monthlyPriceCents,12990);
    await assert.rejects(billing.startCheckout({
      tenantId:tenant,payerEmail:email,expectedPriceCents:12991,
    }),/preço mudou/i);
    const url = await billing.startCheckout({
      tenantId:tenant,payerEmail:email,expectedPriceCents:12990,
    });
    await pool.query("UPDATE platform_admin.plan_prices SET monthly_price_cents=13990,price_version=2 WHERE plan_code='professional'");
    assert.equal((await billing.offer(tenant))?.monthlyPriceCents,12990);
    assert.equal(await billing.startCheckout({
      tenantId:tenant,payerEmail:email,expectedPriceCents:12990,
    }),url);
    assert.equal(calls,1);
    const rows = await pool.query("SELECT count(*)::int AS total FROM platform_admin.billing_subscriptions WHERE tenant_id=$1",[tenant]);
    assert.equal(rows.rows[0].total,1);
  } finally {
    await pool.query("DELETE FROM platform_admin.billing_subscriptions WHERE tenant_id=$1",[tenant]).catch(()=>{});
    await pool.query("DELETE FROM platform_admin.workshops WHERE tenant_id=$1",[tenant]).catch(()=>{});
    await pool.query("DELETE FROM horse_power.tenants WHERE id=$1",[tenant]).catch(()=>{});
    await pool.query("UPDATE platform_admin.plan_prices SET monthly_price_cents=NULL,price_version=0 WHERE plan_code='professional'").catch(()=>{});
    await pool.end();
  }
});

test("PostgreSQL: Preview price applies only to the selected fictional workshop", async () => {
  const pool = new pg.Pool({
    connectionString: localDatabaseUrl(process.env.LOCAL_ADMIN_DATABASE_URL, true), ssl: false,
  });
  const tenant = randomUUID(), other = randomUUID();
  const email = `preview-${tenant}@example.test`;
  try {
    await pool.query("INSERT INTO horse_power.tenants(id,name) VALUES($1,'Oficina Fictícia Preview')", [tenant]);
    await pool.query("INSERT INTO horse_power.tenants(id,name) VALUES($1,'Outra Oficina Fictícia')", [other]);
    for (const id of [tenant, other]) await pool.query(`INSERT INTO platform_admin.workshops
      (tenant_id,source,name,responsible_name,responsible_email,status,plan_code,email_verified_at)
      VALUES($1,'admin','Oficina Fictícia Preview','Responsável Fictício',$2,'active','basic',now())`,
      [id,`preview-${id}@example.test`]);
    let calls = 0;
    const send = (async (_url: string | URL | Request, init?: RequestInit) => {
      calls++;
      const request = JSON.parse(String(init?.body));
      assert.equal(request.auto_recurring.transaction_amount, 1);
      return { ok: true, json: async () => ({
        id: "preview-"+request.external_reference, status: "pending",
        init_point: "https://www.mercadopago.com.br/subscriptions/checkout?preapproval_id=preview",
      }) } as Response;
    }) as typeof fetch;
    const billing = createWorkshopBilling(pool, {
      accessToken: "test-token", returnOrigin: "https://preview.example.test",
      testTenantId: tenant, testPriceCents: 100, send,
    });
    assert.equal((await billing.offer(tenant))?.monthlyPriceCents, 100);
    assert.equal(await billing.offer(other), null);
    await assert.rejects(billing.startCheckout({
      tenantId: other, payerEmail: email, expectedPriceCents: 100,
    }), /oficina de teste/);
    const url = await billing.startCheckout({
      tenantId: tenant, payerEmail: email, expectedPriceCents: 100,
    });
    assert.match(url, /^https:\/\/www\.mercadopago\.com\.br\//);
    assert.equal(calls, 1);
    const snapshot = await pool.query(`SELECT monthly_price_cents,price_version
      FROM platform_admin.billing_subscriptions WHERE tenant_id=$1`, [tenant]);
    assert.equal(snapshot.rows[0].monthly_price_cents, 100);
    assert.equal(snapshot.rows[0].price_version, 1);
  } finally {
    await pool.query("DELETE FROM platform_admin.billing_subscriptions WHERE tenant_id=$1", [tenant]).catch(()=>{});
    await pool.query("DELETE FROM platform_admin.workshops WHERE tenant_id=ANY($1::text[])", [[tenant,other]]).catch(()=>{});
    await pool.query("DELETE FROM horse_power.tenants WHERE id=ANY($1::text[])", [[tenant,other]]).catch(()=>{});
    await pool.end();
  }
});
