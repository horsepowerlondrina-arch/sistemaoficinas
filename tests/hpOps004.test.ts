import test from 'node:test';
import assert from 'node:assert/strict';
import {visibleWorkshopNavigation} from '../src/lib/workshopNavigation.js';
import {effectivePermissions,type UserProfile} from '../shared/userPermissions.js';
import type {Session} from '../src/lib/types.js';
import {deliverEmployeeInvite} from '../server/services/workshopUsers.js';

function links(profile:UserProfile){
 const value=visibleWorkshopNavigation({role:profile==='master'?'owner':'operator',access:{profile,active:true,permissions:effectivePermissions(profile),orderScope:profile==='mechanic'?'assigned':'all',discountBps:0,discountCents:null}} as Session);
 return [...value.groups.flatMap(g=>g.items),...value.footer].map(i=>i.path);
}
test('Horse Power navigation preserves shared menu/home filtering for effective OPS-004 profiles',()=>{
 assert.ok(links('master').includes('/configuracoes'));
 assert.ok(links('finance').includes('/financeiro'));
 assert.ok(!links('mechanic').includes('/financeiro'));
 assert.ok(!links('mechanic').includes('/configuracoes'));
 assert.ok(links('mechanic').includes('/ordens'));
 for(const p of ['master','manager','advisor','mechanic','finance'] as UserProfile[]){
  assert.ok(!links(p).includes('/resultados'));
  assert.ok(!links(p).includes('/suporte'));
 }
});
test('Horse Power employee invitation uses /sistema and preserves one-use token only in URL fragment',async()=>{
 const names=['APP_ENV','APP_ORIGIN','WORKSHOP_ACTIVATION_FROM','RESEND_API_KEY'] as const;
 const old=Object.fromEntries(names.map(k=>[k,process.env[k]]));const originalFetch=globalThis.fetch;
 try{
  process.env.APP_ENV='horse_power';process.env.APP_ORIGIN='https://hp.example.test';process.env.WORKSHOP_ACTIVATION_FROM='Teste <noreply@example.test>';process.env.RESEND_API_KEY='fictional-not-a-key';
  let body:any;
  globalThis.fetch=async(input,init)=>{assert.equal(String(input),'https://api.resend.com/emails');body=JSON.parse(String(init?.body));return new Response('{}',{status:202});};
  await deliverEmployeeInvite({email:'collaborator@example.test',token:'a'.repeat(64),workshopName:'Oficina fictícia',id:'fictional-invite'});
  assert.deepEqual(body.to,['collaborator@example.test']);
  assert.ok(body.text.includes('https://hp.example.test/sistema/aceitar-convite#'+'a'.repeat(64)));
  assert.ok(!body.text.includes('?token='));
 }finally{globalThis.fetch=originalFetch;for(const k of names){if(old[k]===undefined)delete process.env[k];else process.env[k]=old[k];}}
});
