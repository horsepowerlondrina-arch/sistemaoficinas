import test from "node:test";
import assert from "node:assert/strict";
import {createDatabase} from "../server/db/database";
import {createApp} from "../server/app";
import {digest} from "../server/auth/session";
import {defaultWorkshopModules} from "../shared/workshopModules";
import {getPartsPricing,defaultRules} from "../server/services/partsPricing";
import {workshopIdentity,workshopAddress} from "../shared/workshopIdentity";

test("OPS-001 payment settings preserve finance authorization, isolation and audit",async()=>{
 const db=createDatabase(":memory:");
 db.exec("INSERT INTO tenants(id,name) VALUES('a','Fictícia A'),('b','Fictícia B'); INSERT INTO users VALUES('u','Admin','a@example.test','disabled'),('m','Operador','m@example.test','disabled'); INSERT INTO memberships VALUES('u','a','owner'),('m','a','operator')");
 db.prepare("INSERT INTO sessions VALUES(?,?,?,?)").run(digest("owner"),"u","a",Date.now()+60000);
 db.prepare("INSERT INTO sessions VALUES(?,?,?,?)").run(digest("operator"),"m","a",Date.now()+60000);
 let finance=true;
 Object.assign(db,{getTenantModuleAccess:async()=>({...defaultWorkshopModules,finance})});
 const server=createApp(db).listen(0,"127.0.0.1");
 await new Promise<void>(resolve=>server.once("listening",resolve));
 const base="http://127.0.0.1:"+(server.address() as {port:number}).port+"/api";
 const request=(path:string,body:unknown,cookie="owner")=>fetch(base+path,{method:"PUT",headers:{"Content-Type":"application/json",Cookie:"hp_session="+cookie},body:JSON.stringify(body)});
 const values={debit_fee_bps:150,credit_fee_bps:250,interest_bps:350};
 try{
  assert.equal((await request("/payment-settings",values,"operator")).status,403);
  finance=false;assert.equal((await request("/payment-settings",values)).status,403);
  finance=true;assert.equal((await request("/payment-settings",{...values,tenant_id:"b"})).status,200);
  assert.equal(db.prepare("SELECT credit_fee_bps FROM payment_settings WHERE tenant_id='a'").get()!.credit_fee_bps,250);
  assert.equal(db.prepare("SELECT count(*) total FROM payment_settings WHERE tenant_id='b'").get()!.total,0);
  assert.equal(db.prepare("SELECT count(*) total FROM audit_events WHERE tenant_id='a' AND action='payment_settings.updated'").get()!.total,1);
  assert.equal((await request("/payment-settings",{...values,credit_fee_bps:10001})).ok,false);
  assert.equal(db.prepare("SELECT count(*) total FROM audit_events WHERE action='payment_settings.updated'").get()!.total,1);
  for(const mode of ["markup","margin","legacy"] as const){
   assert.equal((await request("/parts-pricing",{mode,rate_bps:2500,rules:defaultRules,service_markup_bps:4500})).status,200);
   const saved=await getPartsPricing(db,"a");
   assert.equal(saved.mode,mode);assert.equal(saved.rate_bps,2500);assert.equal(saved.service_markup_bps,4500);
  }
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));db.close();}
});
test("OPS-001 structured address takes effect only after explicit legacy replacement",()=>{
 const profile=workshopIdentity({name:"Fictícia",address:"Endereço legado",street:"Rua Atual",number:"10",city:"Londrina",state:"PR"});
 assert.equal(workshopAddress(profile),"Endereço legado");
 assert.equal(workshopAddress({...profile,address:""}),"Rua Atual, 10, Londrina / PR");
});
