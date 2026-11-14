import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {adminClient} from '../scripts/local-admin.js';
import {createLocalDatabase} from '../server/db/local.js';
import {migrateChecklistPhotos,type PhotoStore} from '../server/services/checklistPhotoStorage.js';
test('PostgreSQL 17: private photo migration checks integrity, rollback, repeat and tenant RLS',async()=>{
 const owner=adminClient();await owner.connect();const db=await createLocalDatabase();
 const tenant=randomUUID(),other=randomUUID(),user=randomUUID();
 const data=Buffer.alloc(200,17),files=new Map<string,Buffer>();
 const store:PhotoStore={async put(key,value){files.set(key,Buffer.from(value));},async get(key){return files.get(key)!;}};
 try{
  await owner.query("INSERT INTO horse_power.tenants(id,name) VALUES($1,'Foto A fictícia'),($2,'Foto B fictícia')",[tenant,other]);
  await owner.query("INSERT INTO horse_power.users(id,name,email,password_hash) VALUES($1,'Teste Foto',$2,'unused')",[user,user+'@example.test']);
  await owner.query("INSERT INTO horse_power.memberships(user_id,tenant_id,role) VALUES($1,$2,'owner')",[user,tenant]);
  // A real checklist is created with the service to exercise the current schema.
  const {createChecklist,addChecklistPhoto,getChecklistPhoto}=await import('../server/services/checklists.js');
  const {withPhotoStore}=await import('../server/services/checklistPhotoStorage.js');
  const ctx={tenantId:tenant,userId:user,role:'owner'};
  await db.withRequestContext!({'app.tenant_id':tenant,'app.user_id':user},async()=>{
    const created=await createChecklist(db,ctx,{plate:'ABC1D23',customer_name:'Cliente fictício',vehicle_data:{brand:'Honda',model:'Civic',year:2020,color:'Prata'},inspector:'Teste Foto'});
    const result=await withPhotoStore(store,()=>addChecklistPhoto(db,ctx,created.id,'front','image/jpeg',data));
    const saved=await db.prepare('SELECT image_data FROM checklist_photos WHERE tenant_id=? AND id=?').get(tenant,result.id);assert.match(String(saved?.image_data),/^private-checklist:v1:/);
    const loaded=await withPhotoStore(store,()=>getChecklistPhoto(db,ctx,result.id));assert.deepEqual(Buffer.from(loaded.image_data,'base64'),data);
    await db.prepare('UPDATE checklist_photos SET image_data=? WHERE tenant_id=? AND id=?').run(data.toString('base64'),tenant,result.id);
    const dry=await migrateChecklistPhotos(db,tenant,10,false,store);assert.equal(dry.migrated,0);
    const bad:PhotoStore={async put(){},async get(){return Buffer.alloc(200);}};
    await assert.rejects(migrateChecklistPhotos(db,tenant,10,true,bad),/integridade/);
    assert.equal((await db.prepare('SELECT image_data FROM checklist_photos WHERE tenant_id=? AND id=?').get(tenant,result.id))?.image_data,data.toString('base64'));
    assert.equal((await migrateChecklistPhotos(db,tenant,10,true,store)).migrated,1);
    assert.equal((await migrateChecklistPhotos(db,tenant,10,true,store)).migrated,0);
    const {createWorkshopTransfer}=await import('../server/services/dataTransferExport.js');
    const {openTransferPackage}=await import('../shared/transferPackage.js');
    const pkg=await withPhotoStore(store,()=>createWorkshopTransfer(db,tenant,'fictional-private-photo-passphrase'));
    const payload=openTransferPackage(pkg,'fictional-private-photo-passphrase');
    assert.equal(payload.records.checklist_photos?.[0].image_data,data.toString('base64'));
    assert.ok(!JSON.stringify(payload).includes('private-checklist:v1:'));

    await assert.rejects(withPhotoStore(store,()=>getChecklistPhoto(db,{...ctx,tenantId:other},result.id)),/não encontrada/);
    assert.equal((await migrateChecklistPhotos(db,other,10,true,store)).inspected,0);
  });
 }finally{await db.close();await owner.end();}
});
