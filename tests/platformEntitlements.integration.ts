import {lookupVehicleExternal} from "../server/services/vehicleLookup.js";
import type {DB} from "../server/db/database.js";
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
    await client.query("INSERT INTO horse_power.memberships(user_id,tenant_id,role) VALUES($1,$2,'owner'),($3,$4,'operator')",[ownerId,tenantId,secondUserId,otherTenantId]);
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
    assert.equal(state.modules.technical_catalog,true);
    assert.equal(state.plan_configured,false);
    assert.equal(state.max_users,null);
    assert.equal(state.trial_days,14);
    assert.equal(state.user_count,1);

    await client.query("UPDATE platform_admin.plan_defaults SET configured=true,module_defaults='{\"finance\":false,\"technical_catalog\":false}'::jsonb,max_users=3,trial_days=7 WHERE plan_code='basic'");
    await client.query("UPDATE platform_admin.workshops SET plan_code='basic' WHERE tenant_id=$1",[tenantId]);
    state=(await client.query("SELECT platform_admin.workshop_entitlement_status($1) AS value",[tenantId])).rows[0].value;
    assert.equal(state.modules.finance,false);
    assert.equal(state.modules.technical_catalog,false);
    assert.equal(state.max_users,3);
    assert.equal(state.trial_days,7);

    const rateCategory = (await client.query("SELECT id FROM horse_power.labor_categories ORDER BY sort_order,id LIMIT 1")).rows[0]?.id;
    if (rateCategory) await client.query("INSERT INTO horse_power.labor_commercial_rates(tenant_id,category_id,hourly_rate) VALUES($1,$2,13750) ON CONFLICT(tenant_id,category_id) DO UPDATE SET hourly_rate=EXCLUDED.hourly_rate",[tenantId,rateCategory]);
    const catalogModelsBefore = Number((await client.query("SELECT count(*)::int AS count FROM service_catalog.models")).rows[0].count);

    await client.query("SELECT platform_admin.set_workshop_entitlements($1,$2,$3::jsonb,$4,$5,$6)",[
      tenantId,sessionHash,JSON.stringify({orders:false,finance:true,technical_catalog:true}),1,5,"Liberar Catálogo Técnico para oficina fictícia",
    ]);
    state=(await client.query("SELECT platform_admin.workshop_entitlement_status($1) AS value",[tenantId])).rows[0].value;
    assert.equal(state.modules.orders,false);
    assert.equal(state.modules.finance,true);
    assert.equal(state.modules.technical_catalog,true, "a exceção administrativa libera o catálogo mesmo com padrão do plano desabilitado");
    assert.equal(state.max_users,1);
    assert.equal(state.trial_days,5);
    const trial=(await client.query("SELECT status,extract(epoch FROM (trial_ends_at-trial_started_at))/86400 AS days FROM platform_admin.workshops WHERE tenant_id=$1",[tenantId])).rows[0];
    assert.equal(trial.status,"trial");
    assert.equal(Math.round(Number(trial.days)),5);

    await client.query("SELECT platform_admin.set_workshop_entitlements($1,$2,$3::jsonb,$4,$5,$6)",[
      tenantId,sessionHash,JSON.stringify({orders:false,finance:true,technical_catalog:false}),1,5,"Bloquear Catálogo Técnico na oficina fictícia",
    ]);
    state=(await client.query("SELECT platform_admin.workshop_entitlement_status($1) AS value",[tenantId])).rows[0].value;
    assert.equal(state.modules.technical_catalog,false);
    const catalogModelsAfter = Number((await client.query("SELECT count(*)::int AS count FROM service_catalog.models")).rows[0].count);
    assert.equal(catalogModelsAfter,catalogModelsBefore,"alterar a permissão não altera o catálogo central");
    if (rateCategory) {
      const rate = await client.query("SELECT hourly_rate FROM horse_power.labor_commercial_rates WHERE tenant_id=$1 AND category_id=$2",[tenantId,rateCategory]);
      assert.equal(Number(rate.rows[0].hourly_rate),13750,"alterar a permissão preserva a tarifa da oficina");
    }

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
    assert.equal(flags.technical_catalog,false,"a permissão administrativa desabilitada chega ao backend operacional");
    await client.query("SAVEPOINT cross_tenant");
    await assert.rejects(client.query("SELECT horse_power.local_tenant_module_access($1)",[otherTenantId]),{code:"42501"});
    await client.query("ROLLBACK TO SAVEPOINT cross_tenant");
    await client.query("SELECT set_config('app.tenant_id',$1,true),set_config('app.user_id',$2,true)",[otherTenantId,secondUserId]);
    const otherFlags=(await client.query("SELECT horse_power.local_tenant_module_access($1) AS modules",[otherTenantId])).rows[0].modules;
    assert.equal(otherFlags.technical_catalog,true,"a alteração de uma oficina não afeta outra");
    await client.query("SELECT set_config('app.tenant_id',$1,true),set_config('app.user_id',$2,true)",[tenantId,ownerId]);
    await client.query("RESET ROLE");

    const audit=await client.query(
      "SELECT action,technical_context->>'reason' AS reason FROM platform_admin.audit_events " +
      "WHERE subject_tenant_id=$1 AND action='admin.workshop.entitlements.updated' ORDER BY created_at",
      [tenantId],
    );
    assert.equal(audit.rowCount,2);
    assert.ok(audit.rows.some((row: {reason:string}) => row.reason === "Liberar Catálogo Técnico para oficina fictícia"));
    assert.ok(audit.rows.some((row: {reason:string}) => row.reason === "Bloquear Catálogo Técnico na oficina fictícia"));

    await client.query("SELECT platform_admin.set_workshop_entitlements($1,$2,'{}'::jsonb,NULL,NULL,$3)",[
      tenantId,sessionHash,"Restaurar padrões fictícios para validação",
    ]);
    state=(await client.query("SELECT platform_admin.workshop_entitlement_status($1) AS value",[tenantId])).rows[0].value;
    assert.equal(state.modules.orders,true);
    assert.equal(state.modules.finance,false);
    assert.equal(state.modules.technical_catalog,false);
    assert.equal(state.max_users,3);
    assert.equal(state.trial_days,7);
    assert.deepEqual(state.module_overrides,{});
    const finalTrial=(await client.query("SELECT extract(epoch FROM (trial_ends_at-trial_started_at))/86400 AS days FROM platform_admin.workshops WHERE tenant_id=$1",[tenantId])).rows[0];
    assert.equal(Math.round(Number(finalTrial.days)),7);

    // ADM-002.2: the same audited entitlement mechanism controls plate queries.
    assert.equal(state.modules.external_plate_lookup,undefined,"ausência preserva autorização legada");
    const oldTokens=process.env.FIPEPLACA_TOKENS_JSON,oldAllowed=process.env.FIPEPLACA_ALLOWED_TENANT_IDS;
    const oldLegacy=process.env.PLACA_FIPE_TOKENS_JSON;
    process.env.FIPEPLACA_TOKENS_JSON=JSON.stringify({[tenantId]:"fictional-key-a",[otherTenantId]:"fictional-key-b"});
    process.env.FIPEPLACA_ALLOWED_TENANT_IDS=otherTenantId;
    delete process.env.PLACA_FIPE_TOKENS_JSON;
    const query=(sql:string,values:unknown[])=>{
      let i=0;return client.query(sql.replace(/\?/g,()=>"$"+(++i)),values);
    };
    const adapter:DB={
      exec:async(sql)=>{await client.query(sql);},
      prepare:(sql)=>({
        get:async(...values)=>(await query(sql,values)).rows[0],
        all:async(...values)=>(await query(sql,values)).rows,
        run:async(...values)=>({changes:(await query(sql,values)).rowCount||0}),
      }),
      getTenantModuleAccess:async(tenant)=>(await client.query("SELECT horse_power.local_tenant_module_access($1) AS modules",[tenant])).rows[0].modules,
    };
    let providerCalls=0;
    const provider=(async(url)=>{
      providerCalls++;return Response.json(String(url).endsWith("/fipe")?[]:{marca:"Marca Fictícia",modelo:"Modelo Fictício",anoFabricacao:2020,anoModelo:2021,cor:"Prata"});
    }) as typeof fetch;
    const lookup=async(tenant:string,user:string)=>{
      await client.query("SELECT set_config('app.tenant_id',$1,true),set_config('app.user_id',$2,true)",[tenant,user]);
      await client.query("SET LOCAL ROLE hp_local_app");
      try{return await lookupVehicleExternal(adapter,tenant,"ADM2A22",provider);}finally{await client.query("RESET ROLE");}
    };
    const setPlate=async(value:boolean|undefined)=>{
      await client.query("SELECT platform_admin.set_workshop_entitlements($1,$2,$3::jsonb,NULL,NULL,$4)",[
        tenantId,sessionHash,JSON.stringify(value===undefined?{}:{external_plate_lookup:value,technical_catalog:false}),
        "ADM-002.2 ajuste fictício de consulta externa",
      ]);
    };
    try{
      assert.equal((await lookup(tenantId,ownerId)).source,"unavailable");
      assert.equal(providerCalls,0);
      await setPlate(true);
      assert.equal((await lookup(tenantId,ownerId)).source,"external","liberação independente do catálogo");
      assert.equal(providerCalls,2);
      await setPlate(false);
      assert.equal((await lookup(tenantId,ownerId)).source,"unavailable","revogação bloqueia cache");
      assert.equal(providerCalls,2);
      assert.equal((await lookup(otherTenantId,secondUserId)).source,"external","outra oficina conserva acesso legado");
      assert.equal(providerCalls,4);
      await setPlate(undefined);
      assert.equal((await lookup(tenantId,ownerId)).source,"unavailable","restaurar não concede acesso");
      const plateAudit=await client.query("SELECT technical_context FROM platform_admin.audit_events WHERE subject_tenant_id=$1 AND technical_context->>'reason'=$2",[tenantId,"ADM-002.2 ajuste fictício de consulta externa"]);
      assert.equal(plateAudit.rowCount,3);
      assert.ok(plateAudit.rows.some(row=>row.technical_context.after.modules.external_plate_lookup===true));
      assert.ok(plateAudit.rows.some(row=>row.technical_context.after.modules.external_plate_lookup===false));
      assert.equal((await client.query("SELECT count(*)::int AS count FROM platform_admin.workshop_entitlements WHERE tenant_id=$1",[otherTenantId])).rows[0].count,0);
    }finally{
      for(const [key,value] of [["FIPEPLACA_TOKENS_JSON",oldTokens],["FIPEPLACA_ALLOWED_TENANT_IDS",oldAllowed],["PLACA_FIPE_TOKENS_JSON",oldLegacy]] as const){
        if(value===undefined)delete process.env[key];else process.env[key]=value;
      }
    }

    await client.query("ROLLBACK");
  } catch (error) {
    await client.query("ROLLBACK").catch(()=>{});
    throw error;
  } finally {
    await client.end();
  }
});
