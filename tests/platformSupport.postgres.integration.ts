import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { adminClient } from "../scripts/local-admin.js";
import { localDatabaseUrl, platformAdminDatabaseUrl } from "../server/localConfig.js";
import { createPlatformAdminApp } from "../server/platformAdminApp.js";
import { digestAdminToken, encryptTotpSecret, hashAdminPassword, newTotpSecret } from "../server/auth/platformAdmin.js";

test("PostgreSQL: chamados isolados por oficina, permissões administrativas e auditoria",async()=>{
  const owner=adminClient(),app=new pg.Client({connectionString:localDatabaseUrl(process.env.LOCAL_DATABASE_URL),ssl:false});
  const adminPool=new pg.Pool({connectionString:platformAdminDatabaseUrl(process.env.PLATFORM_ADMIN_DATABASE_URL),ssl:false});
  const a=randomUUID(),b=randomUUID(),userA=randomUUID(),userB=randomUUID(),ticket=randomUUID(),adminId=randomUUID(),token=randomUUID();
  let server:ReturnType<ReturnType<typeof createPlatformAdminApp>["listen"]>|undefined;
  await owner.connect();await app.connect();
  try{
    await owner.query("INSERT INTO horse_power.tenants(id,name) VALUES($1,'Oficina Suporte A'),($2,'Oficina Suporte B')",[a,b]);
    await owner.query("INSERT INTO horse_power.users(id,name,email,password_hash) VALUES($1,'Teste A',$2,'x'),($3,'Teste B',$4,'x')",[userA,`${userA}@example.test`,userB,`${userB}@example.test`]);
    await owner.query("INSERT INTO horse_power.memberships(user_id,tenant_id,role) VALUES($1,$2,'owner'),($3,$4,'owner')",[userA,a,userB,b]);
    await app.query("BEGIN");
    await app.query("SELECT set_config('app.tenant_id',$1,true),set_config('app.user_id',$2,true)",[a,userA]);
    await app.query("SELECT platform_support.workshop_support_create($1,$2,$3,$4)",[ticket,randomUUID(),"Falha fictícia de teste","Preciso de ajuda."]);
    assert.equal((await app.query("SELECT * FROM platform_support.workshop_support_list()")).rows.length,1);
    await app.query("COMMIT");
    await app.query("BEGIN");
    await app.query("SELECT set_config('app.tenant_id',$1,true),set_config('app.user_id',$2,true)",[b,userB]);
    assert.equal((await app.query("SELECT * FROM platform_support.workshop_support_list()")).rows.length,0);
    assert.equal((await app.query("SELECT * FROM platform_support.workshop_support_messages($1)",[ticket])).rows.length,0);
    assert.equal((await app.query("SELECT platform_support.workshop_support_reply($1,$2,$3) AS ok",[ticket,randomUUID(),"Resposta cruzada"])).rows[0].ok,false);
    await app.query("ROLLBACK");
    await owner.query(`INSERT INTO platform_admin.administrators(id,email,display_name,role,permissions,password_hash,totp_secret_ciphertext,active,enrolled)
      VALUES($1,$2,'Suporte Fictício','technical_support','["workshops:read"]',$3,$4,true,true)`,
      [adminId,`${adminId}@example.test`,hashAdminPassword(randomUUID()),encryptTotpSecret(newTotpSecret(),"0".repeat(64))]);
    await owner.query("INSERT INTO platform_admin.sessions(token_hash,administrator_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",[digestAdminToken(token),adminId]);
    server=createPlatformAdminApp(adminPool,"0".repeat(64)).listen(0,"127.0.0.1");await once(server,"listening");
    const address=server.address();assert.ok(address&&typeof address!=="string");
    const base=`http://127.0.0.1:${address.port}`,cookie=`hp_platform_session=${token}`;
    const request=(path:string,method="GET",body?:object)=>fetch(base+path,{method,headers:{Cookie:cookie,Origin:"http://127.0.0.1:5173",...(body?{"Content-Type":"application/json"}:{})},body:body?JSON.stringify(body):undefined});
    assert.equal((await fetch(base+"/admin-api/support/tickets")).status,401);
    const listed=await request("/admin-api/support/tickets");assert.equal(listed.status,200);assert.ok((await listed.json() as {id:string}[]).some(row=>row.id===ticket));
    assert.equal((await request(`/admin-api/support/tickets/${ticket}/messages`,"POST",{body:"Resposta administrativa"})).status,403);
    assert.equal((await request("/admin-api/monitoring")).status,403);
    await owner.query("UPDATE platform_admin.administrators SET permissions='[\"workshops:read\",\"workshops:manage\"]'::jsonb WHERE id=$1",[adminId]);
    assert.equal((await request(`/admin-api/support/tickets/${ticket}/messages`,"POST",{body:"Resposta administrativa"})).status,200);
    assert.equal((await owner.query("SELECT count(*)::int AS n FROM platform_admin.audit_events WHERE action='admin.support.replied' AND subject_tenant_id=$1",[a])).rows[0].n,1);
    await owner.query("UPDATE platform_admin.administrators SET permissions=permissions || '[\"audit:read\"]'::jsonb WHERE id=$1",[adminId]);
    await owner.query("INSERT INTO platform_admin.audit_events(id,actor_email,action,result,technical_context) VALUES($1,'system','integration.stripe.failure','failure','{}'::jsonb)",[randomUUID()]);
    const health=await request("/admin-api/monitoring");assert.equal(health.status,200);
    const report=await health.json() as {database_available:boolean;integrations:{name:string;failures:number}[]};
    assert.equal(report.database_available,true);
    assert.ok(report.integrations.find(i=>i.name==="Stripe")!.failures>=1);
    assert.ok(report.integrations.every(i=>Number.isInteger(i.failures)));
    await app.query("BEGIN");await app.query("SELECT set_config('app.tenant_id',$1,true),set_config('app.user_id',$2,true)",[a,userA]);
    assert.equal((await app.query("SELECT * FROM platform_support.workshop_support_messages($1)",[ticket])).rows.length,2);
    await app.query("ROLLBACK");
  }finally{if(server)await new Promise<void>(resolve=>server!.close(()=>resolve()));await app.end();await adminPool.end();await owner.end();}
});
