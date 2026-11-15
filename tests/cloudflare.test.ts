import test from 'node:test';
import assert from 'node:assert/strict';
import { cloudflareOrigin, assertCloudflareConfiguration, cloudflarePath, isCloudflareApi, cloudflareTestTenants } from '../server/cloudflarePolicy.js';
import { assertDevelopmentIsolation } from '../server/developmentIsolation.js';
import { startSession } from '../server/auth/session.js';
import { withDocumentLogo, documentLogoBytes } from '../server/runtimeAssets.js';
const env = {
  CLOUDFLARE_HOMOLOGATION:'true', NODE_ENV:'production', APP_ENV:'development', EXPECTED_DATABASE_PROJECT:'vnclahdnirqlcbamodqy',
  APP_ORIGIN:cloudflareOrigin,APP_ORIGINS:cloudflareOrigin,PUBLIC_ORIGIN:cloudflareOrigin,
  DATABASE_URL:'postgresql://osdrive_local_app.vnclahdnirqlcbamodqy:fictional@aws-1-ca-central-1.pooler.supabase.com:6543/postgres',
  PLATFORM_ADMIN_DATABASE_URL:'postgresql://osdrive_local_admin.vnclahdnirqlcbamodqy:fictional@aws-1-ca-central-1.pooler.supabase.com:6543/postgres',
};
test('parallel Cloudflare requires its exact origin, project and separate restricted roles',()=>{
  assert.doesNotThrow(()=>assertCloudflareConfiguration(env));assert.doesNotThrow(()=>assertDevelopmentIsolation(env));
  for(const patch of [
    {APP_ORIGIN:'https://attacker.workers.dev'}, {APP_ORIGINS:cloudflareOrigin+',https://attacker.workers.dev'},
    {PUBLIC_ORIGIN:'https://osdrive.com.br'}, {CLOUDFLARE_HOMOLOGATION:'false'}, {EXPECTED_DATABASE_PROJECT:'other'},
    {APP_ENV:'horse_power'}, {NODE_ENV:'development'}, {VERCEL:'1'}, {LOCAL_HOMOLOGATION:'true'},
    {STRIPE_BILLING_ENABLED:'true'}, {ENABLE_PAID_VEHICLE_LOOKUP:'true'},
    {DATABASE_URL:env.DATABASE_URL.replace('osdrive_local_app','postgres')},
    {PLATFORM_ADMIN_DATABASE_URL:env.DATABASE_URL},
    {DATABASE_URL:env.DATABASE_URL+'?sslmode=disable'},
    {DATABASE_URL:env.DATABASE_URL.replace('vnclahdnirqlcbamodqy','cbdwgocofigrdigfgwkp')},
  ])assert.throws(()=>assertCloudflareConfiguration({...env,...patch}));
});
test('Cloudflare adapter routes API prefixes without rewriting lookalike or encoded paths',()=>{
  assert.equal(cloudflarePath('/admin-api/users'),'/api/admin-api/users');
  assert.equal(cloudflarePath('/admin-api'),'/api/admin-api');
  for(const p of ['/api/session','/api','/admin-api/users'])assert.equal(isCloudflareApi(p),true);
  for(const p of ['/apiary','/admin-apiary','/API/session','/assets/index.js'])assert.equal(isCloudflareApi(p),false);
});
test('parallel login refuses non-reserved office before writing a session',async()=>{
  const old=process.env.CLOUDFLARE_HOMOLOGATION;process.env.CLOUDFLARE_HOMOLOGATION='true';
  try{await assert.rejects(()=>startSession({prepare(){throw Error('MUST_NOT_WRITE')}} as never,{} as never,'fictional','foreign-office'),/fictícias reservadas/);assert.equal(cloudflareTestTenants.length,3);}
  finally{if(old===undefined)delete process.env.CLOUDFLARE_HOMOLOGATION;else process.env.CLOUDFLARE_HOMOLOGATION=old;}
});
test('document assets remain isolated across concurrent requests',async()=>{
  const results=await Promise.all(['office-a','office-b'].map(value=>withDocumentLogo(async()=>Buffer.from(value),async()=>{await new Promise(resolve=>setTimeout(resolve,5));return(await documentLogoBytes()).toString();})));
  assert.deepEqual(results,['office-a','office-b']);assert.ok((await documentLogoBytes()).length>0);
});

test('Hyperdrive runtime cannot override databases outside the exact parallel environment',async()=>{
  const {createCloudRuntime}=await import('../server/cloudRuntime.js');
  await assert.rejects(()=>createCloudRuntime({hyperdrive:true,operationalUrl:'postgresql://fake:fake@127.0.0.1/test',administrativeUrl:'postgresql://fake:fake@127.0.0.1/test'}),/Hyperdrive exige/);
});
