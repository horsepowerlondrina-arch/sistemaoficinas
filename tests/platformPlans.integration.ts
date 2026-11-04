import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { adminClient } from "../scripts/local-admin.js";
import { applyWorkshopAccess } from "../server/services/workshopPlanAccess.js";
import { tenantAccessDecision } from "../server/auth/tenantAccess.js";

test("PostgreSQL: planos, teste Premium, exceções, limites e isolamento", async () => {
  const db = adminClient();
  const tenant = randomUUID(), other = randomUUID();
  const users = Array.from({ length: 4 }, () => randomUUID());
  const admin = randomBytes(16).toString("hex"), token = randomBytes(32).toString("hex");
  await db.connect();
  try {
    await db.query("BEGIN");
    await db.query("INSERT INTO horse_power.tenants(id,name) VALUES($1,'Oficina Fictícia Planos'),($2,'Outra Oficina Fictícia')", [tenant, other]);
    for (const [index, user] of users.entries()) {
      await db.query("INSERT INTO horse_power.users(id,name,email,password_hash) VALUES($1,$2,$3,'fixture')",
        [user,`Usuário Fictício ${index}`,`plan-${index}-${tenant}@example.test`]);
    }
    await db.query("INSERT INTO horse_power.memberships(user_id,tenant_id,role) VALUES($1,$2,'owner')", [users[0], tenant]);
    await db.query("INSERT INTO platform_admin.workshops(tenant_id,source,name,responsible_name,responsible_email,status,email_verified_at) VALUES($1,'admin','Oficina Fictícia Planos','Responsável Fictício',$2,'active',now())",
      [tenant,`plans-${tenant}@example.test`]);
    await db.query("INSERT INTO platform_admin.administrators(id,email,display_name,role,permissions,password_hash,totp_secret_ciphertext,active,enrolled) VALUES($1,$2,'Admin Fictício','principal','[\"workshops:manage\"]'::jsonb,'fixture','fixture',true,true)",
      [admin,`admin-plans-${tenant}@example.test`]);
    await db.query("INSERT INTO platform_admin.sessions(token_hash,administrator_id,expires_at) VALUES($1,$2,now()+interval '1 hour')", [token,admin]);
    const status = async () => (await db.query("SELECT platform_admin.workshop_entitlement_status($1) AS entitlements",[tenant])).rows[0].entitlements;
    const assign = async (plan: string) => (await db.query("SELECT platform_admin.set_workshop_plan($1,$2,$3,$4) AS entitlements",
      [tenant,token,plan,`Atribuir plano ${plan} à oficina fictícia`])).rows[0].entitlements;

    await db.query("SAVEPOINT invalid_plan");
    await assert.rejects(assign("enterprise"),{code:"22023"});
    await db.query("ROLLBACK TO SAVEPOINT invalid_plan");
    await db.query("SAVEPOINT invalid_session");
    await assert.rejects(db.query("SELECT platform_admin.set_workshop_plan($1,$2,'basic',$3)",
      [tenant,"invalid-session","Alteração fictícia não autorizada"]),{code:"42501"});
    await db.query("ROLLBACK TO SAVEPOINT invalid_session");

    let state = await status();
    assert.equal(state.max_users,null,"oficina existente não recebe limite antes da atribuição");
    assert.equal(state.modules.finance,true,"acesso legado é preservado");
    state = await assign("basic");
    const visibleBrands = async () => {
      await db.query("SELECT set_config('app.tenant_id',$1,true),set_config('app.user_id',$2,true)",[tenant,users[0]]);
      await db.query("SET LOCAL ROLE hp_local_app");
      const count=(await db.query("SELECT count(*)::int AS total FROM service_catalog.brands")).rows[0].total as number;
      await db.query("RESET ROLE");
      return count;
    };
    assert.equal(await visibleBrands(),0,"Básico não pode ler marcas do catálogo");
    await db.query("INSERT INTO service_catalog.tenant_access(tenant_id,enabled,grant_reason) VALUES($1,true,'Licença legada fictícia')",[tenant]);
    assert.equal(await visibleBrands(),0,"licença legada não libera catálogo no Básico");
    await db.query("DELETE FROM service_catalog.tenant_access WHERE tenant_id=$1",[tenant]);
    assert.equal(state.plan_code,"basic");
    assert.equal(state.max_users,2);
    assert.equal(state.modules.orders,true);
    assert.equal(state.modules.catalog,true);
    assert.equal(state.modules.finance,false);
    assert.equal(state.modules.inventory,false);
    assert.equal(state.modules.external_plate_lookup,false);
    assert.equal(state.modules.technical_catalog,false);
    state = await assign("professional");
    assert.equal(state.max_users,5);
    assert.equal(state.modules.finance,true);
    assert.equal(state.modules.inventory,true);
    assert.equal(state.modules.suppliers,true);
    assert.equal(state.modules.external_plate_lookup,true);
    assert.equal(state.modules.technical_catalog,false);
    state = await assign("premium");
    assert.equal(state.max_users,10);
    assert.equal(state.modules.technical_catalog,true);
    assert.equal((await db.query("SELECT count(*)::int AS total FROM service_catalog.tenant_access WHERE tenant_id=$1",[tenant])).rows[0].total,0);
    assert.ok(await visibleBrands()>0,"Premium lê marcas sem licença separada");
    await db.query("SELECT set_config('app.tenant_id',$1,true),set_config('app.user_id',$2,true)",[tenant,users[0]]);
    await db.query("SET LOCAL ROLE hp_local_app");
    assert.equal((await db.query("SELECT horse_power.local_tenant_catalog_included($1) AS included",[tenant])).rows[0].included,true);
    await db.query("SAVEPOINT catalog_cross_tenant");
    await assert.rejects(db.query("SELECT horse_power.local_tenant_catalog_included($1)",[other]),{code:"42501"});
    await db.query("ROLLBACK TO SAVEPOINT catalog_cross_tenant");
    await db.query("RESET ROLE");

    const expiration = new Date(Date.now()+3600000).toISOString();
    state=(await db.query("SELECT platform_admin.set_workshop_entitlements($1,$2,$3::jsonb,NULL,NULL,$4,$5::jsonb) AS entitlements",
      [tenant,token,JSON.stringify({finance:false}),"Bloquear financeiro temporariamente na oficina fictícia",JSON.stringify({finance:expiration})])).rows[0].entitlements;
    assert.equal(state.modules.finance,false);
    assert.equal(state.override_expires_at.finance,expiration);
    await db.query("UPDATE platform_admin.workshop_entitlements SET override_expires_at=jsonb_build_object('finance',(now()-interval '1 minute')::text) WHERE tenant_id=$1",[tenant]);
    state=await status();
    assert.equal(state.modules.finance,true,"exceção vencida não afeta acesso efetivo");

    await db.query("INSERT INTO horse_power.memberships(user_id,tenant_id,role) VALUES($1,$2,'operator'),($3,$2,'operator')",[users[1],tenant,users[2]]);
    state=await assign("basic");
    assert.equal(state.user_count,3,"downgrade não remove usuários");
    assert.equal(state.max_users,2);
    await db.query("SAVEPOINT cap");
    await assert.rejects(db.query("INSERT INTO horse_power.memberships(user_id,tenant_id,role) VALUES($1,$2,'operator')",[users[3],tenant]),{code:"23514"});
    await db.query("ROLLBACK TO SAVEPOINT cap");

    await db.query("UPDATE platform_admin.workshops SET status='trial',trial_started_at=now(),trial_ends_at=now()+interval '14 days' WHERE tenant_id=$1",[tenant]);
    state=await status();
    assert.equal(state.plan_code,"basic");
    assert.equal(state.effective_plan_code,"premium");
    assert.equal(state.max_users,10);
    assert.equal(state.modules.technical_catalog,true);
    assert.ok(await visibleBrands()>0,"teste Premium lê marcas");
    await db.query("UPDATE platform_admin.workshops SET trial_started_at=now()-interval '15 days' WHERE tenant_id=$1",[tenant]);
    state=await status();
    assert.equal(state.trial_active,false);
    assert.equal(state.effective_plan_code,"basic");
    assert.equal(state.modules.technical_catalog,false);
    assert.equal(await visibleBrands(),0,"teste expirado não lê marcas");

    await db.query("SELECT set_config('app.tenant_id',$1,true),set_config('app.user_id',$2,true)",[tenant,users[0]]);
    await db.query("SET LOCAL ROLE hp_local_app");
    const own=(await db.query("SELECT horse_power.local_tenant_module_access($1) AS modules",[tenant])).rows[0].modules;
    assert.equal(own.finance,false);
    await db.query("SAVEPOINT other_tenant");
    await assert.rejects(db.query("SELECT horse_power.local_tenant_module_access($1)",[other]),{code:"42501"});
    await db.query("ROLLBACK TO SAVEPOINT other_tenant");
    await db.query("RESET ROLE");
    const untouched=(await db.query("SELECT platform_admin.workshop_entitlement_status($1) AS entitlements",[other])).rows[0].entitlements;
    assert.equal(untouched.max_users,null);
    assert.equal(untouched.modules.finance,true);
    const audit=(await db.query("SELECT count(*)::int AS total FROM platform_admin.audit_events WHERE subject_tenant_id=$1 AND action='admin.workshop.plan_changed'",[tenant])).rows[0].total;
    assert.equal(audit,4);
    await db.query("ROLLBACK");
  } catch (error) {
    await db.query("ROLLBACK").catch(()=>{});
    throw error;
  } finally { await db.end(); }
});

test("PostgreSQL: um seletor aplica o pacote, remove exceções e preserva outra oficina", async () => {
  const db = adminClient(), tenant = randomUUID(), other = randomUUID();
  const admin = randomUUID(), token = randomBytes(32).toString("hex");
  const reason = "Definir o acesso da oficina fictícia por pacote";
  await db.connect();
  try {
    await db.query("BEGIN");
    await db.query("INSERT INTO horse_power.tenants(id,name) VALUES($1,'Oficina de Teste A'),($2,'Oficina de Teste B')", [tenant,other]);
    await db.query(`INSERT INTO platform_admin.workshops(tenant_id,source,name,responsible_name,responsible_email,status,email_verified_at)
      VALUES($1,'admin','Oficina de Teste A','Responsável Fictício',$3,'active',now()),
            ($2,'admin','Oficina de Teste B','Responsável Fictício',$4,'active',now())`,
      [tenant,other,`selector-${tenant}@example.test`,`selector-${other}@example.test`]);
    await db.query(`INSERT INTO platform_admin.administrators(id,email,display_name,role,permissions,password_hash,totp_secret_ciphertext,active,enrolled)
      VALUES($1,$2,'Admin Fictício','principal','["workshops:manage"]'::jsonb,'fixture','fixture',true,true)`,
      [admin,`selector-admin-${tenant}@example.test`]);
    await db.query("INSERT INTO platform_admin.sessions(token_hash,administrator_id,expires_at) VALUES($1,$2,now()+interval '1 hour')", [token,admin]);
    await db.query("SELECT platform_admin.set_workshop_entitlements($1,$2,$3::jsonb,NULL,NULL,$4,$5::jsonb)",
      [tenant,token,JSON.stringify({finance:true}),reason,JSON.stringify({})]);

    // Exercise the actual restricted runtime role: it cannot lock workshop rows with FOR UPDATE.
    await db.query("SET LOCAL ROLE hp_platform_admin_app");
    let result = await applyWorkshopAccess(db,tenant,token,"basic",reason);
    await db.query("RESET ROLE");
    assert.equal(result.status,"active");
    assert.equal(result.entitlements.plan_code,"basic");
    assert.equal((result.entitlements.modules as Record<string,boolean>).finance,false);
    assert.deepEqual(result.entitlements.module_overrides,{});
    assert.equal(result.entitlements.max_users,2);

    result = await applyWorkshopAccess(db,tenant,token,"premium",reason);
    assert.equal((result.entitlements.modules as Record<string,boolean>).technical_catalog,true);
    assert.equal(result.entitlements.max_users,10);

    result = await applyWorkshopAccess(db,tenant,token,"none",reason);
    assert.equal(result.status,"read_only");
    assert.equal(tenantAccessDecision(result.status,"POST","/orders"),"read_only");
    assert.equal(tenantAccessDecision(result.status,"GET","/orders"),"allow");

    result = await applyWorkshopAccess(db,tenant,token,"professional",reason);
    assert.equal(result.status,"active");
    assert.equal(result.entitlements.plan_code,"professional");
    assert.equal((result.entitlements.modules as Record<string,boolean>).finance,true);
    assert.equal((result.entitlements.modules as Record<string,boolean>).technical_catalog,false);
    assert.equal((await db.query("SELECT status FROM platform_admin.workshops WHERE tenant_id=$1",[other])).rows[0].status,"active");
    assert.equal((await db.query("SELECT plan_code FROM platform_admin.workshops WHERE tenant_id=$1",[other])).rows[0].plan_code,null);

    await db.query("SAVEPOINT forbidden");
    await assert.rejects(applyWorkshopAccess(db,tenant,"invalid-session","premium",reason),{code:"42501"});
    await db.query("ROLLBACK TO SAVEPOINT forbidden");
    assert.equal((await db.query("SELECT count(*)::int AS total FROM platform_admin.audit_events WHERE subject_tenant_id=$1 AND action='admin.workshop.plan_changed'",[tenant])).rows[0].total,3);
    await db.query("ROLLBACK");
  } catch (error) {
    await db.query("ROLLBACK").catch(()=>{});
    throw error;
  } finally { await db.end(); }
});
