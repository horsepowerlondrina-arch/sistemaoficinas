import { chromium, expect } from '@playwright/test';
import { readFileSync, writeFileSync, lstatSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { financialJourney, type FinancialCall } from '../../tests/helpers/financialJourney.js';
import { nextBankingDay } from '../../shared/bankingDays.js';

const origin='https://sistema-oficinas-homologacao.vercel.app';
if(process.env.TEST_FINANCIAL_WRITES!=='fictitious-homologation-only')throw Error('EXPLICIT_FICTITIOUS_WRITES_REQUIRED');
const file=resolve('data/test-onboarding.json'),stat=lstatSync(file);
if(!stat.isFile()||stat.isSymbolicLink()||(stat.mode&0o077)||stat.uid!==process.getuid())throw Error('PRIVATE_MANIFEST_REQUIRED');
const manifest=JSON.parse(readFileSync(file,'utf8'));
const expected:Record<string,string>={basic:'26bb4fc1-276d-411c-b903-1c84c0b77299',professional:'1f866f8e-d6e0-475f-a270-1dae4b2279b1',premium:'d0a82163-8b22-4ec6-98d4-f5495c386ee2'};
if(manifest.baseURL!==origin||manifest.run!=='20261114-autonomo'||manifest.offices.length!==3)throw Error('FICTITIOUS_MANIFEST_REQUIRED');
for(const o of manifest.offices)if(o.tenantId!==expected[o.plan]||!o.name.startsWith('Oficina Fictícia Automação ')||o.members[0].profile!=='master'||!o.members[0].email.endsWith('@testes.osdrive.com.br'))throw Error('FICTITIOUS_MANIFEST_REQUIRED');
const prior=JSON.parse(readFileSync('data/operacional-20261114.json','utf8'));
const statePath=resolve('data/financeiro-avancado-20261114.json');
let state:any;try{state=JSON.parse(readFileSync(statePath,'utf8'));}catch(e:any){if(e.code!=='ENOENT')throw e;state={run:'financeiro-avancado-20261114',offices:{}};}
if(state.run!=='financeiro-avancado-20261114')throw Error('CHECKPOINT_MISMATCH');
const save=()=>writeFileSync(statePath,JSON.stringify(state,null,2),{mode:0o600});
const output=resolve('../relatorios/financeiro-avancado-2026-11-14');mkdirSync(output,{recursive:true,mode:0o700});
const day=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const opening=new Date(day+'T12:00:00Z');opening.setUTCDate(opening.getUTCDate()-7);
const report:any={environment:origin,startedAt:new Date().toISOString(),offices:[],productionModifiedByThisTask:false,providerCharges:false};
const browser=await chromium.launch();
try{
 for(const office of manifest.offices){
  const context=await browser.newContext({serviceWorkers:'block',acceptDownloads:false,reducedMotion:'reduce'}),page=await context.newPage();page.setDefaultTimeout(18000);
  page.on('dialog',d=>d.type()==='confirm'?d.accept():d.dismiss());
  const result:any={plan:office.plan,scenarios:[],errors:[],evidence:[]};report.offices.push(result);
  const s=state.offices[office.plan] ||= {ids:{},accounts:{},cases:{}};save();
  const call:FinancialCall=async(method,path,body)=>{
   if(!/^\/[a-zA-Z0-9_/?=&.-]+$/.test(path)||path.includes('..'))throw Error('PATH_REFUSED');
   const r=await context.request.fetch(origin+'/api'+path,{method,data:body,headers:{Origin:origin},timeout:25000,maxRedirects:0});
   return {status:r.status(),ok:r.ok(),body:await r.json().catch(()=>({error:'NON_JSON_RESPONSE'}))};
  };
  const api=async(method:string,path:string,body?:any)=>{const r=await call(method,path,body);if(!r.ok)throw Error(`HTTP_${r.status} ${path}: ${String(r.body?.error||'').slice(0,200)}`);return r.body;};
  try{
   await api('POST','/login',{email:office.members[0].email,password:office.members[0].password});
   const identity=await api('GET','/session');
   if(identity.tenant.id!==office.tenantId||identity.tenant.name!==office.name||identity.user.email!==office.members[0].email||identity.access.profile!=='master')throw Error('IDENTITY_MISMATCH');
   if((office.plan==='basic')!==(!identity.modules.finance))throw Error('PLAN_MODULE_MISMATCH');
   const w=await api('GET','/workspace'),old=prior.offices[office.plan].ids;
   if(!w.customers.some((c:any)=>c.id===old.customer&&c.name.includes('Cliente Fictício'))||!w.vehicles.some((v:any)=>v.id===old.vehicle&&v.customer_id===old.customer))throw Error('FICTITIOUS_FIXTURE_MISMATCH');
   if(office.plan!=='basic'){
    const machines=await api('GET','/card-machines');
    const body={name:'Máquina Fictícia Financeiro Avançado',operator:'Operadora Fictícia',active:true,is_default:machines.length===0,max_installments:3,rates:[{method:'Cartão de débito',installments:1,fee_bps:150},{method:'Cartão de crédito',installments:1,fee_bps:250},{method:'Cartão de crédito',installments:3,fee_bps:350}]};
    s.ids.machine ||= machines.find((m:any)=>m.name===body.name)?.id || (await api('POST','/card-machines',body)).id;save();
    const sku='FIN-ADV-20261114-'+office.plan;
    s.ids.product ||= w.catalog.find((p:any)=>p.sku===sku)?.id || (await api('POST','/catalog',{kind:'product',name:'Peça Fictícia Financeiro Avançado',sku,category:'',cost:1000,price:10001,stock:0,minimum_stock:0})).id;save();
    s.ids.stockRequest ||= randomUUID();save();
    await api('POST',`/stock/${s.ids.product}`,{quantity:20,reason:'Entrada fictícia exclusiva do teste financeiro avançado',cost:1000,price:10001,request_id:s.ids.stockRequest});
   }
   const account=async(key:string)=>{
    if(s.accounts[key])return s.accounts[key];
    const name='Fictício FIN-ADV '+key;
    const current=await api('GET','/cash-control');
    s.accounts[key]=current.accounts.find((a:any)=>a.name===name)?.id || (await api('POST','/cash-accounts',{name,kind:'bank',opening_balance:0,opening_on:opening.toISOString().slice(0,10),active:1,request_id:randomUUID()})).id;save();return s.accounts[key];
   };
   const configure=async(key:string,order:string,input:any)=>{
    if(!['credit-pass','mixed-pix-first'].includes(key))return false;
    await page.goto(origin+`/ordens/${order}/receber`);
    if(key==='credit-pass'){
     await page.getByRole('combobox',{name:/Forma de pagamento/}).selectOption('Cartão de crédito');
     await page.getByRole('combobox',{name:/Máquina de cartão/}).selectOption(s.ids.machine);
     await page.getByLabel('Parcelas',{exact:true}).fill('3');
     await expect(page.getByRole('checkbox',{name:'Repassar taxa ao cliente',exact:true})).not.toBeChecked();
     await page.getByRole('checkbox',{name:'Repassar taxa ao cliente',exact:true}).check();
     await page.getByLabel('Data da venda no cartão',{exact:true}).fill(day);
     const [r]=await Promise.all([page.waitForResponse(r=>r.url().endsWith('/plan')&&r.request().method()==='POST'),page.getByRole('button',{name:'Salvar condições de pagamento',exact:true}).click()]);if(!r.ok())throw Error('CARD_UI_PLAN_FAILED');
    }else{
     await page.getByRole('checkbox',{name:'Dividir entre formas de pagamento',exact:true}).click();
     const pix=page.locator('section[aria-label="Pagamento 1"]'),card=page.locator('section[aria-label="Pagamento 2"]');
     await pix.getByLabel('Valor da OS nesta forma (R$)',{exact:true}).fill('40.01');
     await card.getByRole('combobox',{name:/Forma de pagamento/}).selectOption('Cartão de crédito');
     await card.getByLabel('Valor da OS nesta forma (R$)',{exact:true}).fill('60.00');
     await card.getByRole('combobox',{name:/Máquina de cartão/}).selectOption(s.ids.machine);
     await card.getByLabel('Parcelas',{exact:true}).fill('3');
     const [r]=await Promise.all([page.waitForResponse(r=>r.url().endsWith('/plan')&&r.request().method()==='POST'),page.getByRole('button',{name:'Salvar divisão do pagamento',exact:true}).click()]);if(!r.ok())throw Error('MIXED_UI_PLAN_FAILED');
    }
    return true;
   };
   const settleCredit=async(key:string,order:string,accountId:string)=>{
    if(!['credit-pass','mixed-pix-first'].includes(key))return false;
    await page.goto(origin+`/ordens/${order}/receber`);
    await page.getByRole('button',{name:/^Receber total do cartão/}).click();
    await page.getByRole('combobox',{name:/Conta que recebe o valor líquido/}).selectOption(accountId);
    const [r]=await Promise.all([page.waitForResponse(r=>r.url().endsWith('/settle-credit')&&r.request().method()==='POST'),page.getByRole('button',{name:'Confirmar recebimento',exact:true}).click()]);if(!r.ok())throw Error('CARD_UI_SETTLEMENT_FAILED');return true;
   };
   const capture=async(key:string,order:string)=>{
    console.log(JSON.stringify({plan:office.plan,scenario:key,status:'passed'}));
    if(!['basic-reversal','credit-three','credit-pass','mixed-pix-first','boleto-three'].includes(key))return;
    await page.goto(origin+`/ordens/${order}`+(office.plan==='basic'?'':'/receber'));await page.getByRole('main').waitFor();
    for(const [name,width,height]of [['desktop',1440,1000],['mobile',390,844]] as const){await page.setViewportSize({width,height});const filename=`${office.plan}-${key}-${name}.png`;await page.screenshot({path:resolve(output,filename),fullPage:true,animations:'disabled'});result.evidence.push(filename);}
    await page.setViewportSize({width:1440,height:1000});
   };
   result.scenarios=await financialJourney(call,{plan:office.plan,marker:'FIN-ADV-20261114-'+office.plan,day,nextBankingDay:day==='2026-11-14'?'2026-11-16':nextBankingDay(day),customer:old.customer,vehicle:old.vehicle,product:s.ids.product,service:old.service,machine:s.ids.machine,account},s.cases,save,{configure,settleCredit,capture});
   if(office.plan!=='basic'){
    const end=await api('GET','/workspace');const stock=end.catalog.find((p:any)=>p.id===s.ids.product).stock;
    if(stock!==10)throw Error('FINAL_ADVANCED_STOCK_MISMATCH');result.finalStock=stock;
   }
   result.status='passed';
  }catch(error:any){result.status='failed';result.errors.push(String(error.message).slice(0,1000));process.exitCode=1;}
  finally{await call('POST','/logout',{}).catch(()=>{});await context.close();writeFileSync(resolve(output,'report.json'),JSON.stringify(report,null,2),{mode:0o600});}
 }
}finally{await browser.close();report.finishedAt=new Date().toISOString();writeFileSync(resolve(output,'report.json'),JSON.stringify(report,null,2),{mode:0o600});}
console.log(JSON.stringify(report.offices.map((o:any)=>({plan:o.plan,status:o.status,scenarios:o.scenarios.length,errors:o.errors})),null,2));
