import test from 'node:test';
import assert from 'node:assert/strict';
import {createDatabase} from '../server/db/database.js';
import {readPhotoData,storePhotoData,portablePhotoRow,withPhotoStore,assertPortablePhoto,migrateChecklistPhotos,configuredPhotoStore,type PhotoStore} from '../server/services/checklistPhotoStorage.js';
function fixture(){const files=new Map<string,Buffer>();const store:PhotoStore={async put(k,d){if(files.has(k))throw Error('overwrite');files.set(k,Buffer.from(d));},async get(k){const b=files.get(k);if(!b)throw Error('missing');return b;}};return {files,store};}
const image=Buffer.alloc(200,42);
test('legacy photos remain readable with missing or invalid remote configuration',async t=>{
 const saved={...process.env};
 t.after(()=>{for(const k of ['CHECKLIST_STORAGE_ENABLED','CHECKLIST_STORAGE_URL','CHECKLIST_STORAGE_SECRET','EXPECTED_DATABASE_PROJECT']){if(saved[k]===undefined)delete process.env[k];else process.env[k]=saved[k];}});
 process.env.CHECKLIST_STORAGE_ENABLED='true';process.env.CHECKLIST_STORAGE_URL='invalid';delete process.env.CHECKLIST_STORAGE_SECRET;
 assert.deepEqual(await readPhotoData('legacy',image.toString('base64')),image);
 assert.deepEqual(await portablePhotoRow('legacy',{image_data:image.toString('base64')}),{image_data:image.toString('base64')});
});
test('private reads survive disabling new private uploads and reject another project',async t=>{
 const saved={...process.env};
 t.after(()=>{for(const k of ['CHECKLIST_STORAGE_ENABLED','CHECKLIST_STORAGE_URL','CHECKLIST_STORAGE_SECRET','EXPECTED_DATABASE_PROJECT']){if(saved[k]===undefined)delete process.env[k];else process.env[k]=saved[k];}});
 const {store}=fixture();const ref=await storePhotoData('own',image,'image/png',store);
 process.env.CHECKLIST_STORAGE_ENABLED='false';process.env.CHECKLIST_STORAGE_URL='https://aaaaaaaaaaaaaaaaaaaa.supabase.co';process.env.CHECKLIST_STORAGE_SECRET='fictional-ci-only';process.env.EXPECTED_DATABASE_PROJECT='aaaaaaaaaaaaaaaaaaaa';
 let calls=0;t.mock.method(globalThis,'fetch',async(url:URL,init:RequestInit)=>{calls++;assert.equal(url.hostname,'aaaaaaaaaaaaaaaaaaaa.supabase.co');assert.ok(url.pathname.startsWith('/storage/v1/object/authenticated/checklist-photos/own/'));assert.equal(init.redirect,'error');return new Response(new Uint8Array(image));});
 assert.equal(configuredPhotoStore(),null);
 assert.equal(await storePhotoData('own',image,'image/png'),image.toString('base64'));
 assert.deepEqual(await readPhotoData('own',ref),image);assert.equal(calls,1);
 process.env.EXPECTED_DATABASE_PROJECT='bbbbbbbbbbbbbbbbbbbb';
 await assert.rejects(readPhotoData('own',ref),/outro projeto/);assert.equal(calls,1);
});
test('private storage round trip; reference contains no image bytes; no cross-tenant reads',async()=>{
 const {store,files}=fixture();const value=await storePhotoData('tenant-a',image,'image/jpeg',store);
 assert.ok(value.startsWith('private-checklist:v1:'));assert.ok(!value.includes(image.toString('base64')));assert.equal(files.size,1);
 const portable=await withPhotoStore(store,()=>portablePhotoRow('tenant-a',{id:'p',image_data:value}));assert.equal(portable.image_data,image.toString('base64'));
 assert.deepEqual(await readPhotoData('tenant-a',value,store),image);
 await assert.rejects(readPhotoData('tenant-b',value,store),/inválida/);
});
test('legacy bytes work with storage disabled; portable packages reject references',async()=>{
 const legacy=image.toString('base64');assert.deepEqual(await readPhotoData('t',legacy,null),image);
 assert.equal(await storePhotoData('t',image,'image/jpeg',null),legacy);
 assertPortablePhoto(legacy);assert.throws(()=>assertPortablePhoto('private-checklist:v1:{}'));
 assert.deepEqual(await portablePhotoRow('t',{id:'p',image_data:legacy}),{id:'p',image_data:legacy});
});
test('corruption, missing files and unavailable store never silently return a photo',async()=>{
 const {store,files}=fixture();const ref=await storePhotoData('t',image,'image/png',store);
 await assert.rejects(readPhotoData('t',ref,null),/não configurado/);
 const key=[...files.keys()][0];files.set(key,Buffer.alloc(200,1));await assert.rejects(readPhotoData('t',ref,store),/integridade/);
 files.delete(key);await assert.rejects(readPhotoData('t',ref,store),/missing/);
 const broken:PhotoStore={async put(){},async get(){return Buffer.alloc(200);}};
 await assert.rejects(storePhotoData('t',image,'image/png',broken),/integridade/);
});
test('migration dry run, verified copy, repeat and cross-tenant isolation',async()=>{
 const db=createDatabase(':memory:');const {store,files}=fixture();
 try{
 db.prepare('INSERT INTO tenants(id,name) VALUES(?,?)').run('a','A');db.prepare('INSERT INTO tenants(id,name) VALUES(?,?)').run('b','B');
 // Exercise the bounded migration with an isolated minimal table, independent of checklist fixtures.
 db.exec('PRAGMA foreign_keys=OFF');
 for(const tenant of ['a','b'])db.prepare("INSERT INTO checklist_photos(id,tenant_id,checklist_id,kind,mime,image_data) VALUES(?,?,?,'front','image/jpeg',?)").run(tenant,tenant,'dummy',image.toString('base64'));
 assert.deepEqual(await migrateChecklistPhotos(db,'a',10,false,store),{inspected:1,migrated:0});assert.equal(files.size,0);
 assert.deepEqual(await migrateChecklistPhotos(db,'a',10,true,store),{inspected:1,migrated:1});
 assert.deepEqual(await migrateChecklistPhotos(db,'a',10,true,store),{inspected:0,migrated:0});
 assert.equal(db.prepare('SELECT image_data FROM checklist_photos WHERE tenant_id=?').get('b')?.image_data,image.toString('base64'));
 const stored=String(db.prepare('SELECT image_data FROM checklist_photos WHERE tenant_id=?').get('a')?.image_data);assert.deepEqual(await readPhotoData('a',stored,store),image);
 }finally{db.close();}
});
test('cleanup keeps referenced/recent files; dry run never deletes; only own old orphan removed',async()=>{
 const {cleanupChecklistPhotoOrphans}=await import('../server/services/checklistPhotoStorage.js');
 const db=createDatabase(':memory:');const {store,files}=fixture();
 try{
 db.exec('PRAGMA foreign_keys=OFF');const saved=await storePhotoData('a',image,'image/jpeg',store);
 db.prepare("INSERT INTO checklist_photos(id,tenant_id,checklist_id,kind,mime,image_data) VALUES('p','a','c','front','image/jpeg',?)").run(saved);
 const used=[...files.keys()][0].split('/')[1];const old='11111111-1111-1111-1111-111111111111',recent='22222222-2222-2222-2222-222222222222';const deleted:string[]=[];
 store.list=async prefix=>{assert.equal(prefix,'a/');return [{name:used,created_at:'2026-01-01'},{name:old,created_at:'2026-01-01'},{name:recent,created_at:'2026-11-13'},{name:'../b/foreign',created_at:'2026-01-01'}];};store.remove=async keys=>{deleted.push(...keys);};
 const now=new Date('2026-11-14T12:00:00Z');assert.equal((await cleanupChecklistPhotoOrphans(db,'a',0,false,store,now)).eligible,1);assert.deepEqual(deleted,[]);
 assert.equal((await cleanupChecklistPhotoOrphans(db,'a',0,true,store,now)).removed,1);assert.deepEqual(deleted,['a/'+old]);
 }finally{db.close();}
});
