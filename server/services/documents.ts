import { vehicleDisplayModel } from "../../shared/vehicleIdentity.js";
import { createHash, randomUUID } from "node:crypto";
import { transaction, type DB } from "../db/database.js";
import type { Context } from "../auth/session.js";
import { requireAdmin } from "./payments.js";
import { scoped, audit } from "./workshop.js";
import { getChecklist } from "./checklists.js";
import { workshopIdentity } from "../../shared/workshopIdentity.js";
import { customerPayments } from "../../shared/customerPayments.js";
import type { CustomerPaymentSummary } from "../../shared/customerPayments.js";
import type { WorkshopIdentity } from "../../shared/workshopIdentity.js";
export type DocumentKind="order"|"checklist";
export interface PublicOrderDocument {
 shop:WorkshopIdentity;
 number:number;
 kind:string;
 status:string;
 customer:string;
 vehicle?:string;
 plate?:string;
 entered_on:string;
 total:number;
 discount:number;
 items:{kind:string;name:string;quantity:number;price:number}[];
 payment_summary:CustomerPaymentSummary|null;
 revision:number;
 issued_at:string;
 quote_valid_until?:string;
}
export interface HistoricalShareUnavailable { historical_unavailable:true; shop:WorkshopIdentity; customer?:string; total?:number; payment_summary:null }
async function source(db:DB,ctx:Context,kind:DocumentKind,id:string){
 if(kind==="checklist"){requireAdmin(ctx);return getChecklist(db,ctx,id);}
 return scoped(db,"orders",ctx.tenantId,id);
}
export async function documentHistory(db:DB,ctx:Context,kind:DocumentKind,id:string){
 const entity=await source(db,ctx,kind,id);
 return {legacy:!!entity.identity_legacy,revisions:await db.prepare("SELECT revision,issued_at,digest FROM document_revisions WHERE tenant_id=? AND kind=? AND entity_id=? AND NOT EXISTS (SELECT 1 FROM data_transfer_archived_documents a WHERE a.tenant_id=document_revisions.tenant_id AND a.revision_id=document_revisions.id) ORDER BY revision DESC").all(ctx.tenantId,kind,id)};
}
export async function readDocument(db:DB,ctx:Context,kind:DocumentKind,id:string,revision:number){
 await source(db,ctx,kind,id);
 const row=await db.prepare("SELECT payload,digest FROM document_revisions WHERE tenant_id=? AND kind=? AND entity_id=? AND revision=? AND NOT EXISTS (SELECT 1 FROM data_transfer_archived_documents a WHERE a.tenant_id=document_revisions.tenant_id AND a.revision_id=document_revisions.id)").get(ctx.tenantId,kind,id,revision);
 if(!row)throw Object.assign(new Error("Revisão não encontrada nesta oficina."),{status:404});
 if(createHash("sha256").update(String(row.payload)).digest("hex")!==row.digest)throw new Error("Integridade do documento inválida.");
 return JSON.parse(row.payload);
}
export async function listArchivedDocuments(db:DB,ctx:Context){
 requireAdmin(ctx);
 return db.prepare("SELECT a.revision_id AS id,a.kind,a.entity_id,a.revision,r.issued_at,r.digest,a.archived_at FROM data_transfer_archived_documents a JOIN document_revisions r ON r.tenant_id=a.tenant_id AND r.id=a.revision_id WHERE a.tenant_id=? ORDER BY r.issued_at DESC,a.revision_id").all(ctx.tenantId);
}
export async function readArchivedDocument(db:DB,ctx:Context,id:string){
 requireAdmin(ctx);
 const row=await db.prepare("SELECT a.revision_id AS id,a.kind,a.entity_id,a.revision,a.archived_at,r.issued_at,r.payload,r.digest FROM data_transfer_archived_documents a JOIN document_revisions r ON r.tenant_id=a.tenant_id AND r.id=a.revision_id WHERE a.tenant_id=? AND a.revision_id=?").get(ctx.tenantId,id);
 if(!row)throw Object.assign(new Error("Documento histórico não encontrado nesta oficina."),{status:404});
 if(createHash("sha256").update(String(row.payload)).digest("hex")!==row.digest)throw new Error("Integridade do documento histórico inválida.");
 return {archive:{id:row.id,kind:row.kind,entity_id:row.entity_id,revision:row.revision,issued_at:row.issued_at,archived_at:row.archived_at},document:JSON.parse(row.payload)};
}
export async function issueDocument(
 db:DB,
 ctx:Context,
 kind:DocumentKind,
 id:string,
 newRevision=false,
 currentOrderRefresh=false,
){
 if(currentOrderRefresh && kind!=="order")
  throw Object.assign(new Error("A visualização atual só se aplica a OS."),{status:400});
 if(newRevision && !currentOrderRefresh)requireAdmin(ctx);
 return transaction(db,async()=>{
  const entity=await source(db,ctx,kind,id);
  const history=await documentHistory(db,ctx,kind,id);
  const modernOrder=kind==="order"&&!entity.identity_legacy;
  const draftOrder=modernOrder&&entity.status!=="completed";
  if(modernOrder&&entity.status==="completed"&&history.revisions.length){
   const frozen=await readDocument(db,ctx,kind,id,Number(history.revisions[0].revision));
   if(frozen.order?.status==="completed"&&frozen.order.completed_on===entity.completed_on){
    const receipt=await db.prepare("SELECT * FROM receivables WHERE tenant_id=? AND order_id=?").get(ctx.tenantId,id);
    const payments=receipt?await db.prepare("SELECT receivable_id,method,gross,status,paid_at FROM payment_installments WHERE tenant_id=? AND receivable_id=? ORDER BY sequence").all(ctx.tenantId,receipt.id):[];
    return {...frozen,order:{...frozen.order,total:entity.total,discount:entity.discount,payment_summary:customerPayments(entity.status,receipt,payments)}};
   }
  }
  if(history.revisions.length&&!newRevision&&!modernOrder)return readDocument(db,ctx,kind,id,Number(history.revisions[0].revision));
  if(entity.identity_legacy&&!newRevision)throw Object.assign(new Error("Documento legado sem snapshot: a identidade originalmente emitida não foi registrada. Emita uma nova revisão explicitamente; as emissões anteriores não serão reconstruídas."),{status:409});
  const shopRow=(await db.prepare("SELECT * FROM tenants WHERE id=?").get(ctx.tenantId))!;
  const shop=workshopIdentity(shopRow);
  // Capture static legacy logo bytes as part of the artifact, never a mutable file reference.
  if(shop.document_logo==="/brand/icon.jpg"){
   const {readFileSync}=await import("node:fs");
   shop.document_logo="data:image/jpeg;base64,"+readFileSync(new URL("../../public/brand/icon.jpg",import.meta.url)).toString("base64");
  }
  const issuedAt=new Date().toISOString();
  const highest=await db.prepare("SELECT revision FROM document_revisions WHERE tenant_id=? AND kind=? AND entity_id=? ORDER BY revision DESC LIMIT 1").get(ctx.tenantId,kind,id);
  const revision=draftOrder?0:Number(highest?.revision||history.revisions[0]?.revision||0)+1;
  const payload:Record<string,any>={schema_version:1,kind,entity_id:id,revision,issued_at:issuedAt,reissued_legacy:!!entity.identity_legacy,shop};
  if(kind==="order"){
   const keys=["id","number","kind","status","entered_on","due_on","completed_on","km","problem","notes","discount","total","guest_name","guest_plate","guest_vehicle"];
   const order:Record<string,any>={};for(const k of keys)order[k]=entity[k];
   order.items=await db.prepare("SELECT id,kind,name,quantity,price FROM order_items WHERE tenant_id=? AND order_id=? ORDER BY id").all(ctx.tenantId,id);
   const customer=entity.customer_id?await scoped(db,"customers",ctx.tenantId,entity.customer_id):null;
   const vehicle=entity.vehicle_id?await scoped(db,"vehicles",ctx.tenantId,entity.vehicle_id):null;
   payload.customer=customer?Object.fromEntries(["id","name","phone","document","address"].map(k=>[k,customer[k]])):null;
   payload.vehicle=vehicle?{...Object.fromEntries(["id","plate","brand","model","color","year","chassis","km","fipe_model","fipe_code","model_year","fuel"].map(k=>[k,vehicle[k]])),model:vehicleDisplayModel(vehicle)}:null;
   const receipt=entity.status==="completed"?await db.prepare("SELECT * FROM receivables WHERE tenant_id=? AND order_id=?").get(ctx.tenantId,id):undefined;
   const payments=receipt?await db.prepare("SELECT receivable_id,method,gross,status,paid_at FROM payment_installments WHERE tenant_id=? AND receivable_id=? ORDER BY sequence").all(ctx.tenantId,receipt.id):[];
   order.payment_summary=customerPayments(entity.status,receipt,payments);
   payload.order=order;
   if(entity.status==="quote"&&shop.quote_validity_days>0){
    const date=new Date(issuedAt);const day=new Intl.DateTimeFormat("en-CA",{timeZone:"America/Sao_Paulo",year:"numeric",month:"2-digit",day:"2-digit"}).format(date);
    const until=new Date(day+"T12:00:00Z");until.setUTCDate(until.getUTCDate()+shop.quote_validity_days);payload.quote_valid_until=until.toISOString().slice(0,10);
   }
  }else{
   const checklist={...entity};
   const photos=await db.prepare("SELECT id,kind,mime,image_data,created_at FROM checklist_photos WHERE tenant_id=? AND checklist_id=? ORDER BY created_at,id").all(ctx.tenantId,id);
   checklist.photos=photos.map(p=>({id:p.id,kind:p.kind,created_at:p.created_at,image_url:"data:"+p.mime+";base64,"+p.image_data}));
   payload.checklist=checklist;
  }
  if(draftOrder || (modernOrder && currentOrderRefresh && !history.revisions.length))return payload;
  const text=JSON.stringify(payload),digest=createHash("sha256").update(text).digest("hex");
  await db.prepare("INSERT INTO document_revisions(id,tenant_id,kind,entity_id,revision,issued_at,issued_by,payload,digest) VALUES(?,?,?,?,?,?,?,?,?)")
   .run(randomUUID(),ctx.tenantId,kind,id,revision,issuedAt,ctx.userId,text,digest);
  await audit(db,ctx,"document.issued",kind+":"+id+":"+revision);
  return payload;
 });
}
export function publicDocument(payload:Record<string,any>):PublicOrderDocument{
 const o=payload.order,c=payload.customer,v=payload.vehicle;
 return {shop:payload.shop,number:o.number,kind:o.kind,status:o.status,customer:c?.name||o.guest_name||"Cliente",vehicle:v?[v.brand,v.model].filter(Boolean).join(" "):o.guest_vehicle,plate:v?.plate||o.guest_plate,entered_on:o.entered_on,total:o.total,discount:o.discount,items:o.items.map((i:Record<string,any>)=>({kind:i.kind,name:i.name,quantity:i.quantity,price:i.price})),payment_summary:o.payment_summary,revision:payload.revision,issued_at:payload.issued_at,quote_valid_until:payload.quote_valid_until};
}
