import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { once } from "node:events";
import { createLocalDatabase } from "../server/db/local";
import { createApp } from "../server/app";
if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const expectedCatalogModels = process.env.CATALOG_EXPECT_FULL === "1" ? 7534 : 1;
test("PostgreSQL local: autenticação, oficinas, transações e RLS do catálogo", async t => {
  const db = await createLocalDatabase();
  t.after(()=>db.close());
  const credentialsPath=process.env.LOCAL_TEST_CREDENTIALS_FILE || "data/local-credentials.json";
  const credentials=JSON.parse(readFileSync(credentialsPath,"utf8"));
  await t.test("migração de serviços próprios preserva isolamento e impede nomes duplicados normalizados", async () => {
    const { adminClient } = await import("../scripts/local-admin");
    const admin = adminClient(); await admin.connect();
    try {
      const columns = await admin.query(`SELECT column_name FROM information_schema.columns
        WHERE table_schema='horse_power' AND table_name='workshop_services'
          AND column_name IN ('description','cost_known','service_type','name_key')`);
      assert.deepEqual(columns.rows.map((row: any) => row.column_name).sort(), ["cost_known","description","name_key","service_type"]);
      await admin.query("BEGIN");
      const first = "00000000-0000-4000-8000-000000000101";
      const second = "00000000-0000-4000-8000-000000000102";
      const third = "00000000-0000-4000-8000-000000000103";
      const insert = "INSERT INTO horse_power.workshop_services(id,tenant_id,name,name_key,description,service_type,execution,minutes,price,cost,cost_known,pricing_mode,reference) VALUES($1,$2,$3,$4,'','private','internal',0,1000,0,0,'price',$5)";
      await admin.query(insert, [first,"local-a","Revisão elétrica","revisao eletrica","SRV-PG-101"]);
      await admin.query(insert, [second,"local-b","Revisao eletrica","revisao eletrica","SRV-PG-101"]);
      await assert.rejects(admin.query(insert, [third,"local-a","REVISÃO ELÉTRICA","revisao eletrica","SRV-PG-103"]), { code: "23505" });
      await admin.query("ROLLBACK");
    } catch (error) {
      await admin.query("ROLLBACK").catch(() => {});
      throw error;
    } finally { await admin.end(); }
  });
  await t.test("migração PostgreSQL de categorias e referências mantém unicidade e vínculo por oficina", async () => {
    const { adminClient } = await import("../scripts/local-admin");
    const admin = adminClient(); await admin.connect();
    try {
      const columns = await admin.query(`SELECT column_name FROM information_schema.columns
        WHERE table_schema='horse_power' AND table_name='workshop_services' AND column_name IN ('reference','category_id')`);
      assert.deepEqual(columns.rows.map((row: any) => row.column_name).sort(), ["category_id","reference"]);
      await admin.query("BEGIN");
      const categoryA = "00000000-0000-4000-8000-000000000201", categoryB = "00000000-0000-4000-8000-000000000202";
      const serviceA = "00000000-0000-4000-8000-000000000203", serviceB = "00000000-0000-4000-8000-000000000204";
      await admin.query("INSERT INTO horse_power.workshop_service_categories(id,tenant_id,name,name_key) VALUES($1,'local-a','Elétrica','eletrica'),($2,'local-b','Elétrica','eletrica')", [categoryA,categoryB]);
      const insert = "INSERT INTO horse_power.workshop_services(id,tenant_id,name,execution,minutes,price,cost,pricing_mode,service_type,name_key,reference,category_id) VALUES($1,$2,$3,'internal',0,1000,0,'price','private',$3,$4,$5)";
      await admin.query(insert, [serviceA,"local-a","Serviço fictício A","SRV-EST005-1",categoryA]);
      await admin.query(insert, [serviceB,"local-b","Serviço fictício B","SRV-EST005-1",categoryB]);
      const expectConstraint = async (query: () => Promise<unknown>, code: string) => {
        await admin.query("SAVEPOINT est005_constraint_check");
        await assert.rejects(query(), { code });
        await admin.query("ROLLBACK TO SAVEPOINT est005_constraint_check");
        await admin.query("RELEASE SAVEPOINT est005_constraint_check");
      };
      await expectConstraint(() => admin.query(insert, ["00000000-0000-4000-8000-000000000205","local-a","Outro serviço","srv-est005-1",categoryA]), "23505");
      await expectConstraint(() => admin.query(insert, ["00000000-0000-4000-8000-000000000206","local-a","Serviço cruzado","SRV-EST005-2",categoryB]), "23503");
      await expectConstraint(() => admin.query("INSERT INTO horse_power.workshop_service_categories(id,tenant_id,name,name_key) VALUES('00000000-0000-4000-8000-000000000207','local-a','ELETRICA','eletrica')"), "23505");
      await admin.query("ROLLBACK");
    } catch (error) { await admin.query("ROLLBACK").catch(() => {}); throw error; }
    finally { await admin.end(); }
  });
  await t.test("migração PostgreSQL registra metadados de auditoria de veículos",async()=>{
    const {adminClient}=await import("../scripts/local-admin");
    const admin=adminClient(); await admin.connect();
    try {
      const column=await admin.query("SELECT column_default,is_nullable FROM information_schema.columns WHERE table_schema='horse_power' AND table_name='audit_events' AND column_name='metadata'");
      assert.equal(column.rowCount,1);
      assert.equal(column.rows[0].column_default,"'{}'::text");
      assert.equal(column.rows[0].is_nullable,"NO");
    } finally { await admin.end(); }
  });
  await t.test("porte direto não reaplica exceção histórica nem cria classificação paralela",async()=>{
    const {adminClient}=await import("../scripts/local-admin"); const admin=adminClient(); await admin.connect();
    try {
      await admin.query("BEGIN");
      const before=Number((await admin.query("SELECT count(*) n FROM service_catalog.model_labor_categories")).rows[0].n);
      const cls=(await admin.query("SELECT id FROM service_catalog.classifications WHERE name='Médio'")).rows[0].id;
      const brand="00000000-0000-4000-8000-000000000009",family="00000000-0000-4000-8000-000000000010",base="00000000-0000-4000-8000-000000000011";
      const importedId=process.env.CATALOG_EXPECT_FULL === "1" ? "00000000-0000-4000-8000-000000000015" : "ab7b2905-17d3-4664-8743-62ef07085599";
      await admin.query("INSERT INTO service_catalog.brands(id,name) VALUES($1,'Marca Fictícia Importada')",[brand]);
      await admin.query("INSERT INTO service_catalog.families(id,brand_id) VALUES($1,$2)",[family,brand]);
      await admin.query("INSERT INTO service_catalog.bases(id,family_id,service_count) VALUES($1,$2,0)",[base,family]);
      await admin.query("INSERT INTO service_catalog.models(id,brand_id,family_id,classification_id,name,fipe_code,complete,service_count,base_id,excluded_service_ids) VALUES($1,$2,$3,$4,'Modelo Fictício Importado','999999-9',1,0,$5,'[]')",[importedId,brand,family,cls,base]);
      const model=(await admin.query("SELECT c.name FROM service_catalog.models m JOIN service_catalog.classifications c ON c.id=m.classification_id WHERE m.id=$1",[importedId])).rows[0];
      assert.equal(model.name,"Médio");
      assert.equal(Number((await admin.query("SELECT count(*) n FROM service_catalog.model_labor_categories")).rows[0].n),before);
      assert.equal((await admin.query("SELECT 1 FROM pg_trigger WHERE tgrelid='service_catalog.models'::regclass AND tgname='assign_model_labor_category_after_catalog_import'")).rowCount,0);
    } finally { await admin.query("ROLLBACK"); await admin.end(); }
  });
  await t.test("catálogo sem contexto não é visível; autorização da oficina é obrigatória",async()=>{
    assert.equal((await db.prepare("SELECT * FROM service_catalog.models").all()).length,0);
    assert.equal(await db.withTenantRead("local-a",async()=>(await db.prepare("SELECT count(*) n FROM service_catalog.models").get() as any).n),expectedCatalogModels);
    assert.equal(await db.withTenantRead("local-b",async()=>(await db.prepare("SELECT * FROM service_catalog.models").all()).length),0);
    assert.equal((await db.prepare("SELECT * FROM service_catalog.models").all()).length,0);
    await assert.rejects(db.withTenantRead("local-a",async()=>{throw new Error("rollback contexto");}));
    assert.equal((await db.prepare("SELECT * FROM service_catalog.models").all()).length,0);
    const parallel=await Promise.all(["local-a","local-b","local-a","local-b"].map(tenant=>db.withTenantRead(tenant,async()=>(await db.prepare("SELECT count(*) n FROM service_catalog.models").get() as any).n)));
    assert.deepEqual(parallel,[expectedCatalogModels,0,expectedCatalogModels,0]);
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
      "UPDATE service_catalog.releases SET status='retired' WHERE status='active'"
      ]){
        await admin.query("BEGIN");
        try {
          await admin.query(mutation);
          await admin.query("SET LOCAL ROLE hp_local_app");
          await admin.query("SELECT set_config('app.tenant_id','local-a',true)");
          assert.equal((await admin.query("SELECT * FROM service_catalog.models LIMIT 1")).rows.length,0);
        } finally {await admin.query("ROLLBACK");}
      }
    } finally {await admin.end();}
  });
  await t.test("OS PostgreSQL resolve catálogo e preserva snapshot de serviço",async()=>{
    const { saveOrder, listOrders }=await import("../server/services/workshop");
    const { searchModels, searchRepairServices }=await import("../server/services/repairCatalog");
    const ctx={tenantId:"local-a",userId:"local-owner-a",role:"owner"};
    let model: string, serviceId: string, serviceQuery: string;
    if(process.env.CATALOG_EXPECT_FULL === "1"){
      const example=await db.withTenantRead("local-a",async()=>db.prepare(`SELECT m.id,m.name,m.brand_id,b.name brand,s.service_id,s.service_name FROM service_catalog.models m
        JOIN service_catalog.brands b ON b.id=m.brand_id JOIN service_catalog.model_services s ON s.model_id=m.id
        WHERE s.minutes>0 ORDER BY m.id,s.service_id LIMIT 1`).get() as any);
      const models=await searchModels(db,ctx,{brand_id:example.brand_id,q:example.name});
      const selected=models.items.find(item=>item.id===example.id);
      assert.ok(selected);
      model=selected.id;serviceId=example.service_id;serviceQuery=example.service_name;
    } else {
      const example=await db.withTenantRead("local-a",async()=>db.prepare("SELECT brand_id FROM service_catalog.models WHERE name=? ORDER BY id LIMIT 1").get("Modelo Fictício") as any);
      const models=await searchModels(db,ctx,{brand_id:example.brand_id,q:"ficticio"});
      assert.equal(models.items.length,1);
      assert.equal(models.items[0].commercial_category_id,"compacto");
      model=models.items[0].id;serviceId="";serviceQuery="inspecao";
    }
    const services=await searchRepairServices(db,ctx,model,{q:serviceQuery});
    const service=serviceId ? services.items.find(item=>item.service_id===serviceId) : services.items[0];
    assert.ok(service);
    const stop=new Error("rollback fixture OS");
    await assert.rejects(db.transaction(async()=>{
       await db.withTenantRead("local-a",async()=>db.prepare("INSERT INTO labor_commercial_rates(tenant_id,category_id,hourly_rate) VALUES('local-a','compacto',12000) ON CONFLICT(tenant_id,category_id) DO UPDATE SET hourly_rate=excluded.hourly_rate").run());
      const id=await saveOrder(db,ctx,{status:"quote",customer_id:"local-a-customer",vehicle_id:"local-a-vehicle",service_model_id:model,entered_on:"2026-10-20",due_on:"2026-10-20",km:0,discount:0,notes:"",problem:"",
        items:[{repair_service_id:service.service_id,repair_model_id:model,price:6000,quantity:1}]});
      const saved=(await listOrders(db,"local-a")).find(row=>row.id===id)!;
      assert.ok(saved);assert.equal(saved.total,6000);
      assert.ok(saved.items[0].service_details.minutes>0);
      assert.equal(saved.items[0].service_details.hourly_rate,12000);
      assert.equal((await listOrders(db,"local-b")).length,0);
      throw stop;
    }),e=>e===stop);
    assert.equal((await listOrders(db,"local-a")).length,0);
  });
  await t.test("RLS limita tarifas e serviços particulares ao tenant do contexto",async()=>{
    const {listWorkshopServices}=await import("../server/services/repairCatalog");
    const serviceContext={tenantId:"local-a",userId:"local-owner-a",role:"owner"};
    const stop=new Error("rollback fixture RLS");
    await assert.rejects(db.transaction(async()=>{
    await db.withTenantRead("local-a",async()=>{
       await db.prepare("INSERT INTO labor_commercial_rates(tenant_id,category_id,hourly_rate) VALUES('local-a','compacto',12000) ON CONFLICT(tenant_id,category_id) DO UPDATE SET hourly_rate=excluded.hourly_rate").run();
      await db.prepare("INSERT INTO workshop_services(id,tenant_id,name,execution,commercial_category_id,reference) VALUES('00000000-0000-4000-8000-000000000091','local-a','Serviço Fictício Compacto','internal','compacto','SRV-COMPACTO'),('00000000-0000-4000-8000-000000000092','local-a','Serviço Fictício Premium','internal','premium','SRV-PREMIUM')").run();
    });
    assert.equal((await listWorkshopServices(db,serviceContext,{service_type:"legacy"})).items.length,2);
    assert.equal((await listWorkshopServices(db,serviceContext,{service_type:"legacy",category_id:"compacto"})).items.length,1);
    assert.equal((await listWorkshopServices(db,serviceContext,{service_type:"legacy",category_id:"premium"})).items.length,1);
    assert.equal((await listWorkshopServices(db,{...serviceContext,tenantId:"local-b",userId:"local-owner-b"},{})).items.length,0);
    const a=await db.withTenantRead("local-a",async()=>db.prepare("SELECT tenant_id,category_id,hourly_rate FROM labor_commercial_rates WHERE tenant_id='local-a'").all());
    const crossRate=await db.withTenantRead("local-a",async()=>db.prepare("SELECT tenant_id FROM labor_commercial_rates WHERE tenant_id='local-b'").all());
    const crossService=await db.withTenantRead("local-a",async()=>db.prepare("SELECT tenant_id FROM workshop_services WHERE tenant_id='local-b'").all());
    assert.deepEqual(a.map((row:any)=>[row.tenant_id,row.category_id,row.hourly_rate]),[["local-a","compacto",12000]]);
    assert.deepEqual(crossRate,[]);
    assert.deepEqual(crossService,[]);
    const {adminClient}=await import("../scripts/local-admin");const admin=adminClient();await admin.connect();
    try{
      await admin.query("BEGIN");
      await admin.query("INSERT INTO horse_power.workshop_services(id,tenant_id,name,execution,reference) VALUES('00000000-0000-4000-8000-000000000099','local-b','Serviço Fictício B','internal','SRV-OTHER-B')");
      await admin.query("SET LOCAL ROLE hp_local_app");
      await admin.query("SELECT set_config('app.tenant_id','local-a',true)");
      assert.deepEqual((await admin.query("SELECT tenant_id FROM horse_power.labor_commercial_rates WHERE tenant_id='local-b'")).rows,[]);
      assert.deepEqual((await admin.query("SELECT tenant_id FROM horse_power.workshop_services WHERE tenant_id='local-b'")).rows,[]);
      await assert.rejects(admin.query("INSERT INTO horse_power.labor_commercial_rates(tenant_id,category_id,hourly_rate) VALUES('local-b','medio',9999)"),{code:"42501"});
    } finally {await admin.query("ROLLBACK");await admin.end();}
    throw stop;
    }),e=>e===stop);
  });
  await t.test("OS-006: PDF atual, revogação, renovação e isolamento de links públicos",async()=>{
    const { saveWorkshopProfile,getWorkshopProfile }=await import("../server/services/workshopProfile");
    const { createShare,readShare }=await import("../server/services/sharing");
    const { invalidateOrderShares,saveOrder }=await import("../server/services/workshop");
    const { issueDocument,readDocument,documentHistory }=await import("../server/services/documents");
    const { workshopLogo }=await import("./fixtures/workshopLogo");
    const original=await db.prepare("SELECT id,name,document_logo FROM tenants ORDER BY id").all();
    const stop=new Error("rollback OS-006 fictícia");
    await assert.rejects(db.transaction(async()=>{
      const profiles=[
        {tenant:"local-a",user:"local-owner-a",name:"Oficina Visual A",logo:workshopLogo(20,110,130)},
        {tenant:"local-b",user:"local-owner-b",name:"Oficina Visual B",logo:workshopLogo(100,60,160)}
      ];
      const input=(notes="")=>({
        status:"quote",guest_name:"Cliente Fictício",guest_plate:"ABC1D23",
        guest_vehicle:"Honda Civic",entered_on:"2026-10-21",due_on:"2026-10-21",
        km:0,problem:"Relato inicial",notes,discount:0,items:[]
      });
      const orders:string[]=[];
      for(const profile of profiles){
        const ctx={tenantId:profile.tenant,userId:profile.user,role:"owner"};
        await saveWorkshopProfile(db,ctx,{tenant_id:profile.tenant,name:profile.name,document_logo:profile.logo});
        const order=await saveOrder(db,ctx,input());
        orders.push(order);

        const first=await createShare(db,ctx,order);
        const firstToken=first.path.slice(3);
        assert.equal(first.expires_days,30);
        assert.ok(Date.parse(first.expires_at)>Date.now());
        assert.equal(first.reused,false);
        const firstDocument=await readShare(db,firstToken);
        assert.equal(firstDocument!.shop.name,profile.name);
        assert.equal(firstDocument!.shop.document_logo,profile.logo);
        const originalRevision=Number(first.document.revision);
        assert.equal((await readDocument(db,ctx,"order",order,originalRevision)).order.notes,"");

        // Repeated sharing creates a fresh token without revoking or reactivating the previous one.
        const sameData=await saveOrder(db,ctx,input(),order);
        assert.equal(sameData,order);
        assert.ok(await readShare(db,firstToken));
        const second=await createShare(db,ctx,order);
        const secondToken=second.path.slice(3);
        assert.notEqual(secondToken,firstToken);
        assert.ok(await readShare(db,firstToken));
        assert.ok(await readShare(db,secondToken));

        await saveWorkshopProfile(db,ctx,{name:profile.name+" Atualizada"});
        assert.equal((await readShare(db,firstToken))!.shop.name,profile.name);
        const secondSnapshot=await readDocument(db,ctx,"order",order,Number(second.document.revision));
        assert.equal(secondSnapshot.shop.name,profile.name);
        assert.equal((await getWorkshopProfile(db,ctx)).document_logo,profile.logo);

        // A real order edit immediately revokes every previous public link but leaves snapshots intact.
        await saveOrder(db,ctx,input("Descrição atualizada"),order);
        assert.equal(await readShare(db,firstToken),null);
        assert.equal(await readShare(db,secondToken),null);
        const oldAgain=await readDocument(db,ctx,"order",order,Number(second.document.revision));
        assert.equal(oldAgain.order.notes,"");
        const currentPdf=await issueDocument(db,ctx,"order",order,true);
        assert.equal(currentPdf.order.notes,"Descrição atualizada");
        assert.notEqual(currentPdf.revision,second.document.revision);

        const renewed=await createShare(db,ctx,order);
        const renewedToken=renewed.path.slice(3);
        assert.notEqual(renewedToken,firstToken);
        assert.notEqual(renewedToken,secondToken);
        assert.equal(renewed.document.revision,currentPdf.revision+1);
        assert.equal((await readShare(db,renewedToken))!.shop.name,profile.name+" Atualizada");
        const remaining=Date.parse(renewed.expires_at)-Date.now();
        assert.ok(remaining>29*24*60*60*1000 && remaining<=30*24*60*60*1000);
        assert.equal(renewed.expires_days,30);

        if(profile.tenant==="local-a"){
          const other={tenantId:"local-b",userId:"local-owner-b",role:"owner"};
          await assert.rejects(createShare(db,other,order),/não encontrado nesta oficina/);
          await assert.rejects(readDocument(db,other,"order",order,Number(currentPdf.revision)),/não encontrado nesta oficina/);
        }

        // Manual revocation invalidates the latest link and preserves all audit rows.
        assert.equal(await invalidateOrderShares(db,ctx,order),1);
        assert.equal(await readShare(db,renewedToken),null);
        const retained=await db.withTenantRead(profile.tenant,async()=>db.prepare(
          "SELECT token_hash,revoked,expires_at FROM public_shares WHERE tenant_id=? AND order_id=? ORDER BY expires_at",
        ).all(profile.tenant,order));
        assert.equal(retained.length,3);
        assert.ok(retained.every((row:any)=>Number(row.revoked)===1));
        const history=await documentHistory(db,ctx,"order",order);
        assert.ok(history.revisions.length>=4);
      }
      assert.notEqual(orders[0],orders[1]);
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
    const anonymousWorkspace = await request("/api/workspace");
    assert.equal(anonymousWorkspace.status,401,await anonymousWorkspace.text());
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
    const localAIndex=credentials.findIndex((credential:any)=>credential.tenant==="local-a");
    assert.ok(localAIndex>=0);
    const localACookie=sessions[localAIndex];
    const sample=await db.withTenantRead("local-a",async()=>db.prepare(`SELECT m.id,m.name,b.name brand,m.fipe_code FROM service_catalog.models m JOIN service_catalog.brands b ON b.id=m.brand_id
      WHERE m.complete=1 AND NOT EXISTS(SELECT 1 FROM service_catalog.models x WHERE x.brand_id=m.brand_id AND x.name=m.name AND x.id<>m.id)
      AND (COALESCE(m.fipe_code,'')='' OR (SELECT count(*) FROM service_catalog.models x WHERE x.brand_id=m.brand_id AND x.fipe_code=m.fipe_code)=1)
      ORDER BY m.id LIMIT 1`).get() as any);
    assert.ok(sample,"a fictional catalog model with a unique safe match should exist");
    const identified=await request("/api/repair-services/identify-model",localACookie,{brand:sample.brand,model:sample.name,fipe_code:sample.fipe_code||"",service_model_id:null});
    assert.equal(identified.status,200);
    const identifiedBody=await identified.json() as any;
    assert.equal(identifiedBody.status,"matched");
    assert.equal(identifiedBody.model.id,sample.id);
    const createdVehicle=await request("/api/customers-with-vehicle",localACookie,{
      customer:{name:"Cliente CAT013 Nulo",phone:"",email:"",document:"",birthday:"",address:"",notes:"",active:1},
      vehicle:{plate:"QAZ1C23",brand:sample.brand,model:sample.name,year:2020,color:"",km:0,chassis:"",fipe_code:sample.fipe_code||"",fipe_model:"",fipe_year_id:"",service_model_id:null}
    });
    const createdVehicleText=await createdVehicle.text();
    assert.equal(createdVehicle.status,201,createdVehicleText);
    const createdBody=JSON.parse(createdVehicleText) as any;
    const persistedLink=await db.withTenantRead("local-a",async()=>db.prepare("SELECT service_model_id FROM vehicles WHERE tenant_id=? AND id=?").get("local-a",createdBody.vehicle_id) as any);
    assert.equal(persistedLink.service_model_id,sample.id);

    const priorLookupTokens = process.env.FIPEPLACA_TOKENS_JSON;
    const priorLookupAllowlist = process.env.FIPEPLACA_ALLOWED_TENANT_IDS;
    try {
      process.env.FIPEPLACA_TOKENS_JSON = JSON.stringify({ "local-a": "synthetic-ci-token" });
      process.env.FIPEPLACA_ALLOWED_TENANT_IDS = "local-a";
      const platePreview = {
        source: "external",
        vehicle: { plate: "QAZ1C23", brand: "Marca Atualizada", model: "Modelo Atualizado", year: 2021, color: "Preto", fipe_code: "", fipe_model: "", fipe_year_id: "" },
        fipe_candidates: [{ codigoFipe: "004004-5", modelo: "Modelo FIPE Atualizado", anoModelo: 2021, anoId: "2021-1", combustivel: "Gasolina", confianca: "alta", matchAno: true, matchCombustivel: true }],
        fipe_status: "found",
        message: "Consulta sintética de teste.",
      };
      await db.prepare(
        "INSERT INTO vehicle_lookup_cache(tenant_id,plate,result_json,expires_at) VALUES(?,?,?,?) ON CONFLICT(tenant_id,plate) DO UPDATE SET result_json=excluded.result_json,expires_at=excluded.expires_at"
      ).run("local-a","QAZ1C23",JSON.stringify(platePreview),Date.now()+600000);
      const refreshed = await request(`/api/vehicles/${createdBody.vehicle_id}/lookup-refresh`,localACookie,{});
      assert.equal(refreshed.status,200);
      const previewBody = await refreshed.json() as any;
      assert.match(previewBody.confirmation_token,/^[a-f0-9]{64}$/);
      const updatePayload = {
        fields:["brand","fipe_code","fipe_year_id"],
        confirmation_token:previewBody.confirmation_token,
        fipe_candidate_index:0,
      };
      const forged = await request(`/api/vehicles/${createdBody.vehicle_id}/apply-lookup`,localACookie,{
        ...updatePayload,
        values:{brand:"Valor adulterado",fipe_code:"999999-9",fipe_year_id:"2020-1"},
      });
      assert.notEqual(forged.status,200);
      const localBCookie=sessions[credentials.findIndex((credential:any)=>credential.tenant==="local-b")];
      const crossTenant = await request(`/api/vehicles/${createdBody.vehicle_id}/apply-lookup`,localBCookie,updatePayload);
      assert.equal(crossTenant.status,404);
      const applied = await request(`/api/vehicles/${createdBody.vehicle_id}/apply-lookup`,localACookie,updatePayload);
      assert.equal(applied.status,200,await applied.text());
      const appliedVehicle = await db.withTenantRead("local-a",async()=>db.prepare(
        "SELECT brand,fipe_code,fipe_year_id,service_model_id FROM vehicles WHERE tenant_id=? AND id=?"
      ).get("local-a",createdBody.vehicle_id) as any);
      assert.equal(appliedVehicle.brand,"Marca Atualizada");
      assert.equal(appliedVehicle.fipe_code,"004004-5");
      assert.equal(appliedVehicle.fipe_year_id,"2021-1");
      assert.equal(appliedVehicle.service_model_id,sample.id);
      const auditRow = await db.withTenantRead("local-a",async()=>db.prepare(
        "SELECT metadata FROM audit_events WHERE tenant_id=? AND entity_id=? AND action='vehicles.external_lookup_updated' ORDER BY created_at DESC LIMIT 1"
      ).get("local-a",createdBody.vehicle_id) as any);
      const auditMetadata=JSON.parse(auditRow.metadata);
      assert.equal(auditMetadata.source,"external");
      assert.deepEqual(auditMetadata.after,{brand:"Marca Atualizada",fipe_code:"004004-5",fipe_year_id:"2021-1"});

      const secondPreviewResponse=await request(`/api/vehicles/${createdBody.vehicle_id}/lookup-refresh`,localACookie,{});
      const secondPreview=await secondPreviewResponse.json() as any;
      await db.prepare(
        "UPDATE vehicles SET color='Branco' WHERE tenant_id=? AND id=?"
      ).run("local-a",createdBody.vehicle_id);
      const staleApply=await request(`/api/vehicles/${createdBody.vehicle_id}/apply-lookup`,localACookie,{
        fields:["color"],confirmation_token:secondPreview.confirmation_token,
      });
      assert.equal(staleApply.status,409);
      assert.equal(await db.withTenantRead("local-a",async()=>db.prepare(
        "SELECT color FROM vehicles WHERE tenant_id=? AND id=?"
      ).get("local-a",createdBody.vehicle_id) as any).then((row:any)=>row.color),"Branco");

      const missingMetadataDb = {
        ...db,
        prepare(sql: string) {
          const statement = db.prepare(sql);
          if (/INSERT INTO audit_events.*metadata/i.test(sql)) {
            return {
              get: (...values: any[]) => statement.get(...values),
              all: (...values: any[]) => statement.all(...values),
              run: async (..._values: any[]) => {
                throw Object.assign(new Error('column "metadata" of relation "audit_events" does not exist'), { code: "42703" });
              },
            };
          }
          return statement;
        },
      } as typeof db;
      const guardedServer=createApp(missingMetadataDb).listen(0,"127.0.0.1");
      await once(guardedServer,"listening");
      try {
        const guardedAddress=guardedServer.address();
        assert.ok(guardedAddress&&typeof guardedAddress!=="string");
        const guardedRequest=(path:string,body:unknown)=>fetch("http://127.0.0.1:"+guardedAddress.port+path,{
          method:"POST",
          headers:{"Content-Type":"application/json",Origin:"http://127.0.0.1:5173",Cookie:localACookie},
          body:JSON.stringify(body),
        });
        const beforeMissingMetadata = await db.withTenantRead("local-a",async()=>db.prepare(
          "SELECT color FROM vehicles WHERE tenant_id=? AND id=?"
        ).get("local-a",createdBody.vehicle_id) as any);
        const previewWithoutMetadataResponse = await guardedRequest(`/api/vehicles/${createdBody.vehicle_id}/lookup-refresh`,{});
        assert.equal(previewWithoutMetadataResponse.status,200);
        const previewWithoutMetadata = await previewWithoutMetadataResponse.json() as any;
        const blockedWithoutMetadata = await guardedRequest(`/api/vehicles/${createdBody.vehicle_id}/apply-lookup`,{
          fields:["color"],confirmation_token:previewWithoutMetadata.confirmation_token,
        });
        assert.equal(blockedWithoutMetadata.status,503,await blockedWithoutMetadata.text());
        const afterMissingMetadata = await db.withTenantRead("local-a",async()=>db.prepare(
          "SELECT color FROM vehicles WHERE tenant_id=? AND id=?"
        ).get("local-a",createdBody.vehicle_id) as any);
        assert.equal(afterMissingMetadata.color,beforeMissingMetadata.color);
      } finally {
        await new Promise<void>(resolve=>guardedServer.close(()=>resolve()));
      }

      const serviceExample=await db.withTenantRead("local-a",async()=>db.prepare(
        "SELECT service_id FROM service_catalog.model_services WHERE model_id=? AND minutes>0 ORDER BY service_id LIMIT 1"
      ).get(sample.id) as any);
      if(serviceExample){
        const {saveOrder}=await import("../server/services/workshop");
        await assert.rejects(saveOrder(db,{tenantId:"local-a",userId:"local-owner-a",role:"owner"},{
          status:"quote",customer_id:createdBody.id,vehicle_id:createdBody.vehicle_id,service_model_id:sample.id,
          entered_on:"2026-10-25",due_on:"2026-10-25",km:0,discount:0,notes:"",problem:"",
          items:[{id:"cat013-stale-link",repair_service_id:serviceExample.service_id,repair_model_id:sample.id,price:1000,quantity:1}],
        }),/divergem do vínculo técnico/);
      } else {
        assert.fail("A synthetic catalog fixture needs one service to verify stale vehicle links.");
      }
    } finally {
      if(priorLookupTokens===undefined) delete process.env.FIPEPLACA_TOKENS_JSON;
      else process.env.FIPEPLACA_TOKENS_JSON=priorLookupTokens;
      if(priorLookupAllowlist===undefined) delete process.env.FIPEPLACA_ALLOWED_TENANT_IDS;
      else process.env.FIPEPLACA_ALLOWED_TENANT_IDS=priorLookupAllowlist;
    }

    assert.equal((await request("/api/tenant",sessions[0],{tenant_id:"local-b"})).status,403);
    assert.equal((await request("/api/logout",sessions[0],{})).status,200);
    assert.equal((await request("/api/session",sessions[0])).status,401);
    await request("/api/logout",sessions[1],{});
  });
});

