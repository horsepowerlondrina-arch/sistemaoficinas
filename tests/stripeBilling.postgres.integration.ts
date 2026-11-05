import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { adminClient } from "../scripts/local-admin.js";
import { stripeBillingService,type StripeRequest } from "../server/services/stripeBilling.js";
import { billingDate } from "../shared/stripeBilling.js";

test("Stripe PostgreSQL: preços versionados, Pix, cartão, repetição, falha, isolamento e vencimento",async()=>{
 const root=adminClient();await root.connect();
 const url=new URL(process.env.PLATFORM_ADMIN_DATABASE_URL||"");
 assert.ok(["localhost","127.0.0.1"].includes(url.hostname)&&url.pathname==="/horse_power_local");
 assert.equal(decodeURIComponent(url.username),"hp_platform_admin_app");
 const pool=new pg.Pool({connectionString:url.toString(),ssl:false,max:4});
 const tenant=randomUUID(),other=randomUUID(),actor={id:randomUUID(),email:"billing-"+randomUUID()+"@example.test"};
 const requests=new Map<string,Record<string,unknown>>(),resources=new Map<string,unknown>();
 let failOnce=true,calls=0;
 const request:StripeRequest=async(path,input,key)=>{
  if(input&&path==="/checkout/sessions"){
   assert.ok(key);calls++;
   const saved=requests.get(key);
   if(saved)assert.deepEqual(saved,input,"retry parameters must be identical");
   requests.set(key,structuredClone(input));
   const id="cs_test_"+key.replace(/[^a-z0-9]/gi,"");
   const result={id,livemode:false,url:"https://checkout.stripe.com/c/pay/"+id,
    status:"open",payment_status:"unpaid",amount_total:1000,currency:"brl",
    customer:"cus_"+String(input.client_reference_id).replaceAll("-",""),client_reference_id:input.client_reference_id,
    subscription:null,payment_intent:null};
   if(!resources.has("/checkout/sessions/"+id))resources.set("/checkout/sessions/"+id,result);
   if(failOnce){failOnce=false;throw new Error("simulated network loss after provider creation");}
   return resources.get("/checkout/sessions/"+id);
  }
  if(input&&path.startsWith("/subscriptions/")){
   const s=resources.get(path) as Record<string,unknown>;s.cancel_at_period_end=true;return s;
  }
  const result=resources.get(path);
  assert.ok(result,"unexpected Stripe request "+path);return result;
 };
 const service=stripeBillingService(pool,request,"https://example.test");
 try{
  await root.query("INSERT INTO horse_power.tenants(id,name) VALUES($1,'Stripe fictícia A'),($2,'Stripe fictícia B')",[tenant,other]);
  for(const id of [tenant,other])await root.query("INSERT INTO platform_admin.workshops(tenant_id,source,name,responsible_name,responsible_email,status,email_verified_at) VALUES($1,'admin','Stripe fictícia','Responsável fictício',$2,'active',now())",[id,id+"@example.test"]);
  await root.query("INSERT INTO platform_admin.administrators(id,email,display_name,role,permissions,password_hash,totp_secret_ciphertext,active,enrolled) VALUES($1,$2,'Stripe fictício','principal','[]','fixture','fixture',true,true)",[actor.id,actor.email]);
  const price=(await service.savePrice({plan_code:"premium",amount_cents:1000,reason:"Preço para teste fictício."},actor)).id;
  const p={price_id:price,method:"pix"};
  await assert.rejects(service.checkout(tenant,"owner@example.test",p),/simulated network/);
  const urls=await Promise.all([service.checkout(tenant,"owner@example.test",p),service.checkout(tenant,"owner@example.test",p)]);
  assert.equal(urls[0].url,urls[1].url);assert.equal(requests.size,1);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM platform_admin.stripe_checkouts WHERE tenant_id=$1",[tenant])).rows[0].n,1);
  let sessionId=urls[0].url.split("/").at(-1)!;
  const s=resources.get("/checkout/sessions/"+sessionId) as Record<string,unknown>;
  s.status="complete";s.payment_status="paid";s.payment_intent="pi_TestPix";
  resources.set("/payment_intents/pi_TestPix?expand[]=latest_charge",{id:"pi_TestPix",livemode:false,status:"succeeded",amount_received:1000,currency:"brl",customer:s.customer,latest_charge:{amount_refunded:0,disputed:false}});
  await Promise.all([service.syncSession(sessionId),service.syncSession(sessionId)]);
  await service.webhook({id:"evt_TestPix",type:"checkout.session.completed",data:{object:{id:sessionId}}});
  await service.webhook({id:"evt_TestPix",type:"checkout.session.completed",data:{object:{id:sessionId}}});
  const summary=await service.summary(tenant);
  assert.equal(summary.payments.length,1);assert.equal(summary.account.managed,true);assert.equal(summary.account.plan_code,"premium");
  assert.equal((await service.summary(other)).payments.length,0);
  assert.equal((await root.query("SELECT platform_admin.workshop_entitlement_status($1) AS v",[tenant])).rows[0].v.modules.technical_catalog,true);
  const before=(await pool.query("SELECT paid_until::text,due_on::text FROM platform_admin.stripe_accounts WHERE tenant_id=$1",[tenant])).rows[0];
  await service.refresh(tenant);
  assert.deepEqual((await pool.query("SELECT paid_until::text,due_on::text FROM platform_admin.stripe_accounts WHERE tenant_id=$1",[tenant])).rows[0],before);
  const newPrice=(await service.savePrice({plan_code:"premium",amount_cents:1500,reason:"Preço futuro sem alterar contrato."},actor)).id;
  assert.notEqual(price,newPrice);
  assert.equal((await pool.query("SELECT price_id FROM platform_admin.stripe_accounts WHERE tenant_id=$1",[tenant])).rows[0].price_id,price);
  await assert.rejects(service.checkout(tenant,"owner@example.test",{price_id:newPrice,method:"pix"}),/ainda está válida/);
  await root.query("UPDATE platform_admin.stripe_accounts SET paid_until=(now() AT TIME ZONE 'America/Sao_Paulo')::date-2,due_on=(now() AT TIME ZONE 'America/Sao_Paulo')::date-1 WHERE tenant_id=$1",[tenant]);
  assert.equal((await root.query("SELECT horse_power.local_tenant_access_state($1) AS state",[tenant])).rows[0].state,"read_only");
  assert.equal((await root.query("SELECT horse_power.local_tenant_access_state($1) AS state",[other])).rows[0].state,"active");
  await root.query("UPDATE platform_admin.stripe_accounts SET due_on=(now() AT TIME ZONE 'America/Sao_Paulo')::date WHERE tenant_id=$1",[tenant]);
  assert.equal((await root.query("SELECT horse_power.local_tenant_access_state($1) AS state",[tenant])).rows[0].state,"active","due date is not overdue");
  await service.refresh(tenant);
  await root.query("UPDATE platform_admin.workshops SET status='read_only' WHERE tenant_id=$1",[tenant]);
  await service.refresh(tenant);
  assert.equal((await root.query("SELECT horse_power.local_tenant_access_state($1) AS state",[tenant])).rows[0].state,"read_only","manual suspension is authoritative");
  await assert.rejects(service.checkout(tenant,"owner@example.test",{price_id:newPrice,method:"pix"}),/administração/);
  // Card: session creation alone must not grant access; invoice and actual charge must match.
  const cardPrice=(await service.savePrice({plan_code:"basic",amount_cents:1000,reason:"Preço cartão fictício."},actor)).id;
  const card=await service.checkout(other,"card@example.test",{price_id:cardPrice,method:"card"});
  sessionId=card.url.split("/").at(-1)!;
  const cs=resources.get("/checkout/sessions/"+sessionId) as Record<string,unknown>;
  cs.status="complete";cs.payment_status="paid";cs.subscription="sub_TestCard";
  resources.set("/subscriptions/sub_TestCard",{id:"sub_TestCard",livemode:false,customer:cs.customer,latest_invoice:"in_TestCard",status:"active",cancel_at_period_end:false});
  const now=Math.floor(Date.now()/1000),end=now+30*86400;
  resources.set("/invoices/in_TestCard",{id:"in_TestCard",livemode:false,customer:cs.customer,status:"paid",amount_paid:1000,currency:"brl",parent:{subscription_details:{subscription:"sub_TestCard"}},lines:{has_more:false,data:[{amount:1000,period:{start:now,end}}]},payments:{has_more:false,data:[{payment:{type:"payment_intent",payment_intent:"pi_TestCard"}}]}});
  const pi={id:"pi_TestCard",livemode:false,status:"succeeded",amount_received:999,currency:"brl",customer:cs.customer,latest_charge:{amount_refunded:0,disputed:false}};
  resources.set("/payment_intents/pi_TestCard?expand[]=latest_charge",pi);
  await assert.rejects(service.syncSession(sessionId),/não corresponde/);
  assert.equal((await service.summary(other)).payments.length,0);
  pi.amount_received=1000;await service.syncSession(sessionId);await service.refresh(other);
  assert.equal((await service.summary(other)).payments.length,1);
  assert.equal((await root.query("SELECT platform_admin.workshop_entitlement_status($1) AS v",[other])).rows[0].v.max_users,2);
  await service.cancel(other);assert.equal((await service.summary(other)).account.cancel_at_period_end,true);
  pi.latest_charge.amount_refunded=1000;
  resources.set("/charges/ch_Test",{payment_intent:"pi_TestCard"});
  await service.webhook({id:"evt_Refund",type:"charge.refunded",data:{object:{id:"ch_Test"}}});
  await service.syncInvoice("in_TestCard");
  assert.equal((await service.summary(other)).payments[0].status,"refunded");
  assert.equal((await service.summary(other)).account.paid_until,null);
  assert.equal((await root.query("SELECT horse_power.local_tenant_access_state($1) AS state",[other])).rows[0].state,"read_only");
  assert.ok(calls>=3);assert.ok(billingDate(new Date()));
  assert.ok((await pool.query("SELECT 1 FROM platform_admin.audit_events WHERE subject_tenant_id=$1 AND action='stripe.payment.reconciled'",[tenant])).rowCount);
  await assert.rejects(pool.query("SELECT password_hash FROM horse_power.users"),/permission denied/);
 }finally{await pool.end();await root.end();}
});
