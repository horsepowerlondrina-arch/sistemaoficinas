import test from 'node:test';
import assert from 'node:assert/strict';
import {createDatabase} from '../server/db/database';
import {configurePlan,settleCredit,settleInstallment} from '../server/services/payments';
import {calculatePaymentPlan} from '../server/domain/payments';
import {createApp} from '../server/app';
import {digest} from '../server/auth/session';
const ctx={tenantId:'a',userId:'u',role:'owner'};
const terms={installments:1,card_fee_bps:0,interest_bps:0,first_due_on:'2026-10-09'};
const mixed=()=>({payments:[{...terms,method:'Pix',amount:20000},{...terms,method:'Cartão de crédito',amount:50000,installments:3,card_fee_bps:1000,sale_on:'2026-10-09'}]});
function fixture(){const db=createDatabase(':memory:');db.exec("INSERT INTO tenants(id,name) VALUES('a','A'),('b','B'); INSERT INTO users VALUES('u','Admin','admin@test.invalid','disabled'); INSERT INTO memberships VALUES('u','a','owner'); INSERT INTO customers(id,tenant_id,name) VALUES('c','a','Cliente'); INSERT INTO vehicles(id,tenant_id,customer_id,plate,brand,model,year) VALUES('v','a','c','ABC1D23','Fiat','Uno',2020); INSERT INTO orders(id,tenant_id,number,status,customer_id,vehicle_id,entered_on,due_on,km,total) VALUES('o','a',1,'completed','c','v','2026-10-09','2026-10-09',0,70000); INSERT INTO receivables(id,tenant_id,order_id,customer_id,description,amount,due_on) VALUES('r','a','o','c','OS #1',70000,'2026-10-09'); INSERT INTO cash_accounts(id,tenant_id,name,kind,opening_balance,opening_on) VALUES('bank','a','Banco','bank',0,'2026-10-01'),('cash','a','Dinheiro','cash',0,'2026-10-01'),('foreign','b','Outro','bank',0,'2026-10-01')");db.exec("INSERT INTO card_machines(id,tenant_id,name,name_key,operator,is_default,max_installments) VALUES('fixture-card','a','Máquina fictícia','máquina fictícia','Operadora fictícia',1,12);INSERT INTO card_machine_rates VALUES('a','fixture-card','Cartão de crédito',3,1000);");
  return db;}
test('mixed payments conserve principal and fees, settle independently in both orders and keep credit installments',async()=>{
 for(const creditFirst of [true,false]){
  const db=fixture();try{
   const plan=await configurePlan(db,ctx,'r',mixed());
   assert.equal(plan.base,70000);assert.equal(plan.gross,70000);assert.equal(plan.fee,5000);assert.equal(plan.net,65000);
   const rows=db.prepare('SELECT * FROM payment_installments ORDER BY sequence').all();assert.equal(rows.length,4);
   assert.equal(rows.reduce((s,p)=>s+Number(p.principal),0),70000);
   const pix=rows.find(p=>p.method==='Pix')!;
   if(creditFirst){
    await assert.rejects(settleCredit(db,ctx,'r','foreign'),/nesta oficina/);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM cash_entries').get()!.n,0);
    await settleCredit(db,ctx,'r','bank');
    assert.equal(db.prepare('SELECT status FROM payment_installments WHERE id=?').get(pix.id)!.status,'open');
    assert.equal(db.prepare('SELECT status FROM receivables').get()!.status,'open');
    await settleInstallment(db,ctx,String(pix.id),'cash');
   }else{
    await settleInstallment(db,ctx,String(pix.id),'cash');
    assert.equal(db.prepare('SELECT due_on FROM receivables').get()!.due_on,'2026-10-13');
    await settleInstallment(db,ctx,String(rows.find(p=>p.method==='Cartão de crédito')!.id),'bank');
   }
   assert.equal(db.prepare('SELECT status FROM receivables').get()!.status,'paid');
   const cash=db.prepare('SELECT * FROM cash_movements ORDER BY method').all();
   assert.equal(cash.length,2);
   const card=cash.find(p=>p.method==='Cartão de crédito')!;
   assert.equal(card.account_id,'bank');assert.equal(card.amount,45000);assert.equal(card.fee_amount,5000);assert.equal(card.day,'2026-10-13');
   const instant=cash.find(p=>p.method==='Pix')!;assert.equal(instant.account_id,'cash');assert.equal(instant.amount,20000);
   assert.equal(db.prepare("SELECT COUNT(*) n FROM payment_installments WHERE status='paid'").get()!.n,4);
   await assert.rejects(settleCredit(db,ctx,'r','bank'),/já foi recebido/);
   await assert.rejects(settleInstallment(db,ctx,String(pix.id),'cash'),/já foi recebida/);
   await assert.rejects(configurePlan(db,ctx,'r',mixed()),/após um recebimento/);
  }finally{db.close();}
 }
});
test('sum mismatches repeated methods and invalid plans cannot replace an existing plan',async()=>{
 const db=fixture();try{
  await configurePlan(db,ctx,'r',{...terms,method:'Pix'});
  const before=db.prepare('SELECT * FROM payment_installments').all();
  const bad=mixed();bad.payments[0].amount=19999;
  await assert.rejects(configurePlan(db,ctx,'r',bad),/soma/);
  assert.deepEqual(db.prepare('SELECT * FROM payment_installments').all(),before);
  const repeat=mixed();repeat.payments[1].method='Pix';
  await assert.rejects(configurePlan(db,ctx,'r',repeat),/uma vez/);
  await assert.rejects(configurePlan(db,{...ctx,role:'operator'},'r',mixed()),/administrador/);
  await assert.rejects(configurePlan(db,{...ctx,tenantId:'b'},'r',mixed()),/nesta oficina/);
  const plan=calculatePaymentPlan(70000,{payments:[{...terms,method:'Pix',amount:20000},{...terms,method:'Cartão de crédito',amount:50000,installments:3,card_fee_bps:1000,interest_bps:200,pass_card_fee:true}]});
  assert.equal(plan.net,71000);assert.equal(plan.plans[0].fee,0);assert.equal(plan.plans[1].net,51000);
  await configurePlan(db,ctx,'r',mixed());assert.equal(db.prepare('SELECT method FROM receivables').get()!.method,'Misto');
 }finally{db.close();}
});
test('receipt API validates and persists a mixed plan and preview does not write',async()=>{
 const db=fixture();db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(digest('owner'),'u','a',Date.now()+60000);
 const server=createApp(db).listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
 const base=`http://127.0.0.1:${(server.address() as any).port}/api/receivables/r`;
 const post=(path:string,body:any)=>fetch(base+path,{method:'POST',headers:{Cookie:'hp_session=owner','Content-Type':'application/json'},body:JSON.stringify(body)});
 try{
  const preview=await post('/preview',mixed());assert.equal(preview.status,200);assert.equal((await preview.json()).plans.length,2);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM payment_installments').get()!.n,0);
  const bad=mixed();bad.payments[0].amount=0;const invalid=await post('/plan',bad);assert.equal(invalid.status,400);await invalid.text();
  const saved=await post('/plan',mixed());assert.equal(saved.status,200);await saved.text();
  assert.equal(db.prepare('SELECT COUNT(*) n FROM payment_installments').get()!.n,4);
 }finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));db.close();}
});

