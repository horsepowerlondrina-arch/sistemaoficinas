import { chromium, expect } from '@playwright/test';
import { readFileSync, writeFileSync, mkdirSync, lstatSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { HOMOLOGATION } from './isolated-sessions.mjs';

// Writes are opt-in and restricted to the three fictitious, activated workshops.
if (process.env.TEST_OPERATIONAL_WRITES !== 'fictitious-homologation-only') throw Error('EXPLICIT_FICTITIOUS_WRITES_REQUIRED');
const manifestPath = resolve(process.env.TEST_ONBOARDING_FILE || 'data/test-onboarding.json');
const stat = lstatSync(manifestPath);
if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) || stat.uid !== process.getuid()) throw Error('PRIVATE_MANIFEST_REQUIRED');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const expectedTenants = { basic: '26bb4fc1-276d-411c-b903-1c84c0b77299', professional: '1f866f8e-d6e0-475f-a270-1dae4b2279b1', premium: 'd0a82163-8b22-4ec6-98d4-f5495c386ee2' };
if (manifest.baseURL !== HOMOLOGATION || manifest.run !== '20261114-autonomo' || manifest.offices.length !== 3) throw Error('FICTITIOUS_MANIFEST_REQUIRED');
for (const office of manifest.offices) if (office.tenantId !== expectedTenants[office.plan] || !office.name.startsWith('Oficina Fictícia Automação ') || office.members[0].profile !== 'master' || !office.members[0].email.endsWith('@testes.osdrive.com.br')) throw Error('FICTITIOUS_MANIFEST_REQUIRED');
const run = process.env.TEST_OPERATIONAL_RUN || 'operacional-20261114';
if (!/^[a-z0-9-]{8,35}$/.test(run)) throw Error('RUN_INVALID');
const output = resolve(process.env.TEST_OPERATIONAL_OUTPUT || '../relatorios/operacionais-2026-11-14');
mkdirSync(output, { recursive: true, mode: 0o700 });
const statePath = resolve('data', run + '.json');
let state;
try { state = JSON.parse(readFileSync(statePath, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; state = { run, offices: {} }; }
if (state.run !== run) throw Error('CHECKPOINT_MISMATCH');
const save = () => writeFileSync(statePath, JSON.stringify(state, null, 2), { mode: 0o600 });
const report = { environment: HOMOLOGATION, run, startedAt: new Date().toISOString(), offices: [], productionModified: false };
const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const browser = await chromium.launch();
try {
 for (const office of manifest.offices) {
  const result = { plan: office.plan, checks: [], errors: [], evidence: [] }; report.offices.push(result);
  const s = state.offices[office.plan] ||= { steps: {}, ids: {} }; save();
  const context = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: false });
  const page = await context.newPage(); page.setDefaultTimeout(18000);
  page.on('dialog', d => d.type() === 'confirm' ? d.accept() : d.dismiss());
  const uiErrors = []; page.on('pageerror', () => uiErrors.push('PAGE_RUNTIME_ERROR'));
  const raw = async (method, path, body) => {
   if (!/^\/api\/[a-zA-Z0-9_/?=&.-]+$/.test(path) || path.includes('..')) throw Error('PATH_REFUSED');
   return context.request.fetch(HOMOLOGATION + path, { method, data: body, headers: { Origin: HOMOLOGATION }, maxRedirects: 0, timeout: 25000 });
  };
  const api = async (method, path, body) => {
   const r = await raw(method, path, body);
   if (!r.ok()) { const data = await r.json().catch(() => ({})); throw Error(`HTTP_${r.status()} ${path}: ${String(data.error || '').slice(0,300)}`); }
   return r.json();
  };
  const step = async (name, fn) => {
   const resumed = !!s.steps[name]; console.log(JSON.stringify({plan:office.plan,step:name,state:resumed?'resume':'running'}));
   if (!resumed) { await fn(); s.steps[name] = true; save(); }
   result.checks.push({ name, status: 'passed', resumed });
  };
  const shot = async name => {
   await page.getByRole('main').first().waitFor({state:'visible'});
   await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   const file = `${office.plan}-${name}.png`; await page.screenshot({ path: resolve(output,file), fullPage: true, animations: 'disabled' }); result.evidence.push(file);
  };
  const workspace = () => api('GET','/api/workspace');
  try {
   await api('POST','/api/login',{ email: office.members[0].email, password: office.members[0].password });
   const identity = await api('GET','/api/session');
   if (identity.tenant?.id !== office.tenantId || identity.tenant?.name !== office.name || identity.user?.email !== office.members[0].email || identity.access?.profile !== 'master') throw Error('IDENTITY_MISMATCH');
   const modules = identity.modules; result.modules = modules;
   await step('cliente-veiculo-interface', async () => {
    const w = await workspace(), name = `Cliente Fictício ${run} ${office.plan}`;
    const existing = w.customers.find(c => c.name === name);
    if (existing) { s.ids.customer = existing.id; s.ids.vehicle = w.vehicles.find(v => v.customer_id === existing.id)?.id; if (!s.ids.vehicle) throw Error('PARTIAL_CUSTOMER_REQUIRES_REVIEW'); return; }
    await page.goto(HOMOLOGATION+'/cadastros');
    await page.getByRole('button',{name:'Novo cliente',exact:true}).click();
    await page.getByLabel('Nome completo / razão social').fill(name);
    await page.getByLabel('Telefone / celular',{exact:true}).fill('00000000000');
    await page.getByLabel('E-mail',{exact:true}).fill(`${office.plan}-${run}@testes.osdrive.com.br`);
    await page.getByLabel('Cadastrar um veículo junto').check();
    await page.getByPlaceholder('ABC1D23',{exact:true}).fill(['QAT1A11','QAT1A12','QAT1A13'][manifest.offices.indexOf(office)]);
    await page.getByLabel('Marca *',{exact:true}).fill('Marca Fictícia');
    await page.getByLabel('Modelo *',{exact:true}).fill('Modelo Fictício Operacional');
    await page.getByLabel('Ano de fabricação *',{exact:true}).fill('2025');
    await page.getByLabel('Ano do modelo',{exact:true}).fill('2026');
    const [r] = await Promise.all([page.waitForResponse(r=>r.url().endsWith('/api/customers-with-vehicle')&&r.request().method()==='POST'),page.getByRole('button',{name:'Salvar cadastro',exact:true}).click()]);
    if (!r.ok()) throw Error('CUSTOMER_UI_SAVE_FAILED');
    const created = await r.json(); s.ids.customer=created.id; s.ids.vehicle=created.vehicle_id; save();
    await expect(page.getByRole('dialog')).toHaveCount(0); await shot('cliente');
   });
   await step('cliente-veiculo-edicao-persistencia', async () => {
    let w=await workspace(); const customer=w.customers.find(c=>c.id===s.ids.customer), vehicle=w.vehicles.find(v=>v.id===s.ids.vehicle);
    if(!customer || !vehicle || vehicle.customer_id!==customer.id || vehicle.model_year!==2026) throw Error('IDENTITY_NOT_PERSISTED');
    await api('PUT',`/api/customers/${customer.id}`,{...customer,notes:'Cadastro fictício editado e recuperado pela automação'});
    await api('PUT',`/api/vehicles/${vehicle.id}`,{...vehicle,km:12345,service_model_id:null,service_link_mode:'none'});
    w=await workspace(); if(w.vehicles.find(v=>v.id===vehicle.id)?.km!==12345)throw Error('VEHICLE_EDIT_NOT_PERSISTED');
   });
   await step('checklist-criacao-interface', async () => {
    const w=await workspace(),v=w.vehicles.find(v=>v.id===s.ids.vehicle);
    const prior=(await api('GET','/api/checklists')).find(k=>k.plate===v.plate);
    if(prior){s.ids.checklist=prior.id;return;}
    await page.goto(HOMOLOGATION+'/checklists/novo');
    await page.getByPlaceholder('ABC1D23',{exact:true}).fill(v.plate);
    await page.getByRole('button',{name:'Consultar placa',exact:true}).click();
    await page.getByLabel('Responsável pelo checklist *',{exact:true}).fill('Inspetor Fictício');
    const [r]=await Promise.all([page.waitForResponse(r=>r.url().endsWith('/api/checklists')&&r.request().method()==='POST'),page.getByRole('button',{name:'Continuar checklist',exact:true}).click()]);
    if(!r.ok())throw Error('CHECKLIST_UI_CREATE_FAILED'); s.ids.checklist=(await r.json()).id;save();
   });
   await step('checklist-finalizacao-orcamento-interface', async()=>{
    let k=await api('GET',`/api/checklists/${s.ids.checklist}`);
    if(k.status==='completed'){s.ids.order=k.order_id;return;}
    await page.goto(HOMOLOGATION+`/checklists/${s.ids.checklist}`);
    await page.getByLabel('Reclamação do cliente',{exact:true}).fill('Ruído fictício para validação operacional');
    await page.getByLabel('Motivo da ausência da assinatura',{exact:true}).fill('Execução automatizada com dados e cliente fictícios');
    await page.getByRole('button',{name:'Salvar rascunho',exact:true}).click();
    const [r]=await Promise.all([page.waitForResponse(r=>r.url().endsWith('/finalize')&&r.request().method()==='POST'),page.getByRole('button',{name:'Finalizar checklist',exact:true}).click()]);
    if(!r.ok())throw Error('CHECKLIST_UI_FINALIZE_FAILED'); k=await r.json();s.ids.order=k.order_id;save();
    if(!k.created_quote || !k.order_id)throw Error('CHECKLIST_QUOTE_NOT_CREATED');
    await page.waitForURL('**/editar');await shot('orcamento-criado');
   });
   await step('produtos-servicos-estoque', async()=>{
    let w=await workspace();
    if(!w.product_categories.some(c=>c.name==='Teste operacional'&&c.active))await api('POST','/api/product-categories',{name:'Teste operacional',request_id:randomUUID()});
    const sku=`QA-${office.plan}-${run}`.slice(0,40);
    s.ids.product=w.catalog.find(c=>c.sku===sku)?.id || (await api('POST','/api/catalog',{kind:'product',name:`Peça Fictícia ${run}`,sku,category:'Teste operacional',cost:2000,price:5000,stock:0,minimum_stock:2})).id;save();
    const services=await api('GET','/api/workshop-services?service_type=private');
    s.ids.service=services.items.find(v=>v.name===`Serviço Fictício ${run}`)?.id || (await api('POST','/api/workshop-services',{service_type:'private',name:`Serviço Fictício ${run}`,price:10000,cost:3000,cost_known:true})).id;save();
    if(modules.inventory){
     s.ids.stockRequest ||= randomUUID();save();
     const input={quantity:10,reason:`Entrada fictícia ${run}`,cost:2000,price:5000,request_id:s.ids.stockRequest};
     await api('POST',`/api/stock/${s.ids.product}`,input);await api('POST',`/api/stock/${s.ids.product}`,input);
     w=await workspace();if(w.catalog.find(p=>p.id===s.ids.product).stock!==10)throw Error('STOCK_IDEMPOTENCY_FAILED');
    }else{
     if((await raw('POST',`/api/stock/${s.ids.product}`,{quantity:1,reason:'Bloqueio fictício'})).status()!==403)throw Error('PLAN_STOCK_NOT_BLOCKED');
     result.checks.push({name:'estoque-nao-incluso-bloqueado',status:'passed'});
    }
   });
   await step('orcamento-itens-desconto-persistencia', async()=>{
    const order=(await workspace()).orders.find(o=>o.id===s.ids.order);
    await api('PUT',`/api/orders/${s.ids.order}`,{customer_id:s.ids.customer,vehicle_id:s.ids.vehicle,status:'quote',entered_on:day,due_on:day,km:12345,problem:'Ruído fictício para validação operacional',notes:`Teste fictício ${run}`,discount:1000,items:[{catalog_id:s.ids.product,quantity:2,price:5000},{workshop_service_id:s.ids.service,quantity:1,price:10000}]});
    const saved=(await workspace()).orders.find(o=>o.id===s.ids.order);
    if(saved.total!==19000 || saved.items.length!==2 || saved.discount!==1000 || order.status!=='quote')throw Error('QUOTE_TOTAL_MISMATCH');
    await page.goto(HOMOLOGATION+`/ordens/${s.ids.order}/editar`);
    await page.getByRole('button',{name:'Adicionar produtos e serviços',exact:true}).click();
    await expect(page.locator('.order-item')).toHaveCount(1);
    await page.getByRole('button',{name:'Serviços',exact:true}).click();
    await expect(page.locator('.order-item')).toHaveCount(1);await shot('orcamento-itens');
   });
   await step('os-aprovacao-execucao-finalizacao-interface',async()=>{
    for(const [from,button,to] of [['quote','Aprovar OS','open'],['open','Iniciar execução','working'],['working','Marcar como pronta','ready'],['ready',modules.finance?'Finalizar OS e receber':'Finalizar OS','completed']]){
     const order=(await workspace()).orders.find(o=>o.id===s.ids.order);if(order.status!==from)continue;
     await page.goto(HOMOLOGATION+`/ordens/${s.ids.order}`);
     await page.getByRole('button',{name:button,exact:true}).click();
     if(from==='quote')await page.getByLabel('Previsão de entrega',{exact:true}).fill(day);
     const [r]=await Promise.all([page.waitForResponse(r=>r.url().endsWith(`/orders/${s.ids.order}/status`)&&r.request().method()==='POST'),page.getByRole('button',{name:'Confirmar',exact:true}).click()]);
     if(!r.ok())throw Error('ORDER_STATUS_UI_FAILED');
     const updated=(await workspace()).orders.find(o=>o.id===s.ids.order);if(updated.status!==to)throw Error('ORDER_STATUS_NOT_PERSISTED');
    }
    const w=await workspace(),order=w.orders.find(o=>o.id===s.ids.order);
    if(order.status!=='completed')throw Error('ORDER_NOT_COMPLETED');
    if(modules.inventory && w.catalog.find(p=>p.id===s.ids.product).stock!==8)throw Error('COMPLETION_STOCK_MISMATCH');
    await shot('os-finalizada');
   });
   await step('recebimento-financeiro',async()=>{
    let w=await workspace();const order=w.orders.find(o=>o.id===s.ids.order);
    if(modules.finance){
     s.ids.receivable=w.receivables.find(r=>r.order_id===s.ids.order)?.id;if(!s.ids.receivable)throw Error('RECEIVABLE_MISSING');save();
     if(!s.ids.account){s.ids.account=(await api('POST','/api/cash-accounts',{name:`Caixa Fictício ${run}`,kind:'cash',opening_balance:0,opening_on:day,active:1,request_id:randomUUID()})).id;save();}
     if(order.payment_status!=='paid'){
      await page.goto(HOMOLOGATION+`/ordens/${s.ids.order}/receber`);
      await page.getByRole('combobox',{name:/Forma de pagamento/}).selectOption('Pix');
      const [r]=await Promise.all([page.waitForResponse(r=>r.url().endsWith('/plan')&&r.request().method()==='POST'),page.getByRole('button',{name:'Salvar condições de pagamento',exact:true}).click()]);
      if(!r.ok())throw Error('PAYMENT_PLAN_UI_FAILED');
      await page.getByRole('button',{name:'Receber Pix',exact:true}).click();
      await page.getByRole('combobox',{name:/Conta que recebe o valor líquido/}).selectOption(s.ids.account);
      const [paid]=await Promise.all([page.waitForResponse(r=>r.url().endsWith('/settle')&&r.request().method()==='POST'),page.getByRole('button',{name:'Confirmar recebimento',exact:true}).click()]);
      if(!paid.ok())throw Error('PAYMENT_SETTLE_UI_FAILED');
     }
     const cash=await api('GET','/api/cash-control');if(cash.accounts.find(a=>a.id===s.ids.account)?.balance!==19000)throw Error('CASH_RECEIPT_MISMATCH');
    }else{
     if((await raw('GET','/api/expenses')).status()!==403)throw Error('PLAN_FINANCE_NOT_BLOCKED');
     if(order.payment_status!=='paid'){
      await page.goto(HOMOLOGATION+`/ordens/${s.ids.order}`);
      await page.getByRole('button',{name:'Registrar recebimento',exact:true}).click();
      await page.getByRole('combobox',{name:/Forma de recebimento/}).selectOption('Pix');
      const [r]=await Promise.all([page.waitForResponse(r=>r.url().endsWith('/basic-receipt')&&r.request().method()==='POST'),page.getByRole('button',{name:'Confirmar recebimento',exact:true}).click()]);
      if(!r.ok())throw Error('BASIC_RECEIPT_UI_FAILED');
     }
    }
    w=await workspace();if(w.orders.find(o=>o.id===s.ids.order).payment_status!=='paid')throw Error('RECEIPT_NOT_PERSISTED');
    await page.goto(HOMOLOGATION+`/ordens/${s.ids.order}`);
    await shot('recebimento-confirmado');
   });
   if(modules.finance)await step('despesa-pagamento-caixa',async()=>{
    let expenses=await api('GET','/api/expenses');
    s.ids.expense ||= expenses.payables.find(p=>p.description===`Despesa Fictícia ${run}`)?.id || (await api('POST','/api/payables',{description:`Despesa Fictícia ${run}`,supplier:'Fornecedor Fictício',category:'Teste operacional',amount:2500,due_on:day,notes:'Sem cobrança externa real'})).id;save();
    expenses=await api('GET','/api/expenses');if(expenses.payables.find(p=>p.id===s.ids.expense).status!=='paid')await api('POST',`/api/payables/${s.ids.expense}/pay`,{paid_on:day,method:'Pix',account_id:s.ids.account});
    const cash=await api('GET','/api/cash-control');if(cash.accounts.find(a=>a.id===s.ids.account).balance!==16500)throw Error('CASH_EXPENSE_MISMATCH');
    await page.goto(HOMOLOGATION+'/financeiro/caixa');await expect(page.getByText(`Caixa Fictício ${run}`,{exact:true}).first()).toBeVisible();await shot('caixa');
   });
   await step('documentos-historico-travas',async()=>{
    const document=await api('GET',`/api/documents/order/${s.ids.order}?current=1`);if(!JSON.stringify(document).includes('Modelo Fictício Operacional'))throw Error('DOCUMENT_IDENTITY_MISSING');
    const repeated=await raw('POST',modules.finance?`/api/installments/${(await workspace()).installments.find(i=>i.receivable_id===s.ids.receivable)?.id}/settle`:`/api/orders/${s.ids.order}/basic-receipt`,modules.finance?{account_id:s.ids.account}:{method:'Pix'});
    if(repeated.ok())throw Error('DUPLICATE_RECEIPT_ACCEPTED');
   });
   await step('negativas-estoque-historico-financeiro',async()=>{
    if(modules.inventory){
     const denied=await raw('POST',`/api/stock/${s.ids.product}`,{quantity:-9,reason:'Tentativa fictícia de saldo negativo'});
     if(denied.status()!==400||(await workspace()).catalog.find(p=>p.id===s.ids.product)?.stock!==8)throw Error('NEGATIVE_STOCK_NOT_PREVENTED');
    }
    if(modules.finance){
     const denied=await raw('POST',`/api/receivables/${s.ids.receivable}/discount`,{mode:'money',value:2000});
     if(denied.status()!==400)throw Error('SETTLED_DISCOUNT_NOT_PREVENTED');
    }
   });
   const finalWorkspace=await workspace(),finalOrder=finalWorkspace.orders.find(o=>o.id===s.ids.order);
   if(finalOrder?.status!=='completed'||finalOrder.payment_status!=='paid'||finalOrder.total!==19000)throw Error('FINAL_ORDER_MISMATCH');
   if(modules.inventory&&finalWorkspace.catalog.find(p=>p.id===s.ids.product)?.stock!==8)throw Error('FINAL_STOCK_MISMATCH');
   if(modules.finance){const cash=await api('GET','/api/cash-control');const account=cash.accounts.find(a=>a.id===s.ids.account);if(account?.balance!==16500||account.pending_receipts!==0)throw Error('FINAL_CASH_MISMATCH');result.cashBalanceCents=account.balance;}
   result.orderNumber=finalOrder.number;
   await page.goto(HOMOLOGATION+`/ordens/${s.ids.order}`);await shot('resultado-desktop');
   await page.setViewportSize({width:390,height:844});await shot('resultado-mobile');
   if(uiErrors.length)throw Error('UI_RUNTIME_ERRORS');
   result.status='passed';result.finalOrderId=s.ids.order;result.totalCents=19000;result.stock=modules.inventory?8:'not_included';
  }catch(error){result.status='failed';result.errors.push(String(error.message).slice(0,650));process.exitCode=1;await shot('falha').catch(()=>{});}
  finally{await raw('POST','/api/logout',{}).catch(()=>{});await context.close();writeFileSync(resolve(output,'report.json'),JSON.stringify(report,null,2),{mode:0o600});}
 }
} finally {await browser.close();report.finishedAt=new Date().toISOString();writeFileSync(resolve(output,'report.json'),JSON.stringify(report,null,2),{mode:0o600});}
console.log(JSON.stringify(report,null,2));
