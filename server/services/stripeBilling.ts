import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { billingDate,billingReadOnly,nextBillingMonth,billingPlans,moneyCents,validatePaidAmount } from "../../shared/stripeBilling.js";
import { createStripeGateway } from "./stripeGateway.js";
const object=z.object({id:z.string(),livemode:z.literal(false)}).passthrough();
const identifier=(v:unknown):string|null=>typeof v==="string"?v:v&&typeof v==="object"&&"id" in v?String(v.id):null;
export class BillingConflict extends Error {}
export type StripeRequest=ReturnType<typeof createStripeGateway>;
export type StripeBilling=ReturnType<typeof stripeBillingService>;
export function stripeBillingService(pool:Pool,request:StripeRequest,origin:string,testTenants:readonly string[]){
 const allowed=new Set(testTenants);
 function requireTestTenant(tenant:string){if(!allowed.has(tenant))throw new BillingConflict('Esta oficina não está autorizada para testes de cobrança.');}
 const url=new URL(origin);
 if(url.protocol!=="https:"&&!["localhost","127.0.0.1"].includes(url.hostname))throw new Error("Origem de cobrança inválida.");
 const returnUrl=url.origin+"/configuracoes?aba=conta";
 async function tx<T>(fn:(client:PoolClient)=>Promise<T>){
  const c=await pool.connect();
  try{await c.query("BEGIN");const value=await fn(c);await c.query("COMMIT");return value;}
  catch(e){await c.query("ROLLBACK").catch(()=>{});throw e;}finally{c.release();}
 }
 async function audit(c:PoolClient,tenant:string|null,action:string,detail:Record<string,unknown>,actor?:{id:string;email:string}){
  await c.query("INSERT INTO platform_admin.audit_events(id,actor_administrator_id,actor_email,subject_tenant_id,action,result,technical_context) VALUES($1,$2,$3,$4,$5,'success',$6::jsonb)",
   [randomUUID(),actor?.id??null,actor?.email??"stripe",tenant,action,JSON.stringify(detail)]);
 }
 async function summary(tenant:string){
  requireTestTenant(tenant);
  const [prices,account,payments,workshop,pending]=await Promise.all([
   pool.query("SELECT id,plan_code,amount_cents FROM platform_admin.stripe_prices WHERE active ORDER BY amount_cents"),
   pool.query("SELECT plan_code,method,managed,due_on::text,paid_until::text,subscription_status,invoice_payment_url,cancel_at_period_end,subscription_id IS NOT NULL AS recurring FROM platform_admin.stripe_accounts WHERE tenant_id=$1",[tenant]),
   pool.query("SELECT provider_id,amount_cents,period_start::text,period_end::text,status FROM platform_admin.stripe_payments WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 24",[tenant]),
   pool.query("SELECT trial_ends_at FROM platform_admin.workshops WHERE tenant_id=$1 AND status='trial'",[tenant]),
   pool.query("SELECT url,method FROM platform_admin.stripe_checkouts WHERE tenant_id=$1 AND status='open'",[tenant]),
  ]);
  const a=account.rows[0];
  return {enabled:true,test_mode:true,pending:pending.rows[0]??null,prices:prices.rows,account:a??null,payments:payments.rows,read_only:a?billingReadOnly({managed:a.managed,paidUntil:a.paid_until,dueOn:a.due_on,trialUntil:workshop.rows[0]?.trial_ends_at}):false};
 }
 async function overview(){
  const prices=await pool.query("SELECT id,plan_code,amount_cents FROM platform_admin.stripe_prices WHERE active ORDER BY plan_code");
  const accounts=await pool.query("SELECT w.name,a.tenant_id,a.plan_code,a.method,a.due_on::text,a.paid_until::text,a.managed,a.subscription_status,a.cancel_at_period_end FROM platform_admin.stripe_accounts a JOIN platform_admin.workshops w ON w.tenant_id=a.tenant_id ORDER BY a.created_at DESC LIMIT 100");
  return {enabled:true,test_mode:true,prices:prices.rows,accounts:accounts.rows};
 }
 async function savePrice(input:unknown,actor:{id:string;email:string}){
  const p=z.object({plan_code:z.enum(billingPlans),amount_cents:z.number().int().min(50).max(100000000),reason:z.string().trim().min(10).max(500)}).strict().parse(input);
  moneyCents(p.amount_cents);
  return tx(async c=>{
   await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,1231))",[p.plan_code]);
   await c.query("UPDATE platform_admin.stripe_prices SET active=false WHERE plan_code=$1 AND active",[p.plan_code]);
   const id=randomUUID();
   await c.query("INSERT INTO platform_admin.stripe_prices(id,plan_code,amount_cents,created_by,reason) VALUES($1,$2,$3,$4,$5)",[id,p.plan_code,p.amount_cents,actor.id,p.reason]);
   await audit(c,null,"admin.stripe.price_changed",{price_id:id,plan:p.plan_code,amount_cents:p.amount_cents,reason:p.reason},actor);
   return {id};
  });
 }
 // Durable reservation is committed BEFORE Stripe is called. Retries reuse identical parameters.
 async function checkout(tenant:string,email:string,input:unknown,renewal=false){
  requireTestTenant(tenant);
  const p=z.object({price_id:z.string().uuid(),method:z.enum(["card","pix"])}).strict().parse(input);
  const row=await tx(async c=>{
   await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,1232))",[tenant]);
   const workshop=(await c.query("SELECT status,trial_ends_at FROM platform_admin.workshops WHERE tenant_id=$1",[tenant])).rows[0];
   if(!workshop||["pending_verification","blocked","archived","read_only","legacy"].includes(workshop.status))
    throw new BillingConflict("A administração precisa liberar esta oficina antes da contratação.");
   if(workshop.status==="trial"&&new Date(workshop.trial_ends_at).getTime()>Date.now())
    throw new BillingConflict("Seu teste gratuito está ativo. A contratação ficará disponível ao final do teste, sem cobrança antecipada.");
   const old=(await c.query("SELECT *,paid_until::text AS paid_day FROM platform_admin.stripe_accounts WHERE tenant_id=$1 FOR UPDATE",[tenant])).rows[0];
   if(renewal&&old?.cancel_at_period_end)throw new BillingConflict("A renovação está cancelada.");
   const existing=(await c.query("SELECT * FROM platform_admin.stripe_checkouts WHERE tenant_id=$1 AND status IN ('pending','open')",[tenant])).rows[0];
   if(existing){
    if(existing.price_id!==p.price_id||existing.method!==p.method)throw new BillingConflict("Existe um pagamento pendente. Atualize sua situação antes de escolher outro.");
    return existing;
   }
   if(old?.subscription_id)throw new BillingConflict("Cancele a renovação da assinatura atual e aguarde o período contratado para trocar o plano.");
   if(old?.paid_day&&old.paid_day>billingDate(new Date()))throw new BillingConflict("A mensalidade atual ainda está válida.");
   // Automatic Pix renewals retain the agreed price, even after the administrator changes new offers.
   const price=(await c.query("SELECT * FROM platform_admin.stripe_prices WHERE id=$1 AND (active OR $2)",[p.price_id,renewal&&old?.price_id===p.price_id])).rows[0];
   if(!price)throw new BillingConflict("O preço mudou. Atualize os planos.");
   const today=billingDate(new Date()),end=nextBillingMonth(today),id=randomUUID();
   const metadata={tenant_id:tenant,checkout_id:id,price_id:p.price_id};
   const payload={
    ...(old?.customer_id?{customer:old.customer_id}:{customer_email:email,...(p.method==="pix"?{customer_creation:"always"}:{})}),
    mode:p.method==="card"?"subscription":"payment",payment_method_types:[p.method],
    success_url:returnUrl+"&pagamento=retorno",cancel_url:returnUrl,
    client_reference_id:id,metadata,expires_at:Math.floor(Date.now()/1000)+3600,
    line_items:[{price_data:{currency:"brl",unit_amount:price.amount_cents,product_data:{name:"OSDrive "+price.plan_code},
     ...(p.method==="card"?{recurring:{interval:"month"}}:{})},quantity:1}],
    ...(p.method==="card"?{subscription_data:{metadata}}:{payment_intent_data:{metadata},payment_method_options:{pix:{expires_after_seconds:3600}}}),
   };
   await c.query("INSERT INTO platform_admin.stripe_accounts(tenant_id,billing_email,plan_code,price_id,method) VALUES($1,$2,$3,$4,$5) ON CONFLICT(tenant_id) DO NOTHING",
    [tenant,email,price.plan_code,p.price_id,p.method]);
   const r=await c.query("INSERT INTO platform_admin.stripe_checkouts(id,tenant_id,price_id,method,due_on,period_end,request_body) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb) RETURNING *",[id,tenant,p.price_id,p.method,today,end,JSON.stringify(payload)]);
   await audit(c,tenant,"stripe.checkout.prepared",{checkout_id:id,method:p.method});
   return r.rows[0];
  });
  if(row.url)return {url:String(row.url)};
  // Stripe may discard idempotency keys after 24 hours. Never retry an ambiguous creation beyond that window.
  if(Date.now()-new Date(row.created_at).getTime()>23*3600000)
   throw new BillingConflict("Pagamento pendente de conciliação. Solicite verificação à administração; nenhuma nova cobrança foi criada.");
  const session=object.extend({url:z.string().url()}).parse(await request("/checkout/sessions",row.request_body,"checkout:"+row.id));
  if(new URL(session.url).hostname!=="checkout.stripe.com")throw new Error("Endereço de pagamento inválido.");
  await pool.query("UPDATE platform_admin.stripe_checkouts SET provider_id=$1,url=$2,status='open' WHERE id=$3 AND status='pending'",[session.id,session.url,row.id]);
  return {url:session.url};
 }
 async function confirmPayment(c:PoolClient,p:{id:string;intent:string;tenant:string;price:string;amount:number;start:string;end:string;revoked:boolean;method:'card'|'pix'}){
  const prior=(await c.query("SELECT tenant_id,status FROM platform_admin.stripe_payments WHERE provider_id=$1 FOR UPDATE",[p.id])).rows[0];
  if(prior&&prior.tenant_id!==p.tenant)throw new Error("Pagamento incompatível.");
  // A later delivery of invoice.paid must not resurrect a refunded/disputed payment.
  const state=p.revoked?"refunded":prior?.status??"paid";
  await c.query("INSERT INTO platform_admin.stripe_payments(provider_id,tenant_id,payment_intent_id,price_id,amount_cents,period_start,period_end,status,method) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(provider_id) DO UPDATE SET status=EXCLUDED.status",
    [p.id,p.tenant,p.intent,p.price,p.amount,p.start,p.end,state,p.method]);
  await c.query("UPDATE platform_admin.stripe_accounts SET managed=true,method=(SELECT method FROM platform_admin.stripe_payments WHERE tenant_id=$1 ORDER BY period_end DESC,created_at DESC LIMIT 1),price_id=(SELECT price_id FROM platform_admin.stripe_payments WHERE tenant_id=$1 ORDER BY period_end DESC,created_at DESC LIMIT 1),plan_code=(SELECT p.plan_code FROM platform_admin.stripe_payments x JOIN platform_admin.stripe_prices p ON p.id=x.price_id WHERE x.tenant_id=$1 ORDER BY x.period_end DESC,x.created_at DESC LIMIT 1),paid_until=(SELECT max(period_end) FROM platform_admin.stripe_payments WHERE tenant_id=$1 AND status='paid'),due_on=CASE WHEN $3::boolean THEN LEAST(due_on,(now() AT TIME ZONE 'America/Sao_Paulo')::date-1) ELSE GREATEST(due_on,$2::date) END WHERE tenant_id=$1",[p.tenant,p.end,state!=='paid']);
  if(!prior||prior.status!==state)await audit(c,p.tenant,"stripe.payment.reconciled",{payment_id:p.id,status:state,amount_cents:p.amount});
 }
 async function intentState(id:string){
  if(!/^pi_[A-Za-z0-9]+$/.test(id))throw new Error("Pagamento inválido.");
  const pi=object.extend({status:z.string(),amount_received:z.number().int(),currency:z.string(),customer:z.unknown(),latest_charge:z.object({amount_refunded:z.number(),disputed:z.boolean()}).nullable()}).parse(
   await request("/payment_intents/"+id+"?expand[]=latest_charge"));
  if(pi.status!=="succeeded"||!pi.latest_charge)throw new Error("Pagamento ainda não liquidado.");
  return {...pi,revoked:pi.latest_charge.amount_refunded>0||pi.latest_charge.disputed};
 }
 async function syncSession(sessionId:string){
  if(!/^cs_(test_)?[A-Za-z0-9]+$/.test(sessionId))throw new Error("Pagamento inválido.");
  const s=object.extend({customer:z.unknown(),payment_status:z.string(),status:z.string(),amount_total:z.number().int().nullable(),currency:z.string().nullable(),subscription:z.unknown().optional(),payment_intent:z.unknown().optional(),client_reference_id:z.string().nullable()}).parse(await request("/checkout/sessions/"+sessionId));
  const row=(await pool.query("SELECT x.*,x.due_on::text AS due_day,x.period_end::text AS end_day,p.amount_cents,p.plan_code FROM platform_admin.stripe_checkouts x JOIN platform_admin.stripe_prices p ON p.id=x.price_id WHERE x.provider_id=$1 OR (x.id=$2 AND x.provider_id IS NULL)",[sessionId,s.client_reference_id])).rows[0];
  if(!row)return;
  if(s.client_reference_id!==row.id)throw new Error("Pagamento incompatível.");
  const customer=identifier(s.customer),sub=identifier(s.subscription),intent=identifier(s.payment_intent);
  const pi=row.method==="pix"&&s.payment_status==="paid"&&intent?await intentState(intent):null;
  await tx(async c=>{
   await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,1232))",[row.tenant_id]);
   const account=(await c.query("SELECT * FROM platform_admin.stripe_accounts WHERE tenant_id=$1 FOR UPDATE",[row.tenant_id])).rows[0];
   if(customer&&account.customer_id&&customer!==account.customer_id)throw new Error("Pagamento de outra oficina.");
   if(s.status==="expired"){
    await c.query("UPDATE platform_admin.stripe_checkouts SET provider_id=$1,status='expired',url=NULL WHERE id=$2 AND status<>'paid'",[s.id,row.id]);return;
   }
   if(s.status!=="complete")return;
   if(!customer)throw new Error("Cliente do pagamento ausente.");
   await c.query("UPDATE platform_admin.stripe_accounts SET customer_id=$2 WHERE tenant_id=$1",[row.tenant_id,customer]);
   await c.query("UPDATE platform_admin.stripe_checkouts SET provider_id=$2 WHERE id=$1",[row.id,s.id]);
   if(row.method==="card"&&sub){
    if(row.subscription_id&&row.subscription_id!==sub)throw new Error("Assinatura incompatível.");
    await c.query("UPDATE platform_admin.stripe_checkouts SET subscription_id=$2 WHERE id=$1",[row.id,sub]);
   }
   if(row.method==="card"&&row.status!=="paid"){
    if(!sub)throw new Error("Assinatura ausente.");
    if(account.subscription_id&&account.subscription_id!==sub)throw new Error("Assinatura incompatível.");
    await c.query("UPDATE platform_admin.stripe_accounts SET subscription_id=$2,price_id=$3,method='card' WHERE tenant_id=$1",[row.tenant_id,sub,row.price_id]);
   }else if(pi&&intent){
    validatePaidAmount(s.amount_total,row.amount_cents,s.currency);
    validatePaidAmount(pi.amount_received,row.amount_cents,pi.currency);
    if(identifier(pi.customer)!==customer)throw new Error("Pagamento de outra oficina.");
    await confirmPayment(c,{id:intent,intent,tenant:row.tenant_id,price:row.price_id,amount:row.amount_cents,start:row.due_day,end:row.end_day,revoked:pi.revoked,method:"pix"});
    if(row.status!=="paid")await c.query("UPDATE platform_admin.stripe_accounts SET cancel_at_period_end=false WHERE tenant_id=$1 AND subscription_id IS NULL",[row.tenant_id]);
   }
   if(s.payment_status==="paid")await c.query("UPDATE platform_admin.stripe_checkouts SET status='paid',url=NULL WHERE id=$1",[row.id]);
  });
  if(sub)await syncSubscription(sub);
 }
 async function syncInvoice(invoiceId:string){
  if(!/^in_[A-Za-z0-9]+$/.test(invoiceId))throw new Error("Fatura inválida.");
  const inv=object.extend({customer:z.unknown(),status:z.string(),created:z.number().int(),hosted_invoice_url:z.string().url().nullable().optional(),amount_paid:z.number().int(),currency:z.string(),parent:z.object({subscription_details:z.object({subscription:z.unknown()}).nullable().optional()}).nullable().optional()}).parse(await request("/invoices/"+invoiceId));
  const sub=identifier(inv.parent?.subscription_details?.subscription);
  if(!sub)return;
  const account=(await pool.query("SELECT a.tenant_id,a.customer_id,x.price_id,p.amount_cents FROM platform_admin.stripe_checkouts x JOIN platform_admin.stripe_accounts a ON a.tenant_id=x.tenant_id JOIN platform_admin.stripe_prices p ON p.id=x.price_id WHERE x.subscription_id=$1",[sub])).rows[0];
  if(!account)return;
  if(identifier(inv.customer)!==account.customer_id)throw new Error("Fatura de outra oficina.");
  let paymentUrl:string|null=null;
  if(inv.status==="open"&&inv.hosted_invoice_url){
   const target=new URL(inv.hosted_invoice_url);
   if(target.protocol!=="https:"||!["invoice.stripe.com","pay.stripe.com"].includes(target.hostname))throw new Error("Endereço de fatura inválido.");
   paymentUrl=target.href;
  }
  await pool.query("UPDATE platform_admin.stripe_accounts SET invoice_payment_url=$2,invoice_created=$3 WHERE tenant_id=$1 AND invoice_created<=$3",[account.tenant_id,paymentUrl,inv.created]);
  if(inv.status!=="paid")return;
  validatePaidAmount(inv.amount_paid,account.amount_cents,inv.currency);
  const detail=z.object({
   lines:z.object({has_more:z.literal(false),data:z.array(z.object({period:z.object({start:z.number(),end:z.number()}),amount:z.number().int()})).length(1)}),
   payments:z.object({has_more:z.literal(false),data:z.array(z.object({payment:z.object({payment_intent:z.unknown(),type:z.literal("payment_intent")})})).length(1)}),
  }).parse(inv);
  const period=detail.lines.data[0].period,intent=identifier(detail.payments.data[0].payment.payment_intent);
  if(period.end<=period.start||!intent)throw new Error("Período ou pagamento da fatura inválido.");
  const pi=await intentState(intent);
  validatePaidAmount(pi.amount_received,account.amount_cents,pi.currency);
  if(identifier(pi.customer)!==account.customer_id)throw new Error("Pagamento de outra oficina.");
  await tx(async c=>{
   await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,1232))",[account.tenant_id]);
   await confirmPayment(c,{id:inv.id,intent,tenant:account.tenant_id,price:account.price_id,amount:inv.amount_paid,start:billingDate(new Date(period.start*1000)),end:billingDate(new Date(period.end*1000)),revoked:pi.revoked,method:"card"});
  });
 }
 async function syncSubscription(id:string){
  if(!/^sub_[A-Za-z0-9]+$/.test(id))throw new Error("Assinatura inválida.");
  const sub=object.extend({latest_invoice:z.unknown(),status:z.string(),customer:z.unknown(),cancel_at_period_end:z.boolean()}).parse(await request("/subscriptions/"+id));
  const a=(await pool.query("SELECT tenant_id,customer_id FROM platform_admin.stripe_accounts WHERE subscription_id=$1",[id])).rows[0];
  if(!a)return;
  if(identifier(sub.customer)!==a.customer_id)throw new Error("Assinatura de outra oficina.");
  const invoice=identifier(sub.latest_invoice);
  if(invoice)await syncInvoice(invoice);
  await pool.query("UPDATE platform_admin.stripe_accounts SET subscription_status=$2,cancel_at_period_end=$3,subscription_id=CASE WHEN $2 IN ('canceled','incomplete_expired') THEN NULL ELSE subscription_id END WHERE subscription_id=$1",[id,sub.status,sub.cancel_at_period_end]);
 }
 async function refresh(tenant:string){
  requireTestTenant(tenant);
  const sessions=await pool.query("SELECT provider_id FROM platform_admin.stripe_checkouts WHERE tenant_id=$1 AND status IN ('open','paid') AND provider_id IS NOT NULL ORDER BY created_at DESC LIMIT 1",[tenant]);
  for(const row of sessions.rows)await syncSession(row.provider_id);
  const a=(await pool.query("SELECT subscription_id FROM platform_admin.stripe_accounts WHERE tenant_id=$1",[tenant])).rows[0];
  if(a?.subscription_id)await syncSubscription(a.subscription_id);
  return summary(tenant);
 }
 async function cancel(tenant:string){
  requireTestTenant(tenant);
  const a=(await pool.query("SELECT subscription_id FROM platform_admin.stripe_accounts WHERE tenant_id=$1",[tenant])).rows[0];
  if(!a)throw new BillingConflict("Não existe assinatura para cancelar.");
  if(a.subscription_id){
   await request("/subscriptions/"+a.subscription_id,{cancel_at_period_end:true},"cancel:"+a.subscription_id);
   await syncSubscription(a.subscription_id);
  }else await pool.query("UPDATE platform_admin.stripe_accounts SET cancel_at_period_end=true WHERE tenant_id=$1",[tenant]);
  await tx(c=>audit(c,tenant,"stripe.subscription.cancel_requested",{reason:"Cancelamento da renovação solicitado pelo proprietário."}));
  return summary(tenant);
 }
 async function webhook(event:{id:string;type:string;data:{object:{id:string}}}){
  if((await pool.query("SELECT 1 FROM platform_admin.stripe_events WHERE id=$1",[event.id])).rowCount)return;
  const id=event.data.object.id;
  if(event.type.startsWith("checkout.session."))await syncSession(id);
  else if(event.type.startsWith("invoice."))await syncInvoice(id);
  else if(event.type.startsWith("customer.subscription."))await syncSubscription(id);
  else if(event.type==="charge.refunded"||event.type.startsWith("charge.dispute.")){
   // Re-query current charge; notification payloads never decide access.
   const resource=z.object({payment_intent:z.unknown()}).parse(await request((event.type==="charge.refunded"?"/charges/":"/disputes/")+id));
   const intent=identifier(resource.payment_intent);
   if(intent){
    const pi=await intentState(intent);
    if(pi.revoked)await tx(async c=>{
     const p=(await c.query("SELECT tenant_id FROM platform_admin.stripe_payments WHERE payment_intent_id=$1 FOR UPDATE",[intent])).rows[0];
     if(!p)return;
     await c.query("UPDATE platform_admin.stripe_payments SET status='refunded' WHERE payment_intent_id=$1",[intent]);
     await c.query("UPDATE platform_admin.stripe_accounts SET paid_until=(SELECT max(period_end) FROM platform_admin.stripe_payments WHERE tenant_id=$1 AND status='paid'),due_on=LEAST(due_on,(now() AT TIME ZONE 'America/Sao_Paulo')::date-1) WHERE tenant_id=$1",[p.tenant_id]);
     await audit(c,p.tenant_id,"stripe.payment.revoked",{payment_intent_id:intent});
    });
   }
  }
  await pool.query("INSERT INTO platform_admin.stripe_events(id,event_type,resource_id) VALUES($1,$2,$3) ON CONFLICT(id) DO NOTHING",[event.id,event.type,id]);
 }
 async function renew(){
  // Bounded daily reconciliation. SKIP LOCKED plus retry_after distributes consecutive executions.
  const rows=await tx(async c=>(await c.query("UPDATE platform_admin.stripe_accounts SET retry_after=now()+interval '1 day' WHERE tenant_id IN (SELECT tenant_id FROM platform_admin.stripe_accounts WHERE managed AND tenant_id=ANY($1::text[]) AND (retry_after IS NULL OR retry_after<now()) ORDER BY retry_after NULLS FIRST LIMIT 10 FOR UPDATE SKIP LOCKED) RETURNING tenant_id,billing_email,price_id,method,cancel_at_period_end,due_on::text",[[...allowed]])).rows);
  let completed=0,failed=0;
  for(const a of rows){
   try{
    await refresh(a.tenant_id);
    if(a.method==="pix"&&!a.cancel_at_period_end&&a.due_on<=billingDate(new Date()))
     await checkout(a.tenant_id,a.billing_email,{price_id:a.price_id,method:"pix"},true);
    completed++;
   }catch{failed++;await pool.query("UPDATE platform_admin.stripe_accounts SET retry_after=now()+interval '1 hour' WHERE tenant_id=$1",[a.tenant_id]);}
  }
  return {completed,failed};
 }
 return {summary,overview,savePrice,checkout,refresh,cancel,webhook,renew,syncSession,syncInvoice,syncSubscription};
}
