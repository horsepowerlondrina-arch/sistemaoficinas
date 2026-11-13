import {spawn} from 'node:child_process';
import {mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {chromium,expect} from '@playwright/test';
const output=resolve(process.env.RUNNER_TEMP||'/tmp','support-ui');
mkdirSync(output,{recursive:true});
const server=spawn('node',['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5183','--strictPort'],{stdio:'ignore'});
let browser;
try {
 let ready=false;for(let i=0;i<60;i++){try{if((await fetch('http://127.0.0.1:5183')).ok){ready=true;break;}}catch{}await delay(500);}if(!ready)throw Error('Support UI unavailable');
 browser=await chromium.launch();
 for(const mode of ['admin','oficina']){
  const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(15000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const stamp='2026-11-13T12:00:00Z';
  let tickets=[{id:'ticket-a',subject:'Chamado A fictício',status:'open',workshop_name:'Oficina fictícia',updated_at:stamp},{id:'ticket-b',subject:'Chamado B fictício',status:'open',workshop_name:'Oficina fictícia',updated_at:stamp}];
  let messages={ 'ticket-a':[{id:'a1',sender_kind:'workshop',body:'Mensagem original A',created_at:stamp}], 'ticket-b':[{id:'b1',sender_kind:'workshop',body:'Mensagem original B',created_at:stamp}]};
  let fail=false,hold=false,release,reads=0,lists=0,writes=0;
  await page.route('**/*api/**',async route=>{
   const req=route.request(),path=new URL(req.url()).pathname;
   const json=(value,status=200)=>route.fulfill({json:value,status});
   if(req.method()!=='GET'){writes++;return json({error:'Unexpected mutation'},400);}
   if(path==='/admin-api/session')return json({administrator:{id:'admin',name:'Admin Fictício',email:'admin@example.test',role:'principal',permissions:['administrators:manage','workshops:read','workshops:manage','audit:read','platform:settings']}});
   if(path==='/api/session')return json({user:{id:'owner',name:'Responsável Fictício',email:'owner@example.test'},tenant:{id:'fictional',name:'Oficina Fictícia'},tenants:[],role:'owner',support_available:true});
   if(path==='/api/workspace')return json({customers:[],vehicles:[],catalog:[],professionals:[],orders:[],receivables:[],cash:[],movements:[],installments:[],payment_settings:null});
   if(path.endsWith('/support/tickets')){lists++;return json(tickets);}
   if(path.includes('/support/tickets/')&&path.endsWith('/messages')){
    reads++;const id=path.split('/').at(-2),result=structuredClone(messages[id]);
    if(hold&&id==='ticket-a'){hold=false;await new Promise(r=>{release=r;});}
    if(fail)return json({error:'Falha fictícia ao atualizar a conversa'},503);
    return json(result);
   }
   return json({});
  });
  await page.goto('http://127.0.0.1:5183/'+(mode==='admin'?'admin':'suporte'));
  if(mode==='admin')await page.getByRole('button',{name:'Suporte',exact:true}).click();
  const nav=page.locator(mode==='admin'?'.pa-nav button':'.sidebar .nav-item');
  await expect(nav.first()).toBeVisible();
  if(await nav.evaluateAll(items=>items.some(item=>!item.querySelector('svg[aria-hidden="true"]'))))throw Error(mode+' menu missing decorative icon');
  if(mode==='admin')await expect(page.locator('.pa-nav').getByRole('button',{name:'Assinaturas e cobranças'}).locator('svg')).toHaveCount(1);
  await expect(page.getByRole('button',{name:/Chamado A fictício/})).toBeVisible();
  const refresh=()=>page.getByRole('button',{name:'Atualizar',exact:true}).click();
  await refresh();await expect.poll(()=>lists).toBeGreaterThan(1);if(reads!==0)throw Error('Refresh without selection requested messages');
  await page.getByRole('button',{name:/Chamado A fictício/}).click();
  await expect(page.getByText('Mensagem original A',{exact:true})).toBeVisible();
  const draft=page.getByRole('textbox',{name:mode==='admin'?'Resposta':'Mensagem',exact:true});
  await draft.fill('Rascunho que deve ser preservado');
  messages['ticket-a'].push({id:'a2',sender_kind:mode==='admin'?'workshop':'admin',body:'Nova mensagem recebida pelo botão Atualizar',created_at:stamp});tickets[0].status='resolved';
  const before=reads;
  await refresh();await expect(page.getByText('Nova mensagem recebida pelo botão Atualizar',{exact:true})).toBeVisible();
  await expect(draft).toHaveValue('Rascunho que deve ser preservado');
  await expect(page.getByRole('button',{name:/Chamado A fictício.*Resolvido/})).toBeVisible();
  if(mode==='admin')await expect(page.getByRole('button',{name:'Reabrir chamado',exact:true})).toBeEnabled();
  if(reads!==before+1)throw Error('Refresh duplicated message request');
  fail=true;await refresh();await expect(page.getByRole('alert')).toHaveText('Falha fictícia ao atualizar a conversa');
  await expect(draft).toHaveValue('Rascunho que deve ser preservado');await expect(page.getByText('Mensagem original A',{exact:true})).toBeVisible();
  fail=false;await refresh();await expect(page.getByRole('alert')).toHaveCount(0);await expect(page.getByRole('button',{name:'Atualizar',exact:true})).toBeEnabled();
  await page.screenshot({path:resolve(output,`support-${mode}-desktop.png`),fullPage:true,animations:"disabled"});
  // A delayed refresh must never overwrite a newer selection.
  hold=true;await refresh();await expect.poll(()=>typeof release).toBe('function');
  await expect(page.getByRole('button',{name:'Atualizando…',exact:true})).toBeDisabled();
  if(mode==='admin')page.once('dialog',dialog=>dialog.accept());
  await page.getByRole('button',{name:/Chamado B fictício/}).click();await expect(page.getByText('Mensagem original B',{exact:true})).toBeVisible();
  release();await expect(page.getByRole('button',{name:'Atualizar',exact:true})).toBeEnabled();
  await expect(page.getByRole('heading',{name:'Chamado B fictício',exact:true})).toBeVisible();await expect(page.getByText('Mensagem original A',{exact:true})).toHaveCount(0);
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:resolve(output,`support-${mode}-mobile.png`),fullPage:true,animations:"disabled"});
  if(await page.locator('.pa-support-layout .pa-card').evaluateAll(cards=>cards.some(card=>card.getBoundingClientRect().right>innerWidth)))throw Error(mode+' support overflow');
  if(writes!==0)throw Error('Refresh caused a write');if(errors.length)throw Error(errors.join('\n'));
  await page.close();
 }
 console.log('Support UI passed in both panels: refresh list + conversation + status, draft preserved, error/retry, stale response isolation, no writes, sidebar icons, desktop/mobile.');
}finally{await browser?.close();server.kill('SIGTERM');}
