import {spawn} from 'node:child_process';
import {existsSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {chromium,expect} from '@playwright/test';
if(process.env.VERCEL||process.env.NODE_ENV==='production')throw Error('ISOLATED_ONLY');
const output=resolve(process.env.RUNNER_TEMP||'/tmp','monthly-expenses-ui');mkdirSync(output,{recursive:true});
const files=['monthly-fixture.html','monthly-fixture.tsx'];if(files.some(existsSync))throw Error('FIXTURE_ALREADY_EXISTS');
writeFileSync(files[0],'<div id="root"></div><script type="module" src="/monthly-fixture.tsx"></script>');
writeFileSync(files[1],`import React from 'react';import{createRoot}from'react-dom/client';import{MemoryRouter}from'react-router-dom';import{AppContext}from'./src/lib/context';import{Expenses}from'./src/pages/Expenses';import'./src/styles.css';const ctx={data:{cash:[],cash_accounts:[]},session:{tenant:{id:'fictional',name:'Oficina Fictícia'}},notify:()=>{}};createRoot(document.getElementById('root')!).render(<MemoryRouter><AppContext.Provider value={ctx as any}><main style={{padding:24,maxWidth:1200,margin:'auto'}}><Expenses/></main></AppContext.Provider></MemoryRouter>);`);
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5188','--strictPort'],{stdio:'ignore'});let browser;
try{
 for(let i=0;i<60;i++){try{if((await fetch('http://127.0.0.1:5188')).ok)break;}catch{}await delay(500);}
 browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}:{})});
 for(const viewport of ['desktop','mobile']){
  const page=await browser.newPage({viewport:viewport==='desktop'?{width:1440,height:1000}:{width:390,height:844}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const month=new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit'}).format(new Date());
  const template={id:'template',description:'Energia fictícia',category:'Variável',supplier:'Fornecedor fictício',amount:null,due_day:10,remaining_months:null,start_month:month,source:'Cobrança mensal',active:1};
  let row={id:'payable',template_id:'template',description:'Energia fictícia',category:'Variável',supplier:'Fornecedor fictício',amount:null,due_on:month+'-10',notes:'Cobrança mensal',status:'open'};
  await page.route('**/api/**',async route=>{const req=route.request();const path=new URL(req.url()).pathname;
   if(path==='/api/expenses')return route.fulfill({json:{templates:[template],payables:[row]}});
   if(path==='/api/payables/payable'&&req.method()==='PUT'){const value=req.postDataJSON();expect(value.amount).toBe(45678);row={...row,...value};return route.fulfill({json:{ok:true}});}
   throw Error('Unexpected API request '+req.method()+' '+path);
  });
  await page.goto('http://127.0.0.1:5188/monthly-fixture.html');
  await expect(page.getByRole('cell',{name:'Valor a informar',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Pagar',exact:true})).toBeDisabled();
  await expect(page.getByText('1 conta(s) com valor a informar',{exact:true})).toBeVisible();
  await page.screenshot({path:resolve(output,`monthly-payables-${viewport}.png`),fullPage:true});
  await page.getByRole('button',{name:'Editar',exact:true}).click();
  await expect(page.getByLabel('Valor (R$)',{exact:true})).toHaveValue('');
  await page.getByLabel('Valor (R$)',{exact:true}).fill('456.78');
  await page.getByRole('button',{name:'Salvar conta',exact:true}).click();
  await expect(page.getByRole('button',{name:'Pagar',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'Planejamento mensal',exact:true}).click();
  await expect(page.getByRole('button',{name:'Gerar contas do mês'})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Novo gasto recorrente'})).toBeVisible();
  await page.screenshot({path:resolve(output,`monthly-planning-${viewport}.png`),fullPage:true});
  await page.getByRole('button',{name:'Novo gasto recorrente'}).click();
  await expect(page.getByLabel('Valor mensal (R$)',{exact:true})).toHaveValue('');
  await page.screenshot({path:resolve(output,`monthly-config-${viewport}.png`),fullPage:true});
  expect(errors).toEqual([]);await page.close();
 }
 console.log('Planejamento e conta variável conferidos em desktop/mobile; valor em centavos e bloqueio de pagamento validados.');
}finally{await browser?.close();server.kill('SIGTERM');for(const file of files)rmSync(file,{force:true});}
