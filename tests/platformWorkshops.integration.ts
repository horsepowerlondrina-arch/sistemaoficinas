import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { existsSync } from "node:fs";
import { adminClient } from "../scripts/local-admin.js";
import { platformAdminDatabaseUrl } from "../server/localConfig.js";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
if (existsSync(".env.platform-admin.local")) process.loadEnvFile(".env.platform-admin.local");

test("PostgreSQL: cadastro central tem escopo mínimo e estados não liberam dados operacionais", async () => {
  const url = platformAdminDatabaseUrl(process.env.PLATFORM_ADMIN_DATABASE_URL);
  const client = new pg.Client({ connectionString: url, ssl: false, connectionTimeoutMillis: 5000 });
  const owner = adminClient();
  const tenantId = randomUUID();
  await client.connect();
  await owner.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT platform_admin.create_workshop_admin($1,$2,$3,$4,$5,$6,$7)", [tenantId,"Oficina Teste Isolada","Responsável Fictício","adm-workshop@example.test","(43) 3333-0000","",null]);
    const initial = await client.query("SELECT * FROM platform_admin.workshop_directory('','all',10,0,$1)",[tenantId]);
    assert.equal(initial.rowCount,1);
    assert.equal(initial.rows[0].status,"pending_verification");
    assert.equal(initial.rows[0].responsible_email,"adm-workshop@example.test");
    await client.query("SAVEPOINT permission_check");
    await assert.rejects(client.query("SELECT id FROM horse_power.tenants WHERE id=$1",[tenantId]),{code:"42501"});
    await client.query("ROLLBACK TO SAVEPOINT permission_check");

    await client.query("SELECT platform_admin.set_workshop_status_admin($1,$2,$3,$4)",[tenantId,"blocked","Bloqueio fictício de teste",null]);
    const blocked = await client.query("SELECT status FROM platform_admin.workshop_directory('','all',10,0,$1)",[tenantId]);
    assert.equal(blocked.rows[0].status,"blocked");
    await client.query("ROLLBACK");

    await owner.query("BEGIN");
    await owner.query("SELECT platform_admin.create_workshop_admin($1,$2,$3,$4,$5,$6,$7)",[tenantId,"Oficina Teste Isolada","Responsável Fictício","adm-workshop@example.test","(43) 3333-0000","",null]);
    const operational = await owner.query(`SELECT
      (SELECT count(*) FROM horse_power.memberships WHERE tenant_id=$1)::int AS memberships,
      (SELECT count(*) FROM horse_power.customers WHERE tenant_id=$1)::int AS customers,
      (SELECT count(*) FROM horse_power.vehicles WHERE tenant_id=$1)::int AS vehicles,
      (SELECT count(*) FROM horse_power.orders WHERE tenant_id=$1)::int AS orders`,[tenantId]);
    assert.deepEqual(operational.rows[0],{memberships:0,customers:0,vehicles:0,orders:0});
    await owner.query("SET LOCAL ROLE hp_local_app");
    let state = await owner.query("SELECT horse_power.local_tenant_access_state($1) AS state",[tenantId]);
    assert.equal(state.rows[0].state,"pending_verification");
    await owner.query("RESET ROLE");
    await owner.query("SELECT platform_admin.set_workshop_status_admin($1,$2,$3,$4)",[tenantId,"blocked","Bloqueio fictício de teste",null]);
    await owner.query("SET LOCAL ROLE hp_local_app");
    state = await owner.query("SELECT horse_power.local_tenant_access_state($1) AS state",[tenantId]);
    assert.equal(state.rows[0].state,"blocked");
    await owner.query("ROLLBACK");
  } catch (error) {
    await client.query("ROLLBACK").catch(()=>{});
    throw error;
  } finally {
    await client.end();
    await owner.end();
  }
});
