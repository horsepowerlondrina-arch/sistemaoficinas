import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import pg from "pg";
import { localDatabaseUrl } from "../server/localConfig.js";
import { reconcileMercadoPagoSubscription } from "../server/services/mercadoPagoSubscription.js";

test("PostgreSQL: provider subscription state updates only its matching tenant", async () => {
  const pool = new pg.Pool({
    connectionString: localDatabaseUrl(process.env.LOCAL_ADMIN_DATABASE_URL, true), ssl: false,
  });
  const firstTenant = randomUUID(), secondTenant = randomUUID();
  const firstId = randomUUID(), secondId = randomUUID();
  const firstProvider = "provider-" + firstId, secondProvider = "provider-" + secondId;
  try {
    await pool.query("INSERT INTO horse_power.tenants(id,name) VALUES($1,'Oficina Fictícia 1'),($2,'Oficina Fictícia 2')", [firstTenant,secondTenant]);
    await pool.query(`INSERT INTO platform_admin.billing_subscriptions
      (id,tenant_id,plan_code,price_version,monthly_price_cents,provider_subscription_id)
      VALUES($1,$2,'professional',1,12035,$3),($4,$5,'premium',1,21000,$6)`,
      [firstId,firstTenant,firstProvider,secondId,secondTenant,secondProvider]);
    const payload = { id:firstProvider, external_reference:firstId, status:"authorized",
      payment_method_id:"visa", auto_recurring:{currency_id:"BRL",transaction_amount:"120.35"} };
    const send = (async () => ({ok:true,json:async()=>payload} as Response)) as typeof fetch;
    assert.equal(await reconcileMercadoPagoSubscription(pool,randomUUID(),firstProvider,"test-token",send),"processed");
    const states = await pool.query("SELECT tenant_id,provider_status,payment_mode FROM platform_admin.billing_subscriptions WHERE id IN ($1,$2) ORDER BY tenant_id", [firstId,secondId]);
    assert.equal(states.rows.find(row=>row.tenant_id===firstTenant)?.provider_status,"authorized");
    assert.equal(states.rows.find(row=>row.tenant_id===firstTenant)?.payment_mode,"card");
    assert.equal(states.rows.find(row=>row.tenant_id===secondTenant)?.provider_status,"pending");
    payload.external_reference = secondId;
    await assert.rejects(reconcileMercadoPagoSubscription(pool,randomUUID(),firstProvider,"test-token",send),
      /não corresponde ao contrato/);
    const unchanged = await pool.query("SELECT provider_status FROM platform_admin.billing_subscriptions WHERE id=$1", [firstId]);
    assert.equal(unchanged.rows[0].provider_status,"authorized");
  } finally {
    await pool.query("DELETE FROM platform_admin.billing_webhook_events WHERE resource_id=$1", [firstProvider]).catch(()=>{});
    await pool.query("DELETE FROM platform_admin.billing_subscriptions WHERE id IN ($1,$2)", [firstId,secondId]).catch(()=>{});
    await pool.query("DELETE FROM horse_power.tenants WHERE id IN ($1,$2)", [firstTenant,secondTenant]).catch(()=>{});
    await pool.end();
  }
});
