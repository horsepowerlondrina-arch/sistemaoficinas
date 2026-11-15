import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import assert from 'node:assert/strict';
const require=createRequire(resolve('cloudflare/package.json'));
const {Miniflare,Log,LogLevel,convertV4MiniflareOptions}=require('miniflare');
const assets=resolve('dist');
const mf=new Miniflare(convertV4MiniflareOptions({log:new Log(LogLevel.NONE), workers:[{name:"osdrive-test",modules:true,scriptPath:resolve('cloudflare/.cloudflare/output/v0/workers/default/bundle/index.js'),
 compatibilityDate:'2026-11-14',compatibilityFlags:['nodejs_compat','nodejs_compat_populate_process_env'],
 bindings:{NODE_ENV:'production',CLOUDFLARE_HOMOLOGATION:'true'},
 serviceBindings:{ASSETS:async request=>{
  const path=new URL(request.url).pathname;
  const target=resolve(assets,'.'+path);
  if(!target.startsWith(assets+'/'))return new Response(null,{status:404});
  try{const body=await readFile(target);return new Response(body,{headers:{'Content-Type':extname(target)==='.html'?'text/html':extname(target)==='.jpg'?'image/jpeg':'application/octet-stream'}});}catch{return new Response(null,{status:404});}
 } } }]}));
try{
 const base='https://sistema-oficinas-homologacao.osdrive-homologacao.workers.dev';
 for(const path of ['/','/inicio','/configuracoes?aba=oficina','/p/fictional-token','/privacidade']){
  const r=await mf.dispatchFetch(base+path);assert.equal(r.status,200,path);assert.equal(r.headers.get('x-frame-options'),'DENY');assert.equal(r.headers.get('cache-control'),'no-store');assert.match(await r.text(),/<!doctype html/i);
 }
 assert.equal((await mf.dispatchFetch(base+'/missing.png')).status,404);
 for(const path of ['/admin-api/users','/api/admin-api','/api/billing/stripe/renew','/api/billing/stripe/webhook'])assert.equal((await mf.dispatchFetch(base+path)).status,403,path);
 assert.equal((await mf.dispatchFetch('https://attacker.example/api/session')).status,403);
 assert.equal((await mf.dispatchFetch(base+'/api/session')).status,503,'Missing secrets must fail closed without remote I/O');
 assert.equal((await mf.dispatchFetch(base+'/inicio',{method:'POST'})).status,405);
 console.log('Workers runtime: 13 routing, assets and fail-closed checks passed; no persistent database connection.');
}finally{await mf.dispose();}
