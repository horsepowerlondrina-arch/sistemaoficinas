import test from 'node:test';
import assert from 'node:assert/strict';
import {createDatabase} from '../server/db/database.js';
import {createChecklist,addChecklistPhoto} from '../server/services/checklists.js';
import {withPhotoStore,type PhotoStore} from '../server/services/checklistPhotoStorage.js';
import {photoMigrationState,runPhotoMigration,verifyPhotoMigration} from '../server/maintenance/hpPhotoMigration.js';
import {createApp} from '../server/app.js';
import {digest} from '../server/auth/session.js';
const ctx={tenantId:'a',userId:'u',role:'owner'};
async function fixture(){
 const db=createDatabase(':memory:');
 db.exec("INSERT INTO tenants(id,name) VALUES('a','Fictícia A'),('b','Fictícia B'); INSERT INTO users(id,name,email,password_hash) VALUES('u','Fictício','u@example.test','disabled'),('m','Operador','m@example.test','disabled'); INSERT INTO memberships VALUES('u','a','owner'),('m','a','operator');");
 const c=await createChecklist(db,ctx,{plate:'ABC1D23',customer_name:'Cliente fictício',vehicle_data:{brand:'Honda',model:'Civic',year:2020,color:'Prata'},inspector:'Teste fictício'});
 await withPhotoStore(null,async()=>{for(let i=0;i<5;i++)await addChecklistPhoto(db,ctx,c.id,'front','image/jpeg',Buffer.alloc(200,10+i));});
 const before=await photoMigrationState(db,ctx),policy={photos:before.photos,manifest:before.manifest,documents:before.documents,documentDigest:before.documentDigest,expiresAt:Date.now()+60000};
 const files=new Map<string,Buffer>();const store:PhotoStore={async put(k,b){files.set(k,Buffer.from(b));},async get(k){return files.get(k)!;}};
 return {db,before,policy,store,files};
}
test('approved photo migration: bounded batches, stable content, idempotency and immutable documents',async()=>{
 const {db,before,policy,store,files}=await fixture();try{
  const first=await runPhotoMigration(db,ctx,policy,store);assert.equal(first.migrated,3);assert.equal(first.legacy,2);assert.equal(first.manifest,before.manifest);
  const last=await runPhotoMigration(db,ctx,policy,store);assert.equal(last.migrated,2);assert.equal(last.private,5);
  assert.equal((await runPhotoMigration(db,ctx,policy,store)).migrated,0);assert.equal(files.size,5);
  assert.equal((await verifyPhotoMigration(db,ctx,policy,store)).verified,5);
  const after=await photoMigrationState(db,ctx);assert.equal(after.documentDigest,before.documentDigest);assert.equal(after.bytes,before.bytes);
  assert.equal(db.prepare("SELECT count(*) n FROM audit_events WHERE action='checklist.private_storage_migrated'").get()!.n,2);
 }finally{db.close();}
});
test('bad hash mid-batch rolls back all SQL; outside scope, operator, expiry and changed manifest are blocked',async()=>{
 const {db,before,policy,store,files}=await fixture();try{
  const original=JSON.stringify(db.prepare('SELECT id,image_data FROM checklist_photos ORDER BY id').all());let uploads=0;
  const bad:PhotoStore={async put(k,b){uploads++;files.set(k,Buffer.from(b));},async get(k){return uploads===2?Buffer.alloc(200):files.get(k)!;}};
  await assert.rejects(runPhotoMigration(db,ctx,policy,bad),/integridade/);assert.equal(JSON.stringify(db.prepare('SELECT id,image_data FROM checklist_photos ORDER BY id').all()),original);
  assert.equal((await photoMigrationState(db,ctx)).legacy,5);
  await assert.rejects(runPhotoMigration(db,{...ctx,role:'operator'},policy,store),/administrador/);
  await assert.rejects(runPhotoMigration(db,{...ctx,tenantId:'b'},policy,store),/prévia/);
  await assert.rejects(runPhotoMigration(db,ctx,{...policy,expiresAt:0},store),/expirada/);
  await assert.rejects(runPhotoMigration(db,ctx,{...policy,manifest:'0'.repeat(64)},store),/prévia/);
  assert.equal((await photoMigrationState(db,ctx)).manifest,before.manifest);
 }finally{db.close();}
});
test('maintenance HTTP preserves authentication, owner authorization and origin; no access outside definitive project',async()=>{
 const {db}=await fixture();const old={APP_ENV:process.env.APP_ENV,EXPECTED_DATABASE_PROJECT:process.env.EXPECTED_DATABASE_PROJECT,APP_ORIGIN:process.env.APP_ORIGIN};
 const server=createApp(db as any).listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const port=(server.address() as any).port;
 try{
  process.env.APP_ENV='horse_power';process.env.EXPECTED_DATABASE_PROJECT='rvlovjpquozbrsszsxwe';process.env.APP_ORIGIN='http://localhost:5173';
  for(const [token,user] of [['owner-test','u'],['operator-test','m']])db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(digest(token),user,'a',Date.now()+60000);
  const call=(token='',method='GET',body?:string)=>fetch(`http://127.0.0.1:${port}/api/photo-migration`,{method,headers:token?{Cookie:`hp_session=${token}`,'Content-Type':'application/x-www-form-urlencoded'}:{},body});
  assert.equal((await call()).status,401);assert.equal((await call('operator-test')).status,403);
  assert.equal((await call('owner-test')).status,409);
  assert.equal((await call('owner-test','POST','confirm=migrar-24-fotos-autorizadas')).status,403);
  process.env.APP_ENV='development';assert.equal((await call('owner-test')).status,404);
 }finally{await new Promise<void>((r,e)=>server.close(x=>x?e(x):r()));db.close();for(const[k,v]of Object.entries(old)){if(v===undefined)delete process.env[k];else process.env[k]=v;}}
});
