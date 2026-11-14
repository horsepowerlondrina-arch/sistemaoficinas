import {chromium} from '@playwright/test';
import {readFileSync,writeFileSync,lstatSync,mkdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import assert from 'node:assert/strict';
const origin='https://sistema-oficinas-homologacao.osdrive-homologacao.workers.dev';
const source=resolve(process.env.TEST_ONBOARDING_FILE || 'data/test-onboarding.json');
const stat=lstatSync(source);assert.ok(stat.isFile()&&!stat.isSymbolicLink()&&!(stat.mode&0o077)&&stat.uid===process.getuid(),'PRIVATE_MANIFEST_REQUIRED');
const m=JSON.parse(readFileSync(source,'utf8'));
assert.equal(m.run,'20261114-autonomo');assert.equal(m.baseURL,'https://sistema-oficinas-homologacao.vercel.app');
const ids={basic:'26bb4fc1-276d-411c-b903-1c84c0b77299',professional:'1f866f8e-d6e0-475f-a270-1dae4b2279b1',premium:'d0a82163-8b22-4ec6-98d4-f5495c386ee2'};
assert.equal(m.offices.length,3);for(const o of m.offices)assert.equal(o.tenantId,ids[o.plan]);
const operations=JSON.parse(readFileSync('data/cf-operacional-20261114.json','utf8'));
const previous=JSON.parse(readFileSync(resolve(dirname(source),'operacional-20261114.json'),'utf8'));
assert.equal(previous.run,'operacional-20261114');
const officeOrder=plan=>operations.offices[plan]?.ids?.order||previous.offices[plan].ids.order;
const report={environment:origin,startedAt:new Date().toISOString(),checks:[],blockers:[],passed:false,productionModified:false};
const b=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH});
try{
 const anon=await b.newContext();try{assert.equal((await anon.request.get(origin+'/api/workspace')).status(),401);assert.equal((await anon.request.get(origin+'/admin-api/users')).status(),403);assert.equal((await anon.request.get(origin+'/api/billing/stripe/renew')).status(),403);}finally{await anon.close();}
 for(const o of m.offices)for(const profile of ['master','mechanic','finance']){
  const member=o.members.find(x=>x.profile===profile);if(!member)continue;
  assert.ok(member.email.endsWith('@testes.osdrive.com.br'));const c=await b.newContext();let logoutVerified=false;
  const raw=(method,path,data)=>{assert.ok(path.startsWith('/api/')&&!path.includes('..'));return c.request.fetch(origin+path,{method,data,headers:{Origin:origin},maxRedirects:0,timeout:30000});};
  const api=async(method,path,data)=>{const r=await raw(method,path,data);assert.equal(r.status(),200,method+' '+path);return r.json();};
  try{
   await api('POST','/api/login',{email:member.email,password:member.password});const i=await api('GET','/api/session');assert.equal(i.tenant.id,o.tenantId);assert.equal(i.user.email,member.email);assert.equal(i.access.profile,profile);
   assert.equal(i.access.permissions['users.manage'],profile==='master');
   const w=await api('GET','/api/workspace');assert.ok(w.orders.every(x=>x.tenant_id===o.tenantId));
   for(const other of m.offices.filter(x=>x.plan!==o.plan)){
    const foreign=officeOrder(other.plan);assert.ok(foreign,'OPERATIONAL_FIXTURE_REQUIRED');
    for(const path of ['/api/orders/'+foreign+'/assignments','/api/documents/order/'+foreign+'?current=1'])assert.ok([403,404].includes((await raw('GET',path)).status()),'FOREIGN_ORDER_EXPOSED');
    assert.ok([403,404].includes((await raw('POST','/api/tenant',{tenant_id:other.tenantId})).status()),'FOREIGN_OFFICE_SWITCH_ALLOWED');
   }
   for(const [path,permission] of [['/api/users','users.manage'],['/api/cash-control','finance.view'],['/api/repair-services/brands','technical.view']])assert.equal((await raw('GET',path)).status(),i.access.permissions[permission]?200:403,'PERMISSION_MISMATCH');
   if(profile==='mechanic'){
    assert.ok(!w.orders.some(x=>x.id===officeOrder(o.plan)),'UNASSIGNED_ORDER_EXPOSED');
    assert.ok([403,404].includes((await raw('GET','/api/documents/order/'+officeOrder(o.plan)+'?current=1')).status()));
    for(const key of ['receivables','cash','cash_accounts'])assert.equal((w[key]||[]).length,0);
    for(const customer of w.customers||[])for(const key of ['phone','email','address'])assert.ok(!customer[key],'PERSONAL_DATA_EXPOSED');
   }
   const invalidOrigin=await c.request.post(origin+'/api/customers',{headers:{Origin:'https://attacker.example'},data:{name:'MUST_NOT_CREATE'},maxRedirects:0});assert.equal(invalidOrigin.status(),403);
   assert.equal((await api('GET','/api/session')).tenant.id,o.tenantId);
   await raw('POST','/api/logout',{});assert.equal((await raw('GET','/api/session')).status(),401);logoutVerified=true;
   report.checks.push({plan:o.plan,profile,status:'passed',crossOfficeOrdersChecked:2,logoutVerified:true});console.log(JSON.stringify({plan:o.plan,profile,status:'passed'}));
  }finally{if(!logoutVerified)await raw('POST','/api/logout',{}).catch(()=>{});await c.close();}
 }
 report.passed=true;
}catch(error){report.blockers.push({code:'VALIDATION_INTERRUPTED',message:String(error.message).slice(0,400)});process.exitCode=1;}finally{await b.close();report.finishedAt=new Date().toISOString();const dir=resolve(process.env.TEST_OPERATIONAL_OUTPUT||'../relatorios/cloudflare-2026-11-14');mkdirSync(dir,{recursive:true});writeFileSync(resolve(dir,'security.json'),JSON.stringify(report,null,2),{mode:0o600});}
console.log(JSON.stringify({passed:report.passed,profiles:report.checks.length}));
