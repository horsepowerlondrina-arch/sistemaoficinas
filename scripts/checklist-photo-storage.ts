import {createPostgresDatabase} from '../server/db/postgres.js';
import {migrateChecklistPhotos,cleanupChecklistPhotoOrphans} from '../server/services/checklistPhotoStorage.js';
import {audit} from '../server/services/workshop.js';
const project='vnclahdnirqlcbamodqy';
const tenant=process.env.PHOTO_TENANT_ID||'';
const apply=process.env.PHOTO_APPLY==='true';
const cleanup=process.env.PHOTO_OPERATION==='cleanup';
const connection=process.env.PHOTO_DATABASE_URL||'';
const url=new URL(connection);
if(process.env.GITHUB_ACTIONS!=='true'||process.env.GITHUB_EVENT_NAME!=='workflow_dispatch'||!/^feat\/checklist-private-storage$|^main$/.test(process.env.GITHUB_REF_NAME||'')||!/^[-a-f0-9]{36}$/.test(tenant)||process.env.CHECKLIST_STORAGE_URL!==`https://${project}.supabase.co`||!(url.hostname===`db.${project}.supabase.co`||url.hostname.endsWith('.pooler.supabase.com')&&decodeURIComponent(url.username).endsWith('.'+project))||url.pathname!=='/postgres')throw Error('Execução fora do ambiente de homologação autorizado.');
const db=createPostgresDatabase(connection);
try{
 await db.withRequestContext!({'app.tenant_id':tenant},async()=>{
  const owner=await db.prepare("SELECT user_id FROM memberships WHERE tenant_id=? AND role='owner' ORDER BY user_id LIMIT 1").get(tenant);
  if(!owner)throw Error('Oficina sem proprietário autorizado.');
  await db.setRequestIdentity!(tenant,String(owner.user_id));
  const result=cleanup?await cleanupChecklistPhotoOrphans(db,tenant,Number(process.env.PHOTO_OFFSET||0),apply):await migrateChecklistPhotos(db,tenant,10,apply);
  if(apply)await audit(db,{tenantId:tenant,userId:String(owner.user_id),role:'owner'},cleanup?'checklist.private_storage_cleanup':'checklist.private_storage_migrated',tenant);
  console.log(JSON.stringify({operation:cleanup?'cleanup':'migrate',apply,...result}));
 });
}catch{console.error('Lote não concluído. Alterações SQL revertidas; fotos de origem preservadas. Consulte a prévia e a configuração sem expor segredos.');process.exitCode=1;}
finally{await db.close();}
