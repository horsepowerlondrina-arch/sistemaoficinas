import {spawn} from 'node:child_process';
import {existsSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {chromium,expect} from '@playwright/test';
if(process.env.VERCEL||process.env.NODE_ENV==='production')throw Error('ISOLATED_ONLY');
const output=resolve(process.env.RUNNER_TEMP||'/tmp','financial-ui');mkdirSync(output,{recursive:true});
const files=['financial-fixture.html','financial-fixture.tsx'];if(files.some(existsSync))throw Error('FIXTURE_ALREADY_EXISTS');
writeFileSync(files[0],'<div id="root"></div><script type="module" src="/financial-fixture.tsx"></script>');
writeFileSync(files[1],`import React from 'react';import{createRoot}from'react-dom/client';import{MemoryRouter,Routes,Route}from'react-router-dom';import{AppContext}from'./src/lib/context';import{Payment}from'./src/pages/Payment';import{today}from'./src/lib/types';import'./src/styles.css';
const day=today(),mode=new URLSearchParams(location.search).get('mode'),interest=mode!=='pass',legacy=mode==='legacy';
const gross=interest?10840:10219,fee=interest?239:218,net=interest?10601:10001;
const order={id:'fixture',number:1001,status:'completed',discount:0,total:10001,items:[{id:'p',kind:'product',name:'Peça Fictícia',quantity:1,price:10001,cost:1000}]};
const receipt={id:'receipt',order_id:'fixture',amount:10001,plan_configured:1,method:'Misto',status:'paid',balance:0,gross_total:gross,fee_total:fee,net_total:net,installment_count:4,card_fee_bps:0,interest_bps:0,due_on:day,card_sale_on:day,paid_at:day+'T15:00:00Z'};
const rows=[{id:'pix',receivable_id:'receipt',sequence:1,method:'Pix',principal:4001,gross:4001,fee:0,net:4001,interest:0,status:'paid',due_on:day,paid_at:day+'T15:00:00Z',interest_bps:legacy?null:0,pass_card_fee:0,installment_count:1}];
for(let i=0;i<3;i++){const g=interest?(i===2?2279:2280):(i===2?2072:2073),f=interest?(i===2?79:80):(i===2?72:73);rows.push({id:'card-'+i,receivable_id:'receipt',sequence:i+2,method:'Cartão de crédito',principal:2000,gross:g,fee:f,net:g-f,interest:g-2000,status:'paid',due_on:day,paid_at:day+'T15:00:00Z',interest_bps:legacy?null:interest?1000:0,pass_card_fee:1,installment_count:3,machine_id:'machine',machine_name:'Máquina Fictícia',machine_operator:'Operadora Fictícia',card_fee_bps:350});}
const ctx={data:{orders:[order],receivables:[receipt],installments:rows,cash_accounts:[],payment_settings:null},session:{tenant:{id:'fictional',name:'Oficina Fictícia'}},refresh:async()=>{},notify:()=>{}};
createRoot(document.getElementById('root')!).render(<MemoryRouter initialEntries={['/ordens/fixture/receber']}><AppContext.Provider value={ctx as any}><main style={{padding:24,maxWidth:1200,margin:'auto'}}><Routes><Route path="/ordens/:id/receber" element={<Payment/>}/></Routes></main></AppContext.Provider></MemoryRouter>);`);
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5187','--strictPort'],{stdio:'ignore'});let browser;
try{
 let ready=false;for(let i=0;i<60;i++){try{if((await fetch('http://127.0.0.1:5187')).ok){ready=true;break;}}catch{}await delay(250);}if(!ready)throw Error('FIXTURE_UNAVAILABLE');
 browser=await chromium.launch();const page=await browser.newPage();const errors=[];page.on('pageerror',()=>errors.push('PAGE_ERROR'));
 await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
 await page.route('**/api/card-machines',route=>route.fulfill({json:[]}));
 for(const[mode,surcharge,interest]of[['pass','2,18','0,00'],['pass-interest','2,39','6,00'],['legacy','0,00','8,39']]){
  await page.goto('http://127.0.0.1:5187/financial-fixture.html?mode='+mode);
  const summary=page.locator('.receipt-financial-summary');await expect(summary).toBeVisible();
  await expect(summary.locator(':scope > div').filter({hasText:'Taxa repassada'})).toContainText(new RegExp('R\\$\\s*'+surcharge));
  await expect(summary.locator(':scope > div').filter({hasText:'Juros do parcelamento'})).toContainText(new RegExp('R\\$\\s*'+interest));
  if(mode!=='legacy')for(const[name,width,height]of[['desktop',1440,1000],['mobile',390,844]]){
   await page.setViewportSize({width,height});await page.screenshot({path:resolve(output,mode+'-'+name+'.png'),fullPage:true,animations:'disabled'});
   if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1))throw Error('FINANCIAL_UI_OVERFLOW');
  }
 }
 if(errors.length)throw Error('FINANCIAL_UI_RUNTIME_ERROR');
 console.log('Mixed pass-through, interest, legacy snapshots and desktop/mobile passed. Real Payment component with isolated fictional context.');
}finally{await browser?.close();server.kill('SIGTERM');for(const f of files)rmSync(f,{force:true});}
