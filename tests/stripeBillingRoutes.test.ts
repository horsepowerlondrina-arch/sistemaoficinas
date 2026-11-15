import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import express from "express";
import { createHmac } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { DB } from "../server/db/database.js";
import type { StripeBilling } from "../server/services/stripeBilling.js";
import { stripeWorkshopRoutes,stripePublicRoutes } from "../server/stripeBillingRoutes.js";
import { tenantAccessDecision } from "../server/auth/tenantAccess.js";
test("Stripe rotas: proprietário, tenant da sessão, webhook assinado e cron privado",async()=>{
 const tenants:string[]=[],events:string[]=[];
 const billing={
  summary:async(t:string)=>{tenants.push(t);return {enabled:true};},
  webhook:async(e:{id:string})=>{events.push(e.id);},
  renew:async()=>({completed:0,failed:0}),
 } as unknown as StripeBilling;
 const app=express();app.use(stripePublicRoutes(billing,"whsec_fixture","x".repeat(32),"y".repeat(32)));app.use(express.json());
 app.use((req,res,next)=>{res.locals.context={userId:"fixture",tenantId:"session-workshop",role:req.get("x-test-role")||"operator"};next();});
 app.use("/api",stripeWorkshopRoutes({} as DB,billing));
 const server=app.listen(0,"127.0.0.1");await once(server,"listening");
 const base="http://127.0.0.1:"+(server.address() as AddressInfo).port;
 try{
  assert.equal((await fetch(base+"/api/account/billing")).status,403);
  assert.equal((await fetch(base+"/api/account/billing?tenant_id=another",{headers:{"x-test-role":"owner"}})).status,200);
  assert.deepEqual(tenants,["session-workshop"]);
  assert.equal((await fetch(base+"/api/billing/stripe/renew")).status,401);
  assert.equal((await fetch(base+"/api/billing/stripe/renew",{headers:{authorization:"Bearer "+"x".repeat(32)}})).status,200);
  assert.equal((await fetch(base+"/api/billing/stripe/renew",{headers:{authorization:"Bearer "+"y".repeat(32)}})).status,200);
  assert.equal((await fetch(base+"/api/billing/stripe/renew",{headers:{authorization:"Bearer "+"z".repeat(32)}})).status,401);
  const body=JSON.stringify({id:"evt_Fixture",livemode:false,type:"invoice.paid",data:{object:{id:"in_Fixture"}}});
  assert.equal((await fetch(base+"/api/billing/stripe/webhook",{method:"POST",headers:{"content-type":"application/json"},body})).status,400);
  const t=Math.floor(Date.now()/1000);const sig=createHmac("sha256","whsec_fixture").update(t+"."+body).digest("hex");
  assert.equal((await fetch(base+"/api/billing/stripe/webhook",{method:"POST",headers:{"content-type":"application/json","stripe-signature":"t="+t+",v1="+sig},body})).status,200);
  assert.deepEqual(events,["evt_Fixture"]);
  assert.equal(tenantAccessDecision("read_only","POST","/orders"),"read_only");
  assert.equal(tenantAccessDecision("read_only","POST","/account/billing/checkout"),"allow");
  assert.equal(tenantAccessDecision("blocked","POST","/account/billing/checkout"),"unavailable");
 }finally{server.close();await once(server,"close");}
});

test("Stripe administração: sessão, permissão, detalhes, conciliação e renovação",async()=>{
 const {stripeAdminRoutes}=await import('../server/stripeBillingRoutes.js');
 const calls:unknown[]=[];
 const billing={overview:async(q:unknown)=>{calls.push(q);return{};},details:async(t:string,q:unknown)=>{calls.push([t,q]);return{};},reconcile:async(t:string,b:unknown,a:unknown)=>{calls.push([t,b,a]);return{ok:true};},adminRenew:async(b:unknown,a:unknown)=>{calls.push([b,a]);return{};}} as unknown as StripeBilling;
 const app=express();app.use(express.json());
 // Vercel installs its own legacy/cached getter before normalizing req.url.
 app.use((req,_res,next)=>{Object.defineProperty(req,'query',{get(){throw new Error('Legacy runtime query getter must not be used');}});next();});
 app.use(stripeAdminRoutes(billing,(req,res,next)=>{if(!req.get('x-session')){res.sendStatus(401);return;}res.locals.admin={id:'actor',email:'fictional@example.test'};next();},permission=>(req,res,next)=>{assert.equal(permission,'platform:settings');if(req.get('x-permission')!=='yes'){res.sendStatus(403);return;}next();}));
 const server=app.listen(0,'127.0.0.1');await once(server,'listening');const base='http://127.0.0.1:'+(server.address() as AddressInfo).port;
 try{
  for(const path of ['/admin-api/billing','/admin-api/billing/accounts/fake']){
   assert.equal((await fetch(base+path)).status,401);
   assert.equal((await fetch(base+path,{headers:{'x-session':'yes'}})).status,403);
  }
  const headers={'x-session':'yes','x-permission':'yes','content-type':'application/json'};
  assert.equal((await fetch(base+'/admin-api/billing?status=overdue&page=2&__hp_vercel_path=%2Fapi%2Fadmin-api%2Fbilling&provider_internal=ignored',{headers})).status,200);
  assert.equal((await fetch(base+'/admin-api/billing/accounts/fake?page=3&provider_internal=ignored',{headers})).status,200);
  assert.equal((await fetch(base+'/admin-api/billing/accounts/fake/reconcile',{method:'POST',headers,body:JSON.stringify({kind:'account',reason:'Teste fictício'})})).status,200);
  assert.equal((await fetch(base+'/admin-api/billing/renew',{method:'POST',headers,body:JSON.stringify({reason:'Teste fictício',confirm:true})})).status,200);
  assert.deepEqual({...calls[0] as object},{search:undefined,status:'overdue',page:'2'});
  assert.deepEqual(calls[1],['fake',{page:'3'}]);
  assert.deepEqual(calls[2],['fake',{kind:'account',reason:'Teste fictício'},{id:'actor',email:'fictional@example.test'}]);
 }finally{server.close();await once(server,'close');}
});
