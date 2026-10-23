import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { once } from "node:events";
import { createLocalDatabase } from "../server/db/local";
import { createApp } from "../server/app";
if (existsSync(".env.local")) process.loadEnvFile(".env.local");
test("PostgreSQL local: autenticação, oficinas, transações e RLS do catálogo", async t => {
  const db = await createLocalDatabase();
  t.after(()=>db.close());
  const credentials=JSON.parse(readFileSync("data/local-credentials.json","utf8"));
  await t.test("catálogo sem contexto não é visível; autorização da oficina é obrigatória",async()=>{
    assert.equal((await db.prepare("SELECT * FROM service_catalog.models").all()).length,0);
    assert.equal(await db.withTenantRead("local-a",async()=>(await db.prepare("SELECT * FROM service_catalog.models").all()).length),1);
    assert.equal(await db.withTenantRead("local-b",async()=>(await db.prepare("SELECT * FROM service_catalog.models").all()).length),0);
    assert.equal((await db.prepare("SELECT * FROM service_catalog.models").all()).length,0);
    await assert.rejects(db.withTenantRead("local-a",async()=>{throw new Error("rollback contexto");}));
    assert.equal((await db.prepare("SELECT * FROM service_catalog.models").all()).length,0);
    const parallel=await Promise.all(["local-a","local-b","local-a","local-b"].map(tenant=>db.withTenantRead(tenant,async()=>(await db.prepare("SELECT * FROM service_catalog.model_services").all()).length)));
    assert.deepEqual(parallel,[1,0,1,0]);
  });
  await t.test("runtime não pode alterar catálogo nem se autoliberar",async()=>{
    for (const sql of [
      "INSERT INTO service_catalog.brands(id,name) VALUES('00000000-0000-4000-8000-999999999999','Teste')",
      "UPDATE service_catalog.services SET name='Teste'",
      "DELETE FROM service_catalog.models",
      "UPDATE service_catalog.tenant_access SET enabled=true",
      "CREATE TABLE service_catalog.forbidden(id int)"
    ]) await assert.rejects(db.exec(sql),{code:"42501"});
  });
  await t.test("erros de negócio revertem a transação",async()=>{
    await assert.rejects(db.transaction(async()=>{
      await db.prepare("INSERT INTO customers(id,tenant_id,name) VALUES(?,?,?)").run("local-rollback","local-a","Fictício");
      throw new Error("rollback");
    }));
    assert.equal(await db.prepare("SELECT id FROM customers WHERE id=?").get("local-rollback"),undefined);
  });
  await t.test("liberação vencida e release inativa impedem leitura mesmo com tenant",async()=>{
    const { adminClient } = await import("../scripts/local-admin");
    const admin=adminClient();await admin.connect();
    try {
      for(const mutation of [
        "UPDATE service_catalog.tenant_access SET valid_until=now()-interval '1 day' WHERE tenant_id='local-a'",
        "UPDATE service_catalog.releases SET status='retired' WHERE version='local-ficticio'"
      ]){
        await admin.query("BEGIN");
        try {
          await admin.query(mutation);
          await admin.query("SET LOCAL ROLE hp_local_app");
          await admin.query("SELECT set_config('app.tenant_id','local-a',true)");
          assert.equal((await admin.query("SELECT * FROM service_catalog.model_services")).rows.length,0);
        } finally {await admin.query("ROLLBACK");}
      }
    } finally {await admin.end();}
  });
  await t.test("OS PostgreSQL resolve catálogo e preserva snapshot de serviço",async()=>{
    const { saveOrder, listOrders }=await import("../server/services/workshop");
    const { searchModels, searchRepairServices }=await import("../server/services/repairCatalog");
    const ctx={tenantId:"local-a",userId:"local-owner-a",role:"owner"};
    const models=await searchModels(db,ctx,{q:"ficticio"});
    assert.equal(models.items.length,1);
    const model=models.items[0].id;
    const services=await searchRepairServices(db,ctx,model,{q:"inspecao"});
    assert.equal(services.items.length,1);
    const stop=new Error("rollback fixture OS");
    await assert.rejects(db.transaction(async()=>{
      const id=await saveOrder(db,ctx,{status:"quote",customer_id:"local-a-customer",vehicle_id:"local-a-vehicle",service_model_id:model,entered_on:"2026-10-20",due_on:"2026-10-20",km:0,discount:0,notes:"",problem:"",
        items:[{repair_service_id:services.items[0].service_id,repair_model_id:model,price:6000,quantity:1}]});
      const saved=(await listOrders(db,"local-a")).find(row=>row.id===id)!;
      assert.ok(saved);assert.equal(saved.total,6000);
      assert.equal(saved.items[0].service_details.minutes,30);
      assert.equal(saved.items[0].service_details.hourly_rate,12000);
      assert.equal((await listOrders(db,"local-b")).length,0);
      throw stop;
    }),e=>e===stop);
    assert.equal((await listOrders(db,"local-a")).length,0);
  });
  await t.test("PROD-001.1: identidade, documentos e links públicos isolados entre oficinas",async()=>{
    const { saveWorkshopProfile,getWorkshopProfile }=await import("../server/services/workshopProfile");
    const { createShare,readShare }=await import("../server/services/sharing");
    const { workshopLogo }=await import("./fixtures/workshopLogo");
    const { createElement }=await import("react");
    const { renderToStaticMarkup }=await import("react-dom/server");
    const { WorkshopBrand }=await import("../src/components/WorkshopBrand");
    const { DocumentHeader }=await import("../src/components/DocumentHeader");
    const original=await db.prepare("SELECT id,name,document_logo FROM tenants ORDER BY id").all();
    assert.ok(await db.prepare("SELECT version FROM migrations WHERE version=23").get());
    const stop=new Error("rollback identidade fictícia");
    await assert.rejects(db.transaction(async()=>{
      const profiles=[
        {tenant:"local-a",name:"Oficina Visual A",logo:workshopLogo(20,110,130)},
        {tenant:"local-b",name:"Oficina Visual B",logo:workshopLogo(100,60,160)}
      ];
      for(const profile of profiles){
        const ctx={tenantId:profile.tenant,userId:"local-owner-"+profile.tenant.slice(-1),role:"owner"};
        await saveWorkshopProfile(db,ctx,{tenant_id:profile.tenant,name:profile.name,document_logo:profile.logo});
      }
      for(const [index,profile]of profiles.entries()){
        const other=profiles[1-index],ctx={tenantId:profile.tenant,userId:"local-owner-"+profile.tenant.slice(-1),role:"owner"};
        const current=await getWorkshopProfile(db,ctx);
        assert.equal(current.name,profile.name);assert.equal(current.document_logo,profile.logo);
        const identity=(await db.prepare("SELECT t.name,t.document_logo FROM tenants t JOIN memberships m ON m.tenant_id=t.id WHERE m.user_id=? AND t.id=?").get(ctx.userId,ctx.tenantId))!;
        for(const Component of [WorkshopBrand,DocumentHeader]){
          const html=renderToStaticMarkup(createElement(Component,{shop:identity}));
          assert.ok(html.includes(profile.logo));assert.ok(html.includes(profile.name));
          assert.ok(!html.includes(other.logo));assert.ok(!html.includes(other.name));assert.ok(!html.includes("Horse Power"));
        }
        await assert.rejects(saveWorkshopProfile(db,ctx,{tenant_id:other.tenant,name:"Não permitido"}),/oficina selecionada mudou/);
        const order="local-visual-"+index;
        await db.prepare("INSERT INTO orders(id,tenant_id,number,kind,status,entered_on,due_on,km,total) VALUES(?,?,?,'quote','quote','2026-10-21','2026-10-21',0,0)").run(order,profile.tenant,900+index);
        const share=await createShare(db,ctx,order);
        const document=await readShare(db,share.path.slice(3));
        assert.equal(document!.shop!.name,profile.name);assert.equal(document!.shop!.document_logo,profile.logo);
        const {issueDocument,readDocument}=await import("../server/services/documents");
        await saveWorkshopProfile(db,ctx,{name:profile.name+" Atualizada"});
        assert.equal((await readShare(db,share.path.slice(3)))!.shop!.name,profile.name);
        const next=await issueDocument(db,ctx,"order",order,true);
        assert.equal(next.shop.name,profile.name+" Atualizada");
        assert.equal((await readDocument(db,{...ctx,tenantId:other.tenant},"order",order,1).catch(()=>null)),null);
        const oldAgain=await createShare(db,ctx,order,1);
        assert.equal((await readShare(db,oldAgain.path.slice(3)))!.shop!.name,profile.name);
      }
      await saveWorkshopProfile(db,{tenantId:"local-b",userId:"local-owner-b",role:"owner"},{name:"Oficina sem logo",document_logo:""});
      assert.equal((await getWorkshopProfile(db,{tenantId:"local-b",userId:"local-owner-b",role:"owner"})).document_logo,"");
      assert.equal((await getWorkshopProfile(db,{tenantId:"local-a",userId:"local-owner-a",role:"owner"})).document_logo,profiles[0].logo);
      throw stop;
    }),error=>error===stop);
    assert.deepEqual(await db.prepare("SELECT id,name,document_logo FROM tenants ORDER BY id").all(),original);
    await assert.rejects(db.prepare("UPDATE document_revisions SET payload=payload WHERE false").run(),{code:"42501"});
    await assert.rejects(db.prepare("DELETE FROM document_revisions WHERE false").run(),{code:"42501"});
  });
  const server=createApp(db).listen(0,"127.0.0.1"); await once(server,"listening");
  t.after(()=>new Promise<void>(resolve=>server.close(()=>resolve())));
  const address=server.address(); assert.ok(address&&typeof address!=="string");
  const base="http://127.0.0.1:"+address.port;
  const request=(path:string,cookie="",body?:unknown)=>fetch(base+path,{method:body===undefined?"GET":"POST",headers:{"Content-Type":"application/json",Origin:"http://127.0.0.1:5173",...(cookie?{Cookie:cookie}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  await t.test("login, sessão e dados operacionais não cruzam oficinas",async()=>{
    assert.equal((await request("/api/workspace")).status,401);
    assert.equal((await request("/api/login","",{email:credentials[0].email,password:"wrong-password"})).status,401);
    const sessions:string[]=[];
    for(const credential of credentials){
      const login=await request("/api/login","",{email:credential.email,password:credential.password});
      assert.equal(login.status,200);
      const cookie=login.headers.get("set-cookie")!.split(";")[0];sessions.push(cookie);
      const session=await request("/api/session",cookie); assert.equal((await session.json()).tenant.id,credential.tenant);
      const workspace=await request("/api/workspace",cookie);assert.equal(workspace.status,200);
      const data=await workspace.json();
      assert.ok(data.customers.every((c:any)=>c.tenant_id===credential.tenant));
    }
    assert.equal((await request("/api/tenant",sessions[0],{tenant_id:"local-b"})).status,403);
    assert.equal((await request("/api/logout",sessions[0],{})).status,200);
    assert.equal((await request("/api/session",sessions[0])).status,401);
    await request("/api/logout",sessions[1],{});
  });
});
