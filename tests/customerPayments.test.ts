import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createDatabase} from '../server/db/database';
import {createShare,readShare} from '../server/services/sharing';
import {configurePlan,settleCredit,settleInstallment} from '../server/services/payments';
import {customerPayments} from '../shared/customerPayments';
import {issueDocument} from '../server/services/documents';
import {OrderPrint} from '../src/components/OrderPrint';
const ctx={tenantId:'a',userId:'u',role:'owner'};
test('issued customer links freeze mixed payment totals and revisions expose only gross data',async()=>{
 const db=createDatabase(':memory:');
 db.exec("INSERT INTO tenants(id,name) VALUES('a','Oficina'); INSERT INTO users VALUES('u','Admin','admin@test.invalid','disabled'); INSERT INTO memberships VALUES('u','a','owner'); INSERT INTO customers(id,tenant_id,name) VALUES('c','a','Cliente Completo'); INSERT INTO vehicles(id,tenant_id,customer_id,plate,brand,model,year) VALUES('v','a','c','ABC1D23','Fiat','Uno',2020); INSERT INTO orders(id,tenant_id,number,status,customer_id,vehicle_id,entered_on,due_on,km,total,notes) VALUES('o','a',1,'completed','c','v','2026-10-14','2026-10-14',0,10000,'INTERNAL SECRET'); INSERT INTO receivables(id,tenant_id,order_id,customer_id,description,amount,due_on) VALUES('r','a','o','c','OS #1',10000,'2026-10-14'); INSERT INTO cash_accounts(id,tenant_id,name,kind,opening_balance,opening_on) VALUES('bank','a','PRIVATE BANK','bank',0,'2026-10-01')");
 try{
  const share=await createShare(db,ctx,'o'),token=share.path.slice(3);
  assert.equal((await readShare(db,token))!.payment_summary,null);
  const terms={installments:1,card_fee_bps:0,interest_bps:0,first_due_on:'2026-10-14'};
  await configurePlan(db,ctx,'r',{payments:[{...terms,method:'Pix',amount:2000},{...terms,method:'Cartão de crédito',amount:8000,installments:3,card_fee_bps:1000,sale_on:'2026-10-14'}]});
  const pix=db.prepare("SELECT id FROM payment_installments WHERE method='Pix'").get()!;
  await settleInstallment(db,ctx,String(pix.id),'bank');
  assert.equal((await readShare(db,token))!.payment_summary,null);
  const partialDoc=await issueDocument(db,ctx,'order','o',true);
  const partialShare=await createShare(db,ctx,'o',partialDoc.revision);
  const partialToken=partialShare.path.slice(3);
  const partial=(await readShare(db,partialToken))!.payment_summary!;
  assert.equal(partial.status,'partial');assert.equal(partial.paid,2000);assert.equal(partial.balance,8000);
  await settleCredit(db,ctx,'r','bank');
  assert.equal((await readShare(db,partialToken))!.payment_summary!.status,'partial');
  const paidDoc=await issueDocument(db,ctx,'order','o',true);
  const paidShare=await createShare(db,ctx,'o',paidDoc.revision);
  const out=(await readShare(db,paidShare.path.slice(3)))!;
  assert.equal(out.payment_summary!.status,'paid');assert.equal(out.payment_summary!.paid,10000);assert.equal(out.payment_summary!.balance,0);
  const credit=out.payment_summary!.payments.find(p=>p.method==='Cartão de crédito')!;
  assert.equal(credit.amount,8000);assert.equal(credit.date,'2026-10-14');assert.equal(credit.installments,3);
  const json=JSON.stringify(out);for(const secret of ['PRIVATE BANK','INTERNAL SECRET','fee','net','account_id','receivable_id'])assert.ok(!json.includes(secret));
 }finally{db.close();}
});
test('print and public PDF markup contain the same paid summary and never label a paid OS as total payable',()=>{
 const summary=customerPayments('completed',{id:'r',amount:10000,plan_configured:1,gross_total:10500},[{receivable_id:'r',method:'Pix',gross:10500,status:'paid',paid_at:'2026-10-15T01:30:00Z'}])!;
 assert.equal(summary.payments[0].date,'2026-10-14');
 for(const publicView of [true,false]){
  const html=renderToStaticMarkup(React.createElement(OrderPrint,{publicView,tenant:{id:'a',name:'Oficina'},order:{id:'o',number:1,status:'completed',items:[],payment_summary:summary}}));
  assert.ok(html.includes('PAGO · OS QUITADA'));assert.ok(html.includes('Pix'));assert.ok(html.includes('14/10/2026'));assert.ok(html.includes('Saldo a pagar:'));assert.ok(!html.includes('TOTAL A PAGAR:'));
 }
 assert.equal(customerPayments('quote',{id:'r',status:'paid'},[]),null);
 assert.equal(customerPayments('completed',undefined,[]),null);
});
