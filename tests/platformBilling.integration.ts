import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { adminClient } from "../scripts/local-admin.js";

test("PostgreSQL: prices are unset by default and subscriptions retain their contracted amount", async () => {
  const db = adminClient();
  await db.connect();
  try {
    await db.query("BEGIN");
    const plans = (await db.query("SELECT plan_code,monthly_price_cents,price_version FROM platform_admin.plan_prices ORDER BY plan_code")).rows;
    assert.deepEqual(plans.map(row => row.plan_code), ["basic","premium","professional"]);
    assert.ok(plans.every(row => row.monthly_price_cents === null && row.price_version === 0));
    const tenant = randomUUID(), subscription = randomUUID();
    await db.query("INSERT INTO horse_power.tenants(id,name) VALUES($1,'Oficina Fictícia Cobrança')", [tenant]);
    const user = randomUUID();
    await db.query("INSERT INTO horse_power.users(id,name,email,password_hash) VALUES($1,'Pessoa Fictícia',$2,'unused')",
      [user,`billing-${user}@example.test`]);
    await db.query("INSERT INTO horse_power.memberships(user_id,tenant_id,role) VALUES($1,$2,'owner')", [user,tenant]);
    await db.query("UPDATE platform_admin.plan_prices SET monthly_price_cents=10000,price_version=1 WHERE plan_code='basic'");
    await db.query(`INSERT INTO platform_admin.billing_subscriptions
      (id,tenant_id,plan_code,price_version,monthly_price_cents,payment_mode)
      VALUES($1,$2,'basic',1,10000,'card')`, [subscription,tenant]);
    await db.query("UPDATE platform_admin.plan_prices SET monthly_price_cents=12000,price_version=2 WHERE plan_code='basic'");
    const row = (await db.query("SELECT monthly_price_cents,price_version FROM platform_admin.billing_subscriptions WHERE id=$1",[subscription])).rows[0];
    assert.equal(row.monthly_price_cents,10000);
    assert.equal(row.price_version,1);
    await db.query("SAVEPOINT duplicate");
    await assert.rejects(db.query(`INSERT INTO platform_admin.billing_subscriptions
      (id,tenant_id,plan_code,price_version,monthly_price_cents,payment_mode)
      VALUES($1,$2,'basic',2,12000,'pix')`,[randomUUID(),tenant]),{code:"23505"});
    await db.query("ROLLBACK TO SAVEPOINT duplicate");
    const otherTenant = randomUUID();
    await db.query("INSERT INTO horse_power.tenants(id,name) VALUES($1,'Outra Oficina Fictícia')", [otherTenant]);
    await db.query("SAVEPOINT cross_tenant_invoice");
    await assert.rejects(db.query(`INSERT INTO platform_admin.billing_invoices
      (id,subscription_id,tenant_id,period_start,period_end,due_on,amount_cents,status)
      VALUES($1,$2,$3,'2026-11-01','2026-12-01','2026-11-10',10000,'pending')`,
      [randomUUID(),subscription,otherTenant]), {code:"23503"});
    await db.query("ROLLBACK TO SAVEPOINT cross_tenant_invoice");
    await db.query(`INSERT INTO platform_admin.billing_invoices
      (id,subscription_id,tenant_id,period_start,period_end,due_on,amount_cents,status)
      VALUES($1,$2,$3,'2026-11-01','2026-12-01','2026-11-10',10000,'pending')`,
      [randomUUID(),subscription,tenant]);
    await db.query("SELECT set_config('app.tenant_id',$1,true),set_config('app.user_id',$2,true)", [tenant,user]);
    const readOnly = async () => (await db.query(
      "SELECT horse_power.local_tenant_billing_read_only($1) AS value", [tenant],
    )).rows[0].value;
    assert.equal(await readOnly(), false);
    await db.query(`UPDATE platform_admin.billing_invoices
      SET due_on=(now() AT TIME ZONE 'America/Sao_Paulo')::date-1
      WHERE subscription_id=$1`, [subscription]);
    assert.equal(await readOnly(), true);
    await db.query("UPDATE platform_admin.billing_invoices SET status='approved' WHERE subscription_id=$1", [subscription]);
    assert.equal(await readOnly(), false);
    await db.query("SAVEPOINT other_tenant_access");
    await assert.rejects(db.query(
      "SELECT horse_power.local_tenant_billing_read_only($1)", [otherTenant],
    ), { code: "42501" });
    await db.query("ROLLBACK TO SAVEPOINT other_tenant_access");

  } finally {
    await db.query("ROLLBACK").catch(()=>{});
    await db.end();
  }
});
