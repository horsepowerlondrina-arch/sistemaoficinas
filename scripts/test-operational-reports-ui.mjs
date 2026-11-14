import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, expect } from '@playwright/test';

if (process.env.VERCEL || process.env.NODE_ENV === 'production') throw Error('ISOLATED_ONLY');
const output=resolve(process.env.RUNNER_TEMP||'/tmp','operational-reports-ui');mkdirSync(output,{recursive:true});
const files=['operational-report-fixture.html','operational-report-fixture.tsx'];
if(files.some(existsSync))throw Error('FIXTURE_ALREADY_EXISTS');
writeFileSync(files[0],'<div id="root"></div><script type="module" src="/operational-report-fixture.tsx"></script>');
writeFileSync(files[1],`import React from 'react';import {createRoot} from 'react-dom/client';import {BrowserRouter} from 'react-router-dom';import {AppContext} from './src/lib/context';import {ServicesProfit} from './src/pages/ServicesProfit';import {GainsReport} from './src/pages/GainsReport';import {today} from './src/lib/types';import './src/styles.css';
const day=today();const order={id:'fictional-order',number:1003,status:'completed',customer_name:'Cliente Fictício',completed_on:day+'T15:00:00Z',discount:1000,total:19000,items:[{id:'product',kind:'product',name:'Peça Fictícia',quantity:2,price:5000,cost:2000},{id:'service',kind:'service',name:'Serviço Próprio Fictício',quantity:1,price:10000,cost:3000}]};
const ctx={data:{orders:[order]},session:{tenant:{name:'Oficina Fictícia de Teste'}},notify:()=>{},refresh:async()=>{},refreshSession:async()=>{}};
createRoot(document.getElementById('root')!).render(<BrowserRouter><AppContext.Provider value={ctx as any}><main style={{padding:24,maxWidth:1200,margin:'auto'}}>{location.search.includes('gains')?<GainsReport/>:<ServicesProfit/>}</main></AppContext.Provider></BrowserRouter>);`);
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5185','--strictPort'],{stdio:'ignore'});
let browser;
try{
 let ready=false;for(let i=0;i<60;i++){try{if((await fetch('http://127.0.0.1:5185')).ok){ready=true;break;}}catch{}await delay(250);}if(!ready)throw Error('FIXTURE_SERVER_UNAVAILABLE');
 browser=await chromium.launch();const page=await browser.newPage();const errors=[];page.on('pageerror',()=>errors.push('RUNTIME_ERROR'));
 // No remote requests or credentials are used by these real report components.
 await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
 for(const [mode,title] of [['services','Lucro dos serviços'],['gains','Ganhos por período']]){
  await page.goto('http://127.0.0.1:5185/operational-report-fixture.html?'+mode);
  await expect(page.getByRole('heading',{name:title,exact:true})).toBeVisible();
  const row=page.getByRole('row').filter({hasText:mode==='services'?'Serviço Próprio Fictício':'Cliente Fictício'});
  for(const amount of mode==='services'?['30','95','65']:['190','70','120'])await expect(row).toContainText(new RegExp('R\\$\\s*'+amount+',00'));
  await expect(page.getByText('Serviços próprios têm custo zero neste relatório.',{exact:false})).toHaveCount(0);
  if(mode==='services')await expect(page.getByText('Custos dos serviços',{exact:true})).toBeVisible();
  for(const [viewport,width,height] of [['desktop',1440,1000],['mobile',390,844]]){
   await page.setViewportSize({width,height});await page.screenshot({path:resolve(output,mode+'-'+viewport+'.png'),fullPage:true});
   if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1))throw Error('REPORT_OVERFLOW');
  }
 }
 if(errors.length)throw Error('REPORT_RUNTIME_ERRORS');
 console.log('Real reports passed: registered own-service cost, proportional discount, totals, desktop and mobile. Isolated UI fixture; PostgreSQL journey tested separately.');
}finally{await browser?.close();server.kill('SIGTERM');for(const f of files)rmSync(f,{force:true});}
