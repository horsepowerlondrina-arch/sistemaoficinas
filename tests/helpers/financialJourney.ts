import assert from 'node:assert/strict';

export type FinancialCall = (method: string, path: string, body?: any) => Promise<{ status: number; ok: boolean; body: any }>;
export type FinancialFixture = {
  plan: string; marker: string; day: string; nextBankingDay: string;
  customer: string; vehicle: string; product?: string; service: string;
  machine?: string; secondaryMachine?: string;
  account: (key: string) => Promise<string>;
};
export type FinancialHooks = {
  configure?: (key: string, order: string, input: any) => Promise<boolean>;
  settleCredit?: (key: string, order: string, account: string) => Promise<boolean>;
  capture?: (key: string, order: string) => Promise<void>;
};

// HTTP-only harness: live runs use authenticated fictional accounts; CI uses loopback.
// Expected amounts below are fixed independent cent-level oracles, not the payment implementation.
export async function financialJourney(call: FinancialCall, f: FinancialFixture, state: any, save: () => void, hooks: FinancialHooks = {}) {
  const api = async (method: string, path: string, body?: any) => {
    const r = await call(method,path,body); assert.ok(r.ok,`${method} ${path}: HTTP ${r.status} ${String(r.body?.error||'').slice(0,180)}`); return r.body;
  };
  const ws = () => api('GET','/workspace');
  const getOrder = async (key:string) => (await ws()).orders.find((o:any)=>o.id===state[key]?.order);
  const ensureOrder = async (key:string) => {
    const s=state[key] ||= {}; const notes=f.marker+' '+key;
    if(!s.order){s.order=(await ws()).orders.find((o:any)=>o.notes===notes)?.id;
      if(!s.order)s.order=(await api('POST','/orders',{customer_id:f.customer,vehicle_id:f.vehicle,status:'open',entered_on:f.day,due_on:f.day,km:12345,problem:'Teste financeiro fictício',notes,discount:0,items:[f.product?{catalog_id:f.product,quantity:1,price:10001}:{workshop_service_id:f.service,quantity:1,price:10001}]})).id;
      save();
    }
    const order=await getOrder(key);assert.equal(order.customer_id,f.customer);assert.equal(order.vehicle_id,f.vehicle);
    for(const [before,status] of [['open','working'],['working','ready'],['ready','completed']]) if((await getOrder(key)).status===before)await api('POST',`/orders/${s.order}/status`,{status});
    assert.equal((await getOrder(key)).status,'completed');
    return s;
  };
  const denied = async (method:string,path:string,body?:any) => {const r=await call(method,path,body);assert.ok([400,403,404].includes(r.status),`UNEXPECTED_ACCEPTANCE ${path}: ${r.status}`);return r;};
  const results:any[]=[];
  const terms={installments:1,card_fee_bps:0,interest_bps:0,first_due_on:f.day,sale_on:f.day,pass_card_fee:false};
  if(f.plan==='basic'){
    const blocked=await ensureOrder('basic-plan-gates');
    for(const method of ['Cartão de débito','Cartão de crédito','Misto']) await denied('POST',`/orders/${blocked.order}/basic-receipt`,{method});
    for(const path of ['/card-machines','/expenses','/cash-control'])assert.equal((await call('GET',path)).status,403);
    assert.equal((await call('POST','/receivables/not-exposed/plan',{...terms,method:'Boleto',installments:3})).status,403);
    assert.equal((await getOrder('basic-plan-gates')).payment_status,'open');
    results.push({scenario:'basic-plan-gates',status:'passed',card:false,installments:false,mixed:false});
    const s=await ensureOrder('basic-reversal');
    if(!s.initialPaid){if((await getOrder('basic-reversal')).payment_status!=='paid')await api('POST',`/orders/${s.order}/basic-receipt`,{method:'Pix'});s.initialPaid=true;save();}
    if(!s.reversed){
      await denied('POST',`/orders/${s.order}/status`,{status:'working'});
      if((await getOrder('basic-reversal')).status==='completed')await api('POST',`/orders/${s.order}/status`,{status:'working',reversal_reason:'Estorno fictício para conferência do histórico financeiro'});
      const reopened=await getOrder('basic-reversal');assert.equal(reopened.status,'working');assert.ok(!reopened.receivable_id && reopened.payment_status!=='paid');s.reversed=true;save();
    }
    if(!s.repaid){
      if((await getOrder('basic-reversal')).status!=='completed')await api('POST',`/orders/${s.order}/status`,{status:'completed'});
      if((await getOrder('basic-reversal')).payment_status!=='paid')await api('POST',`/orders/${s.order}/basic-receipt`,{method:'Transferência'});
      s.repaid=true;save();
    }
    await denied('POST',`/orders/${s.order}/basic-receipt`,{method:'Pix'});
    assert.equal((await getOrder('basic-reversal')).payment_method,'Transferência');
    await hooks.capture?.('basic-reversal',s.order);
    results.push({scenario:'basic-reversal',status:'passed',order:s.order,reversed:true,paidAgain:true,total:10001});
    return results;
  }
  const card=(method:string,n:number,fee:number,pass=false)=>({...terms,method,installments:n,card_fee_bps:fee,machine_id:f.machine,pass_card_fee:pass});
  const mix={payments:[{...terms,method:'Pix',amount:4001},{...card('Cartão de crédito',3,350),amount:6000}]};
  const cases=[
    {key:'debit',input:card('Cartão de débito',1,150),gross:10001,fee:150,net:9851,n:1,balance:9851,pending:0},
    {key:'credit-one',input:card('Cartão de crédito',1,250),gross:10001,fee:250,net:9751,n:1,balance:0,pending:9751},
    {key:'credit-three',input:card('Cartão de crédito',3,350),gross:10001,fee:350,net:9651,n:3,balance:0,pending:9651},
    {key:'credit-pass',input:card('Cartão de crédito',3,350,true),gross:10364,fee:363,net:10001,n:3,balance:0,pending:10001},
    {key:'mixed-pix-first',input:mix,gross:10001,fee:210,net:9791,n:4,balance:4001,pending:5790},
    {key:'mixed-card-first',input:mix,gross:10001,fee:210,net:9791,n:4,balance:4001,pending:5790},
    {key:'mixed-pass',input:{payments:[mix.payments[0],{...mix.payments[1],pass_card_fee:true}]},gross:10219,fee:218,net:10001,n:4,balance:4001,pending:6000},
    {key:'mixed-pass-interest',input:{payments:[mix.payments[0],{...mix.payments[1],pass_card_fee:true,interest_bps:1000}]},gross:10840,fee:239,net:10601,n:4,balance:4001,pending:6600},
    {key:'boleto-three',input:{...terms,method:'Boleto',installments:3,interest_bps:1000},gross:11001,fee:0,net:11001,n:3,balance:11001,pending:0},
    {key:'concurrent-pix',input:{...terms,method:'Pix'},gross:10001,fee:0,net:10001,n:1,balance:10001,pending:0},
    {key:'discount-card',input:{...card('Cartão de crédito',3,350),discount:{mode:'percent',value:1000}},gross:9001,fee:315,net:8686,n:3,balance:0,pending:8686},
  ];
  for(const spec of cases){
    const s=await ensureOrder(spec.key);s.account ||= await f.account(spec.key);save();
    let w=await ws(),r=w.receivables.find((r:any)=>r.order_id===s.order);assert.ok(r);s.receivable=r.id;save();
    if(!r.plan_configured){
      if(!await hooks.configure?.(spec.key,s.order,spec.input))await api('POST',`/receivables/${r.id}/plan`,spec.input);
    }
    w=await ws();r=w.receivables.find((r:any)=>r.id===s.receivable);let parts=w.installments.filter((p:any)=>p.receivable_id===r.id);
    assert.equal(parts.length,spec.n);assert.equal(r.gross_total,spec.gross);assert.equal(r.fee_total,spec.fee);assert.equal(r.net_total,spec.net);
    for(const [field,total] of [['gross',spec.gross],['fee',spec.fee],['net',spec.net]] as const)assert.equal(parts.reduce((sum:number,p:any)=>sum+Number(p[field]),0),total);
    assert.equal(parts.reduce((sum:number,p:any)=>sum+Number(p.principal),0),spec.key==='discount-card'?9001:10001);
    for(const p of parts)assert.ok(Number.isInteger(p.net)&&p.net>=0);
    if(spec.key==='credit-three')assert.deepEqual(parts.map((p:any)=>p.gross).sort(),[3333,3334,3334]);
    if(spec.key==='credit-pass')assert.equal(parts.reduce((sum:number,p:any)=>sum+p.net,0),10001);
    if(spec.key==='discount-card'){const o=await getOrder(spec.key);assert.equal(o.total,9001);assert.equal(o.discount,1000);}
    if(!s.negatives){
      const before=JSON.stringify(parts);
      for(const input of [card('Cartão de crédito',2,350),card('Cartão de crédito',5,350),{...card('Cartão de crédito',3,350),card_fee_bps:900},
        {payments:[{...terms,method:'Pix',amount:10000}]},{payments:[{...terms,method:'Pix',amount:5000},{...terms,method:'Pix',amount:5001}]}])await denied('POST',`/receivables/${r.id}/plan`,input);
      assert.equal(JSON.stringify((await ws()).installments.filter((p:any)=>p.receivable_id===r.id)),before,'invalid plans do not replace existing installments');s.negatives=true;save();
    }
    const nonCard=()=>parts.filter((p:any)=>p.method!=='Cartão de crédito'&&p.status==='open');
    const payPart=async(p:any)=>{await api('POST',`/installments/${p.id}/settle`,{account_id:s.account});};
    const payCard=async()=>{
      if(!parts.some((p:any)=>p.method==='Cartão de crédito'&&p.status==='open'))return;
      if(!await hooks.settleCredit?.(spec.key,s.order,s.account))await api('POST',`/receivables/${r.id}/settle-credit`,{account_id:s.account});
    };
    if(r.status!=='paid'){
      if(spec.key==='concurrent-pix'){
        const outcomes=await Promise.all([call('POST',`/installments/${parts[0].id}/settle`,{account_id:s.account}),call('POST',`/installments/${parts[0].id}/settle`,{account_id:s.account})]);
        assert.equal(outcomes.filter(x=>x.ok).length,1);assert.equal(outcomes.filter(x=>x.status===400).length,1);
      }else{
        if(spec.key==='mixed-card-first')await payCard();
        for(const part of nonCard()){
          await payPart(part);
          if(spec.key==='boleto-three'){
            const current=await ws(),open=current.installments.filter((p:any)=>p.receivable_id===r.id&&p.status==='open');
            const currentReceipt=current.receivables.find((v:any)=>v.id===r.id);
            assert.equal(currentReceipt.status,open.length?'open':'paid');
            assert.equal(currentReceipt.balance,open.reduce((sum:number,p:any)=>sum+p.gross,0));
          }
          if(spec.key==='mixed-pix-first'){
            assert.equal((await ws()).receivables.find((v:any)=>v.id===r.id).status,'open');
            await denied('POST',`/receivables/${r.id}/plan`,spec.input);
          }
        }
        if(spec.key!=='mixed-card-first')await payCard();
      }
    }
    w=await ws();r=w.receivables.find((r:any)=>r.id===s.receivable);parts=w.installments.filter((p:any)=>p.receivable_id===r.id);
    assert.equal(r.status,'paid');assert.equal(r.balance,0);assert.ok(parts.every((p:any)=>p.status==='paid'));
    const cash=await api('GET','/cash-control'),account=cash.accounts.find((a:any)=>a.id===s.account),moves=cash.movements.filter((m:any)=>m.account_id===s.account);
    assert.equal(account.balance,spec.balance);assert.equal(account.pending_receipts,spec.pending);
    assert.equal(moves.reduce((sum:number,m:any)=>sum+m.amount,0),spec.net);
    assert.equal(moves.reduce((sum:number,m:any)=>sum+m.fee_amount,0),spec.fee);
    for(const m of moves.filter((m:any)=>m.method==='Cartão de crédito'))assert.equal(m.day,f.nextBankingDay);
    const before=JSON.stringify({parts,moves,order:await getOrder(spec.key)});
    await denied('POST',`/receivables/${r.id}/plan`,spec.input);
    if(parts.some((p:any)=>p.method==='Cartão de crédito'))await denied('POST',`/receivables/${r.id}/settle-credit`,{account_id:s.account});
    else await denied('POST',`/installments/${parts[0].id}/settle`,{account_id:s.account});
    const refund=await denied('POST',`/orders/${s.order}/status`,{status:'working',reversal_reason:'Tentativa fictícia de estorno após recebimento'});
    const afterCash=await api('GET','/cash-control');const after=await ws();
    assert.equal(JSON.stringify({parts:after.installments.filter((p:any)=>p.receivable_id===r.id),moves:afterCash.movements.filter((m:any)=>m.account_id===s.account),order:await getOrder(spec.key)}),before);
    await hooks.capture?.(spec.key,s.order);
    results.push({scenario:spec.key,status:'passed',order:s.order,gross:spec.gross,fee:spec.fee,net:spec.net,installments:spec.n,balance:account.balance,pending:account.pending_receipts,paidReversal:'not_implemented_safely_blocked',reversalMessage:refund.body?.error});
  }
  const key='unpaid-reversal';const s=state[key] ||= {};
  if(!s.reversed){
    await ensureOrder(key);const w=await ws();const before=w.catalog.find((p:any)=>p.id===f.product).stock;
    const old=w.receivables.find((r:any)=>r.order_id===s.order);s.oldReceivable=old.id;save();
    await api('POST',`/receivables/${old.id}/plan`,card('Cartão de crédito',3,350));
    await api('POST',`/orders/${s.order}/status`,{status:'working'});
    const reopened=await ws();assert.equal(reopened.catalog.find((p:any)=>p.id===f.product).stock,before+1);
    assert.ok(!reopened.receivables.some((r:any)=>r.id===old.id));assert.ok(!reopened.installments.some((p:any)=>p.receivable_id===old.id));s.reversed=true;save();
  }
  if((await getOrder(key)).status!=='completed')await api('POST',`/orders/${s.order}/status`,{status:'completed'});
  let w=await ws();let r=w.receivables.find((r:any)=>r.order_id===s.order);assert.notEqual(r.id,s.oldReceivable);
  s.account ||= await f.account(key);save();
  if(r.status!=='paid'){
    if(!r.plan_configured)await api('POST',`/receivables/${r.id}/plan`,card('Cartão de débito',1,150));
    const part=(await ws()).installments.find((p:any)=>p.receivable_id===r.id);await api('POST',`/installments/${part.id}/settle`,{account_id:s.account});
  }
  assert.equal((await api('GET','/cash-control')).accounts.find((a:any)=>a.id===s.account).balance,9851);
  results.push({scenario:key,status:'passed',order:s.order,stockRestored:true,obsoletePlanRemoved:true,paidAgain:true});
  const original=(await api('GET','/card-machines')).find((m:any)=>m.id===f.machine);
  const body={name:original.name,operator:original.operator,active:!!original.active,is_default:!!original.is_default,max_installments:original.max_installments,rates:original.rates.map((v:any)=>({method:v.method,installments:v.installments,fee_bps:v.fee_bps}))};
  const historicalBefore=(await ws()).installments.filter((p:any)=>p.receivable_id===state['credit-three'].receivable);
  try{
    await api('PUT',`/card-machines/${f.machine}`,{...body,rates:body.rates.map((v:any)=>v.installments===3?{...v,fee_bps:900}:v)});
    await denied('POST',`/receivables/${state['credit-three'].receivable}/preview`,card('Cartão de crédito',3,350));
    await api('PUT',`/card-machines/${f.machine}`,{...body,active:false,is_default:false});
    await denied('POST',`/receivables/${state['credit-three'].receivable}/preview`,card('Cartão de crédito',3,350));
    assert.deepEqual((await ws()).installments.filter((p:any)=>p.receivable_id===state['credit-three'].receivable),historicalBefore);
  }finally{await api('PUT',`/card-machines/${f.machine}`,body);}
  results.push({scenario:'machine-history',status:'passed',ratesAndNamesPreserved:true,inactiveMachineRejected:true});
  return results;
}
