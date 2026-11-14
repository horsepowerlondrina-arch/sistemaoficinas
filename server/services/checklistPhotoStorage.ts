import {AsyncLocalStorage} from "node:async_hooks";
import { createHash, randomUUID } from 'node:crypto';
import type { DB } from '../db/database.js';
const prefix = 'private-checklist:v1:';
const bucket = 'checklist-photos';
const maxBytes = 1600000;
const storeContext=new AsyncLocalStorage<PhotoStore|null>();
export function withPhotoStore<T>(store:PhotoStore|null,callback:()=>Promise<T>){return storeContext.run(store,callback);}
type Reference = { key: string; sha256: string; bytes: number };
export interface PhotoStore { put(key:string,data:Buffer,mime:string):Promise<void>; get(key:string):Promise<Buffer>; list?(tenantPrefix:string,offset:number):Promise<{name:string;created_at:string}[]>; remove?(keys:string[]):Promise<void>; }
function digest(data:Buffer){return createHash('sha256').update(data).digest('hex');}
function reference(value:string,tenant:string):Reference|null {
  if(!value.startsWith(prefix)) return null;
  let parsed:Reference;
  try {parsed=JSON.parse(value.slice(prefix.length));}catch{throw Error('Referência privada de foto inválida.');}
  if(!parsed || typeof parsed.key!=='string' || !parsed.key.startsWith(encodeURIComponent(tenant)+'/') || !/^[a-zA-Z0-9%_-]+\/[a-f0-9-]+$/.test(parsed.key) || !/^[a-f0-9]{64}$/.test(parsed.sha256) || !Number.isInteger(parsed.bytes) || parsed.bytes<100 || parsed.bytes>maxBytes) throw Error('Referência privada de foto inválida.');
  return parsed;
}
export function configuredPhotoStore():PhotoStore|null {
  const bound=storeContext.getStore();if(bound!==undefined)return bound;
  if(process.env.CHECKLIST_STORAGE_ENABLED!=='true')return null;
  const url=new URL(process.env.CHECKLIST_STORAGE_URL||'');
  if(url.protocol!=='https:' || !/^[a-z]{20}\.supabase\.co$/.test(url.hostname) || url.pathname!=='/' || url.search || url.username || url.password)throw Error('Armazenamento privado não configurado.');
  const key=process.env.CHECKLIST_STORAGE_SECRET;
  if(!key)throw Error('Armazenamento privado não configurado.');
  const request=async(path:string,init:RequestInit={})=>{
    const response=await fetch(new URL('/storage/v1/'+path,url),{...init,redirect:'error',signal:AbortSignal.timeout(20000),headers:{apikey:key,Authorization:`Bearer ${key}`,...init.headers}});
    if(!response.ok){await response.body?.cancel();throw Error('Armazenamento privado temporariamente indisponível.');}
    return response;
  };
  return {
    async list(prefix,offset){const response=await request("object/list/"+bucket,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({prefix,limit:100,offset,sortBy:{column:"name",order:"asc"}})});return await response.json() as {name:string;created_at:string}[];},
    async remove(keys){await request("object/"+bucket,{method:"DELETE",headers:{"Content-Type":"application/json"},body:JSON.stringify({prefixes:keys})});},
    async put(path,data,mime){await request('object/'+bucket+'/'+path,{method:'POST',headers:{'Content-Type':mime,'x-upsert':'false'},body:new Uint8Array(data)});},
    async get(path){const response=await request('object/authenticated/'+bucket+'/'+path);const length=Number(response.headers.get('content-length'));if(length>maxBytes){await response.body?.cancel();throw Error('Foto privada inválida.');}const reader=response.body?.getReader();if(!reader)throw Error('Foto privada inválida.');const chunks:Buffer[]=[];let size=0;try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>maxBytes)throw Error('Foto privada inválida.');chunks.push(Buffer.from(part.value));}}finally{await reader.cancel();}return Buffer.concat(chunks);}
  };
}
export async function readPhotoData(tenant:string,value:string,store=configuredPhotoStore()):Promise<Buffer>{
  const ref=reference(value,tenant);
  if(!ref)return Buffer.from(value,'base64');
  if(!store)throw Error('Armazenamento privado não configurado para esta foto.');
  const data=await store.get(ref.key);
  if(data.length!==ref.bytes||digest(data)!==ref.sha256)throw Error('A integridade da foto privada não pôde ser confirmada.');
  return data;
}
export async function storePhotoData(tenant:string,data:Buffer,mime:string,store=configuredPhotoStore()):Promise<string>{
  if(!store)return data.toString('base64');
  const key=encodeURIComponent(tenant)+'/'+randomUUID();
  await store.put(key,data,mime);
  const verified=await store.get(key);
  if(verified.length!==data.length||digest(verified)!==digest(data))throw Error('A integridade da foto privada não pôde ser confirmada.');
  return prefix+JSON.stringify({key,sha256:digest(data),bytes:data.length});
}
/** Portable representations must never contain bucket keys or references. */
export async function portablePhotoRow<T extends Record<string,unknown>>(tenant:string,row:T):Promise<T>{
  if(typeof row.image_data!=='string'||!row.image_data.startsWith(prefix))return row;
  return {...row,image_data:(await readPhotoData(tenant,row.image_data)).toString('base64')};
}
export function assertPortablePhoto(value:unknown){if(typeof value!=='string'||value.startsWith(prefix)|| !/^[A-Za-z0-9+/]*={0,2}$/.test(value))throw Error('O pacote contém uma foto sem conteúdo portátil.');}
/** One bounded, idempotent batch. Old bytes are retained unless upload+download hash match. */
export async function migrateChecklistPhotos(db:DB,tenant:string,limit=10,apply=false,store=configuredPhotoStore()){
  if(!Number.isInteger(limit)||limit<1||limit>20)throw Error('Lote inválido.');
  const rows=await db.prepare("SELECT id,mime,image_data FROM checklist_photos WHERE tenant_id=? AND image_data NOT LIKE 'private-checklist:v1:%' ORDER BY id LIMIT ?").all(tenant,limit);
  let migrated=0;
  for(const row of rows){if(!apply)continue;if(!store)throw Error('Armazenamento privado não configurado.');const value=await storePhotoData(tenant,Buffer.from(String(row.image_data),'base64'),String(row.mime),store);const result=await db.prepare('UPDATE checklist_photos SET image_data=? WHERE tenant_id=? AND id=? AND image_data=?').run(value,tenant,row.id,row.image_data);migrated+=Number(result.changes);}
  return {inspected:rows.length,migrated};
}

/** Never expires referenced files. Dry-run by default; only unreferenced objects older than 30 days. */
export async function cleanupChecklistPhotoOrphans(db:DB,tenant:string,offset=0,apply=false,store=configuredPhotoStore(),now=new Date()){
 if(!store?.list||!store.remove)throw Error('Limpeza privada não configurada.');
 if(!Number.isInteger(offset)||offset<0)throw Error('Página inválida.');
 const directory=encodeURIComponent(tenant)+'/';
 const objects=await store.list(directory,offset);
 const rows=await db.prepare("SELECT image_data FROM checklist_photos WHERE tenant_id=? AND image_data LIKE 'private-checklist:v1:%'").all(tenant);
 const used=new Set(rows.map(row=>reference(String(row.image_data),tenant)!.key));
 const candidates=objects.filter(item=>/^[a-f0-9-]+$/.test(item.name)&&Number.isFinite(Date.parse(item.created_at))&&Date.parse(item.created_at)<now.getTime()-30*86400000&&!used.has(directory+item.name)).map(item=>directory+item.name);
 if(apply&&candidates.length)await store.remove(candidates);
 return {inspected:objects.length,eligible:candidates.length,removed:apply?candidates.length:0,nextOffset:objects.length===100?offset+(apply?objects.length-candidates.length:objects.length):null};
}
