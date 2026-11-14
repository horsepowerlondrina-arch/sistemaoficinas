import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

/** Full operational API regression. Caller must provide a disposable loopback app. */
export async function operationalJourney(origin: string, cookie: string, plan: string, foreignOrder?: string) {
  const url = new URL(origin);
  assert.equal(url.hostname, '127.0.0.1');
  const request = (method: string, path: string, data?: unknown) => fetch(origin + '/api' + path, {
    method, headers: { Cookie: cookie, Origin: 'http://127.0.0.1:5173', 'Content-Type': 'application/json' },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const api = async (method: string, path: string, data?: unknown) => {
    const r = await request(method, path, data); assert.ok(r.ok, `${method} ${path} returned ${r.status}`); return r.json();
  };
  const workspace = () => api('GET', '/workspace');
  const modules = (await api('GET', '/session')).modules;
  const marker = randomUUID().slice(0,8), day = new Intl.DateTimeFormat('en-CA', { timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit' }).format(new Date());
  const created = await api('POST','/customers-with-vehicle',{
    customer:{name:'Cliente Fictício Operacional '+marker,phone:'00000000000',email:marker+'@example.test',address:'Rua Fictícia',notes:'',document:''},
    vehicle:{plate:['QAQ1A11','QAQ1A12','QAQ1A13'][['basic','professional','premium'].indexOf(plan)],brand:'Marca Fictícia',model:'Modelo Fictício',year:2025,model_year:2026,km:12345,service_model_id:null,service_link_mode:'none'},
  });
  const w = await workspace(), vehicle = w.vehicles.find((v:any)=>v.id===created.vehicle_id);
  assert.equal(vehicle.customer_id,created.id); assert.equal(vehicle.model_year,2026);
  const checklist = await api('POST','/checklists',{plate:vehicle.plate,vehicle_data:{...vehicle,service_model_id:null},customer_id:created.id,km:12345,fuel_level:50,inspector:'Inspetor Fictício'});
  assert.equal((await request('POST',`/checklists/${checklist.id}/finalize`,{})).status,400,'unsigned checklist cannot finalize');
  await api('PUT',`/checklists/${checklist.id}`,{km:12345,fuel_level:50,inspector:'Inspetor Fictício',complaint:'Ruído fictício',conditions:{'Rodas e pneus':'ok'},signature_absent_reason:'Execução fictícia automatizada',customer_confirmed:true});
  const finalChecklist = await api('POST',`/checklists/${checklist.id}/finalize`,{});
  assert.equal(finalChecklist.created_quote,true); const orderId = finalChecklist.order_id;
  await api('POST','/product-categories',{name:'Testes '+marker,request_id:randomUUID()});
  const product = await api('POST','/catalog',{kind:'product',name:'Peça Fictícia '+marker,sku:marker,category:'Testes '+marker,cost:2000,price:5000,stock:0,minimum_stock:2});
  const service = await api('POST','/workshop-services',{service_type:'private',name:'Serviço Fictício '+marker,price:10000,cost:3000,cost_known:true});
  if (modules.inventory) {
    const input={quantity:10,reason:'Entrada fictícia automatizada',cost:2000,price:5000,request_id:randomUUID()};
    await api('POST',`/stock/${product.id}`,input);await api('POST',`/stock/${product.id}`,input);
    assert.equal((await workspace()).catalog.find((p:any)=>p.id===product.id).stock,10,'repeated request does not duplicate stock');
  } else assert.equal((await request('POST',`/stock/${product.id}`,{quantity:1,reason:'Acesso não contratado'})).status,403);
  const input={customer_id:created.id,vehicle_id:created.vehicle_id,status:'quote',entered_on:day,due_on:day,km:12345,problem:'Teste fictício',notes:'',discount:1000,items:[{catalog_id:product.id,quantity:2,price:5000},{workshop_service_id:service.id,quantity:1,price:10000}]};
  await api('PUT',`/orders/${orderId}`,input);
  let order=(await workspace()).orders.find((o:any)=>o.id===orderId);assert.equal(order.total,19000);assert.equal(order.status,'quote');
  const invalidDiscount=await request('PUT',`/orders/${orderId}`,{...input,discount:20001});assert.equal(invalidDiscount.status,400);
  assert.equal((await workspace()).orders.find((o:any)=>o.id===orderId).total,19000,'invalid edit rolls back');
  for (const status of ['open','working','ready','completed']) await api('POST',`/orders/${orderId}/status`,{status,due_on:day});
  order=(await workspace()).orders.find((o:any)=>o.id===orderId);assert.equal(order.status,'completed');
  if (modules.inventory) assert.equal((await workspace()).catalog.find((p:any)=>p.id===product.id).stock,8);
  assert.equal((await request('PUT',`/orders/${orderId}`,input)).status,400,'completed order cannot be edited');
  if (modules.finance) {
    const r=(await workspace()).receivables.find((r:any)=>r.order_id===orderId);assert.equal(r.amount,19000);
    const account=await api('POST','/cash-accounts',{name:'Caixa Fictício '+marker,kind:'cash',opening_balance:0,opening_on:day,active:1,request_id:randomUUID()});
    await api('POST',`/receivables/${r.id}/plan`,{method:'Pix',installments:1,card_fee_bps:0,interest_bps:0,first_due_on:day});
    const part=(await workspace()).installments.find((p:any)=>p.receivable_id===r.id);
    await api('POST',`/installments/${part.id}/settle`,{account_id:account.id});
    assert.equal((await request('POST',`/installments/${part.id}/settle`,{account_id:account.id})).status,400);
    const payable=await api('POST','/payables',{description:'Despesa Fictícia '+marker,supplier:'Fornecedor Fictício',category:'Testes',amount:2500,due_on:day,notes:''});
    await api('POST',`/payables/${payable.id}/pay`,{paid_on:day,method:'Pix',account_id:account.id});
    assert.equal((await api('GET','/cash-control')).accounts.find((a:any)=>a.id===account.id).balance,16500);
    assert.equal((await request('POST',`/receivables/${r.id}/discount`,{mode:'money',value:2000})).status,400,'settled commercial history cannot change');
  } else {
    assert.equal((await request('GET','/expenses')).status,403);
    await api('POST',`/orders/${orderId}/basic-receipt`,{method:'Pix'});
    assert.equal((await request('POST',`/orders/${orderId}/basic-receipt`,{method:'Pix'})).status,400);
    const hidden=await workspace();assert.equal(hidden.receivables.length,0);assert.equal(hidden.cash.length,0);
  }
  assert.equal((await workspace()).orders.find((o:any)=>o.id===orderId).payment_status,'paid');
  if (foreignOrder) assert.ok([403,404].includes((await request('GET',`/documents/order/${foreignOrder}?current=1`)).status),'foreign issued document is not accessible');
  return orderId;
}
