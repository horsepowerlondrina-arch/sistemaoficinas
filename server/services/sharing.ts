import { randomBytes } from "node:crypto";
import { type DB, transaction } from "../db/database.js";
import { digest, type Context } from "../auth/session.js";
import { requireAdmin } from "./payments.js";
import { scoped, audit } from "./workshop.js";
import { issueDocument,readDocument,publicDocument, type HistoricalShareUnavailable, type PublicOrderDocument } from "./documents.js";
import { workshopIdentity } from "../../shared/workshopIdentity.js";
export async function createShare(db:DB,ctx:Context,record:string,revision?:number){
 requireAdmin(ctx);
 return transaction(db,async()=>{
  const document=revision?await readDocument(db,ctx,"order",record,revision):await issueDocument(db,ctx,"order",record);
  const current=await db.prepare("SELECT token_value FROM public_shares WHERE tenant_id=? AND order_id=? AND document_revision=? AND revoked=0 AND expires_at>? AND token_value IS NOT NULL AND token_value<>'' ORDER BY expires_at DESC LIMIT 1").get(ctx.tenantId,record,document.revision,Date.now());
  const metadata={document:publicDocument(document),shop_name:document.shop.name};
  if(current?.token_value){await audit(db,ctx,"order.share_reused",record);return{path:"/p/"+current.token_value,expires_days:null,reused:true,...metadata};}
  const token=randomBytes(32).toString("hex");
  await db.prepare("INSERT INTO public_shares(token_hash,tenant_id,order_id,expires_at,token_value,document_revision) VALUES(?,?,?,?,?,?)").run(digest(token),ctx.tenantId,record,Number.MAX_SAFE_INTEGER,token,document.revision);
  await audit(db,ctx,"order.shared",record);
  return {path:"/p/"+token,expires_days:null,reused:false,...metadata};
 });
}
export async function readShare(db:DB,token:string):Promise<(PublicOrderDocument|HistoricalShareUnavailable)|null>{
 if(!/^[a-f0-9]{64}$/.test(token))return null;
 const link=await db.prepare("SELECT tenant_id,order_id,document_revision FROM public_shares WHERE token_hash=? AND revoked=0 AND expires_at>?").get(digest(token),Date.now());
 if(!link)return null;
 const accessState=await db.getTenantAccessState?.(String(link.tenant_id))||"legacy";
 if(["pending_verification","blocked","archived"].includes(accessState))return null;
 await scoped(db,"orders",link.tenant_id,link.order_id);
 if(!link.document_revision)return{historical_unavailable:true,shop:workshopIdentity({name:"Identidade histórica não registrada"}),payment_summary:null};
 return publicDocument(await readDocument(db,{tenantId:link.tenant_id,userId:"public",role:"owner"},"order",link.order_id,Number(link.document_revision)));
}
