import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { adminClient } from "../scripts/local-admin.js";

test("PostgreSQL: permissões administrativas por oficina, limites, período de teste e RLS", async () => {
  const client = adminClient();
  const tenantId = randomUUID();
  const otherTenantId = randomUUID();
  const ownerId = randomUUID();
  const secondUserId = randomUUID();
  const adminId = randomBytes(16).toString("hex");
  const sessionHash = randomBytes(32).toString("hex");
  const email = "adm16-" + tenantId + "@example.test";
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query("INSERT INTO horse_power.tenants(id,name) VALUES($1,$2),($3,$4)", [
      tenantId,"Oficina Fictícia Permissões",otherTenantId,"Oficina Fictícia Isolada",
    ]);
    await client.query("INSERT INTO horse_power.users(id,name,email,password_hash) VALUES($1,$2,$3,$4),($5,$6,$7,$8)", [
      ownerId,"Proprietário Fictício","owner-" + tenantId + "@example.test","fixture",
      secondUserId,"Usuário Fictício","user-" + tenantId + "@example.test","fixture",
    ]);
    await client.query("INSERT INTO horse_power.memberships(user_id,tenant_id,role) VALUES($1,$2,'owner')",[ownerId,tenantId]);
    const startedAt = new Date();
    const endAt = new Date(startedAt.getTime()+14*86400000);
    await client.query(
      "INSERT INTO platform_admin.workshops(tenant_id,source,name,responsible_name,responsible_email,status,email_verified_at,trial_started_at,trial_ends_at) " +
      "VALUES($1,'admin',$2,'Responsável Fictício',$3,'trial',now(),$4,$5)",
      [tenantId,"Oficina Fictícia Permissões",email,startedAt,endAt],
    );
    await client.query(
      "INSERT INTO platform_admin.administrators(id,email,display_name,role,permissions,password_hash,totp_secret_ciphertext,active,enrolled) " +
      "VALUES($1,$2,'Admin Fictício','principal','[\"workshops:manage\"]'::jsonb,'fixture-hash','fixture-totp-ciphertext',true,true)",
      [adminId,"admin-" + tenantId + "@example.test"],
    );
    await client.query("INSERT INTO platform_admin.sessions(token_hash,administrator_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",[sessionHash,adminId]);

    let state = (await client.query("SELECT platform_admin.workshop_entitlement_status($1) AS value",[tenantId])).rows[0].value;
    assert.equal(state.modules.orders,true);
    assert.equal(state.modules.finance,true);
    assert.equal(state.plan_configured,false);
    assert.equal(state.max_users,null);
    assert.equal(state.trial_days,14);
    assert.equal(state.user_count,1);

    await client.query("UPDATE platform_admin.plan_defaults SET configured=true,module_defaults='{\"finance\":false}'::jsonb,max_users=3,trial_days=7 WHERE plan_code='basic'");
    await client.query("UPDATE platform_admin.workshops SET plan_code='basic' WHERE tenant_id=$1",[tenantId]);
    state=(await client.query("SELECT platform_admin.workshop_entitlement_status($1) AS value",[tenantId])).rows[0].value;
    assert.equal(state.modules.finance,false);
    assert.equal(state.max_users,3);
    assert.equal(state.trial_days,7);

    await client.query("SELECT platform_admin.set_workshop_entitlements($1,$2,$3::jsonb,$4,$5,$6)",[
      tenantId,sessionHash,JSON.stringify({orders:false,finance:true}),1,5,"Exceção administrativa fictícia para teste",
    ]);
    state=(await client.query("SELECT platform_admin.workshop_entitlement_status($1) AS value",[tenantId])).rows[0].value;
    assert.equal(state.modules.orders,false);
    assert.equal(state.modules.finance,true);
    assert.equal(state.max_users,1);
    assert.equal(state.trial_days,5);
    const trial=(await client.query("SELECT status,extract(epoch FROM (trial_ends_at-trial_started_at))/86400 AS days FROM platform_admin.workshops WHERE tenant_id=$1",[tenantId])).rows[0];
    assert.equal(trial.status,"trial");
    assert.equal(Math.round(Number(trial.days)),5);

    await client.query("SAVEPOINT user_cap");
    await assert.rejects(
      client.query("INSERT INTO horse_power.memberships(user_id,tenant_id,role) VALUES($1,$2,'operator')",[secondUserId,tenantId]),
      {code:"23514"},
    );
    await client.query("ROLLBACK TO SAVEPOINT user_cap");
    assert.equal((await client.query("SELECT count(*)::int AS count FROM horse_power.memberships WHERE tenant_id=$1",[tenantId])).rows[0].count,1);

    await client.query("SAVEPOINT invalid_admin");
    await assert.rejects(
      client.query("SELECT platform_admin.set_workshop_entitlements($1,$2,'{}'::jsonb,NULL,NULL,$3)",[tenantId,"invalid-session-hash","Tentativa fictícia sem sessão"]),
      {code:"42501"},
    );
    await client.query("ROLLBACK TO SAVEPOINT invalid_admin");

    await client.query("SELECT set_config('app.tenant_id',$1,true),set_config('app.user_id',$2,true)",[tenantId,ownerId]);
    await client.query("SET LOCAL ROLE hp_local_app");
    let flags=(await client.query("SELECT horse_power.local_tenant_module_access($1) AS modules",[tenantId])).rows[0].modules;
    assert.equal(flags.orders,false);
    assert.equal(flags.finance,true);
    await client.query("SAVEPOINT cross_tenant");
    await assert.rejects(client.query("SELECT horse_power.local_tenant_module_access($1)",[otherTenantId]),{code:"42501"});
    await client.query("ROLLBACK TO SAVEPOINT cross_tenant");
    await client.query("RESET ROLE");

    const audit=await client.query(
      "SELECT action,technical_context->>'reason' AS reason FROM platform_admin.audit_events " +
      "WHERE subject_tenant_id=$1 AND action='admin.workshop.entitlements.updated' ORDER BY created_at",
      [tenantId],
    );
    assert.equal(audit.rowCount,1);
    assert.equal(audit.rows[0].reason,"Exceção administrativa fictícia para teste");

    await client.query("SELECT platform_admin.set_workshop_entitlements($1,$2,'{}'::jsonb,NULL,NULL,$3)",[
      tenantId,sessionHash,"Restaurar padrões fictícios para validação",
    ]);
    state=(await client.query("SELECT platform_admin.workshop_entitlement_status($1) AS value",[tenantId])).rows[0].value;
    assert.equal(state.modules.orders,true);
    assert.equal(state.modules.finance,false);
    assert.equal(state.max_users,3);
    assert.equal(state.trial_days,7);
    assert.deepEqual(state.module_overrides,{});
    const finalTrial=(await client.query("SELECT extract(epoch FROM (trial_ends_at-trial_started_at))/86400 AS days FROM platform_admin.workshops WHERE tenant_id=$1",[tenantId])).rows[0];
    assert.equal(Math.round(Number(finalTrial.days)),7);
    await client.query("ROLLBACK");
  } catch (error) {
    await client.query("ROLLBACK").catch(()=>{});
    throw error;
  } finally {
    await client.end();
  }
});
