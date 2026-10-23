import { z } from "zod";
import { inflateSync } from "node:zlib";
import { transaction, type DB } from "../db/database.js";
import type { Context } from "../auth/session.js";
import { requireAdmin } from "./payments.js";
import { audit } from "./workshop.js";
import { workshopIdentity, EXTRA_PROFILE_FIELDS, validTaxDocument } from "../../shared/workshopIdentity.js";
export const MAX_LOGO_BYTES=200*1024;
function crc32(bytes:Buffer) {
 let crc=0xffffffff;
 for(const b of bytes){crc^=b;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
 return (crc^0xffffffff)>>>0;
}
export function validDocumentLogo(value:string) {
 if(!value || value==="/brand/icon.jpg")return true;
 if(!value.startsWith("data:image/png;base64,"))return false;
 const raw=value.slice(22);
 if(raw.length>Math.ceil(MAX_LOGO_BYTES/3)*4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(raw))return false;
 try {
  const bytes=Buffer.from(raw,"base64");
  if(bytes.length>MAX_LOGO_BYTES || bytes.toString("base64")!==raw || bytes.length<57 ||
    bytes.subarray(0,8).toString("hex")!=="89504e470d0a1a0a")return false;
  let offset=8,width=0,height=0,channels=0,ended=false;
  const data:Buffer[]=[];
  while(offset<bytes.length){
   if(offset+12>bytes.length)return false;
   const length=bytes.readUInt32BE(offset),end=offset+12+length;
   if(end>bytes.length)return false;
   const type=bytes.toString("ascii",offset+4,offset+8);
   if(crc32(bytes.subarray(offset+4,end-4))!==bytes.readUInt32BE(end-4))return false;
   if(offset===8 && type!=="IHDR")return false;
   if(type==="IHDR"){
    if(offset!==8 || length!==13)return false;
    width=bytes.readUInt32BE(offset+8);height=bytes.readUInt32BE(offset+12);
    channels=({0:1,2:3,4:2,6:4} as Record<number,number>)[bytes[offset+17]] || 0;
    if(!width || !height || width>1200 || height>1200 || !channels ||
      bytes[offset+16]!==8 || bytes[offset+18]!==0 || bytes[offset+19]!==0 || bytes[offset+20]!==0)return false;
   }else if(type==="IDAT"){data.push(bytes.subarray(offset+8,end-4));}
   else if(type==="IEND"){if(length!==0 || end!==bytes.length)return false;ended=true;}
   offset=end;
  }
  if(!ended || !data.length)return false;
  const stride=width*channels+1,decoded=inflateSync(Buffer.concat(data),{maxOutputLength:stride*height});
  if(decoded.length!==stride*height)return false;
  for(let y=0;y<height;y++)if(decoded[y*stride]>4)return false;
  return true;
 }catch{return false;}
}
const text=(max:number)=>z.string().trim().max(max);
const optionalUrl=text(300).refine(v=>!v||/^https?:\/\//i.test(v)&&(()=>{try{const u=new URL(v);return !!u.hostname&&!u.username&&!u.password;}catch{return false;}})(),"Use um endereço http:// ou https:// válido.");
const time=z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const businessDay=z.object({day:z.number().int().min(0).max(6),closed:z.boolean(),open:z.string(),close:z.string(),break_start:z.string(),break_end:z.string()}).superRefine((h,ctx)=>{
 if(h.closed)return;
 if(!time.safeParse(h.open).success||!time.safeParse(h.close).success||h.open>=h.close)ctx.addIssue({code:"custom",message:"Informe abertura anterior ao fechamento no mesmo dia."});
 if(h.break_start||h.break_end)if(!time.safeParse(h.break_start).success||!time.safeParse(h.break_end).success||h.break_start<=h.open||h.break_start>=h.break_end||h.break_end>=h.close)ctx.addIssue({code:"custom",message:"O intervalo deve estar entre abertura e fechamento."});
});
export const workshopProfileSchema=z.object({
 name:text(150).min(1,"Informe o nome fantasia."),legal_name:text(200),
 document:text(30).refine(v=>/^[\da-z.\s/\-]*$/i.test(v),"CPF/CNPJ inválido.").transform(v=>v.replace(/[.\s/\-]/g,"").toUpperCase()).refine(validTaxDocument,"CPF/CNPJ com dígitos verificadores inválidos."),
 phone:text(80),email:text(200).refine(v=>!v||z.string().email().safeParse(v).success,"E-mail inválido."),
 address:text(300),city:text(100),state:text(2).transform(v=>v.toUpperCase()).refine(v=>!v||"AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split(" ").includes(v),"UF inválida."),
 document_logo:z.string().max(280000).refine(validDocumentLogo,"Logotipo inválido. Selecione novamente uma imagem PNG, JPG ou WebP."),
 state_registration:text(40),municipal_registration:text(40),whatsapp:text(80),website:optionalUrl,instagram:optionalUrl,social_links:text(1000).refine(v=>!v||v.split(/\n/).filter(Boolean).every(line=>optionalUrl.safeParse(line).success),"Informe um endereço http(s) por linha."),
 postal_code:text(9).transform(v=>v.replace(/\D/g,"")).refine(v=>!v||/^\d{8}$/.test(v),"CEP deve ter 8 dígitos."),
 street:text(200),number:text(30),district:text(120),complement:text(150),maps_url:optionalUrl,
 accent_color:z.string().regex(/^#[0-9a-f]{6}$/i,"Escolha uma cor válida."),
 business_hours:z.array(businessDay).max(7).refine(h=>new Set(h.map(x=>x.day)).size===h.length,"Dia da semana duplicado."),
 quote_validity_days:z.number().int().min(0).max(365),
 payment_terms:text(2000),warranty_text:text(3000),default_notes:text(3000),document_footer:text(1000),pix_key:text(200),receiving_info:text(2000)
});
export async function getWorkshopProfile(db:DB,ctx:Context) {
 requireAdmin(ctx);
 const tenant=await db.prepare("SELECT * FROM tenants WHERE id=?").get(ctx.tenantId);
 if(!tenant)throw Object.assign(new Error("Oficina não encontrada."),{status:404});
 return workshopIdentity(tenant);
}
export async function saveWorkshopProfile(db:DB,ctx:Context,input:unknown) {
 requireAdmin(ctx);
 const parsed=z.object({tenant_id:z.string().optional()}).passthrough().parse(input);
 if(parsed.tenant_id&&parsed.tenant_id!==ctx.tenantId)throw new Error("A oficina selecionada mudou. Reabra os dados da oficina antes de salvar.");
 return transaction(db,async()=>{
  const current=await getWorkshopProfile(db,ctx);
  const value=workshopProfileSchema.parse({...current,...parsed});
  const extra:Record<string,unknown>={};
  for(const key of EXTRA_PROFILE_FIELDS)extra[key]=value[key];
  extra.business_hours=value.business_hours;extra.quote_validity_days=value.quote_validity_days;
  await db.prepare("UPDATE tenants SET name=?,legal_name=?,document=?,phone=?,email=?,address=?,city=?,state=?,document_logo=?,profile_data=? WHERE id=?")
   .run(value.name,value.legal_name,value.document,value.phone,value.email,value.address,value.city,value.state,value.document_logo,JSON.stringify(extra),ctx.tenantId);
  await audit(db,ctx,"workshop_profile.updated",ctx.tenantId);
  return value;
 });
}
