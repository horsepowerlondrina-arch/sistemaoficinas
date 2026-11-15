import express from 'express';
import {createHash} from 'node:crypto';
import {transaction,type DB} from '../db/database.js';
import type {Context} from '../auth/session.js';
import {requireAdmin} from '../services/payments.js';
import {audit} from '../services/workshop.js';
import {configuredPhotoStore,migrateChecklistPhotos,readPhotoData,type PhotoStore} from '../services/checklistPhotoStorage.js';

export type PhotoMigrationPolicy={photos:number;manifest:string;documents:number;documentDigest:string;expiresAt:number};
const approved:PhotoMigrationPolicy={photos:24,manifest:'53abfc71ca9c62862aae294dadacdef1e3a9ae70b76095c6ccd83ee219a6e194',documents:30,documentDigest:'57a19ae08137281ddb5959e3794fdfb7',expiresAt:Date.parse('2026-11-15T06:00:00Z')};
const prefix='private-checklist:v1:';
const hash=(algorithm:string,value:string|Buffer)=>createHash(algorithm).update(value).digest('hex');
const conflict=()=>Object.assign(new Error('A prévia divergiu do conjunto autorizado. Nenhuma alteração foi mantida.'),{status:409});

export async function photoMigrationState(db:DB,ctx:Context){
 requireAdmin(ctx);
 const rows=await db.prepare('SELECT id,mime,image_data FROM checklist_photos WHERE tenant_id=? ORDER BY id').all(ctx.tenantId);
 let legacy=0,bytes=0;
 const manifest=rows.map(row=>{
  const value=String(row.image_data);let size:number,sha:string;
  if(value.startsWith(prefix)){
   const ref=JSON.parse(value.slice(prefix.length));
   if(typeof ref.key!=='string'||!ref.key.startsWith(encodeURIComponent(ctx.tenantId)+'/')||!Number.isSafeInteger(ref.bytes)||ref.bytes<100||ref.bytes>1600000||!/^[a-f0-9]{64}$/.test(ref.sha256))throw conflict();
   size=ref.bytes;sha=ref.sha256;
  }else{legacy++;const data=Buffer.from(value,'base64');size=data.length;sha=hash('sha256',data);if(size<100||size>1600000)throw conflict();}
  bytes+=size;return `${row.id}\t${row.mime}\t${size}\t${sha}`;
 }).join('\n');
 const documents=await db.prepare('SELECT id,digest FROM document_revisions WHERE tenant_id=? ORDER BY id').all(ctx.tenantId);
 return {photos:rows.length,legacy,private:rows.length-legacy,bytes,manifest:hash('sha256',manifest),documents:documents.length,documentDigest:hash('md5',documents.map(row=>`${row.id}:${row.digest}`).join('|'))};
}
function assertApproved(state:Awaited<ReturnType<typeof photoMigrationState>>,policy:PhotoMigrationPolicy,now:number){
 if(now>=policy.expiresAt)throw Object.assign(new Error('Manutenção temporária expirada.'),{status:404});
 if(state.photos!==policy.photos||state.manifest!==policy.manifest||state.documents!==policy.documents||state.documentDigest!==policy.documentDigest)throw conflict();
}
export async function runPhotoMigration(db:DB,ctx:Context,policy=approved,store=configuredPhotoStore(),now=Date.now()){
 requireAdmin(ctx);
 if(!store)throw new Error('Armazenamento privado não configurado.');
 return transaction(db,async()=>{
  await db.lockTenantMutations?.(ctx.tenantId);
  const before=await photoMigrationState(db,ctx);assertApproved(before,policy,now);
  if(!before.legacy)return {...before,migrated:0};
  const result=await migrateChecklistPhotos(db,ctx.tenantId,3,true,store);
  const after=await photoMigrationState(db,ctx);assertApproved(after,policy,now);
  if(result.migrated!==Math.min(3,before.legacy)||after.legacy!==before.legacy-result.migrated)throw conflict();
  const recorded=await audit(db,ctx,'checklist.private_storage_migrated',ctx.tenantId,{migrated:result.migrated,remaining:after.legacy,manifest:after.manifest,document_count:after.documents,document_digest:after.documentDigest});
  if(!recorded)throw new Error('Auditoria completa indisponível; lote revertido.');
  return {...after,migrated:result.migrated};
 });
}
export async function verifyPhotoMigration(db:DB,ctx:Context,policy=approved,store=configuredPhotoStore('read'),now=Date.now()){
 const before=await photoMigrationState(db,ctx);assertApproved(before,policy,now);
 if(before.legacy)throw conflict();
 const rows=await db.prepare('SELECT image_data FROM checklist_photos WHERE tenant_id=? ORDER BY id').all(ctx.tenantId);
 for(let start=0;start<rows.length;start+=3)await Promise.all(rows.slice(start,start+3).map(row=>readPhotoData(ctx.tenantId,String(row.image_data),store)));
 const after=await photoMigrationState(db,ctx);assertApproved(after,policy,now);
 return {...after,verified:rows.length};
}
function page(state:Awaited<ReturnType<typeof photoMigrationState>>,migrated=0,verified=0){
 return `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Migração autorizada de fotos — Horse Power</title><style>body{font:17px system-ui;max-width:760px;margin:50px auto;padding:24px;color:#172333}button{padding:14px;margin:10px 0}dl{display:grid;grid-template-columns:1fr 1fr;gap:12px}dd{font-weight:bold}code{overflow-wrap:anywhere}</style><h1>Migração autorizada de fotos</h1><p>Somente Horse Power definitiva. Lotes de até três fotos; documentos e revisões não são alterados. A cópia é baixada e conferida antes da troca da referência. Nenhum objeto é excluído.</p><dl><dt>Fotos</dt><dd>${state.photos}</dd><dt>A migrar</dt><dd>${state.legacy}</dd><dt>Privadas</dt><dd>${state.private}</dd><dt>Bytes preservados</dt><dd>${state.bytes}</dd><dt>Revisões preservadas</dt><dd>${state.documents}</dd><dt>Migradas neste lote</dt><dd>${migrated}</dd><dt>Fotos verificadas no Storage</dt><dd>${verified}</dd></dl><p>Assinatura do conjunto: <code>${state.manifest}</code></p>${state.legacy?`<form method="post" action="/api/photo-migration"><input type="hidden" name="confirm" value="migrar-24-fotos-autorizadas"><button type="submit">Migrar próximo lote de até 3 fotos</button></form>`:`<p>Migração concluída. Verifique os bytes armazenados antes de encerrar.</p><a href="/api/photo-migration?verify=1">Conferir integridade de todas as fotos no Storage</a>`}<p><a href="/sistema/checklists">Voltar aos checklists</a></p></html>`;
}
export function photoMigrationRoutes(db:DB){
 const router=express.Router();
 router.use((_req,res,next)=>{
  if(process.env.APP_ENV!=='horse_power'||process.env.EXPECTED_DATABASE_PROJECT!=='rvlovjpquozbrsszsxwe'||Date.now()>=approved.expiresAt){res.status(404).json({error:'Manutenção indisponível.'});return;}
  requireAdmin(res.locals.context);res.set('Referrer-Policy','same-origin');res.set('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'");next();
 });
 router.get('/',async(req,res)=>{
  const state=req.query.verify==='1'?await verifyPhotoMigration(db,res.locals.context):await photoMigrationState(db,res.locals.context);
  assertApproved(state,approved,Date.now());res.type('html').send(page(state,0,'verified' in state?Number(state.verified):0));
 });
 router.post('/',express.urlencoded({extended:false,limit:'2kb',parameterLimit:2}),async(req,res)=>{
  if(!req.headers.origin||req.headers.origin!==process.env.APP_ORIGIN)throw Object.assign(new Error('Origem não autorizada.'),{status:403});
  if(req.body?.confirm!=='migrar-24-fotos-autorizadas')throw conflict();
  const result=await runPhotoMigration(db,res.locals.context);res.type('html').send(page(result,result.migrated));
 });
 return router;
}
