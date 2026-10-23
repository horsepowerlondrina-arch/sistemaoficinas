export const EXTRA_PROFILE_FIELDS = [
  "state_registration","municipal_registration","whatsapp","website","instagram","social_links",
  "postal_code","street","number","district","complement","maps_url","accent_color",
  "payment_terms","warranty_text","default_notes","document_footer","pix_key","receiving_info"
] as const;
export const DAYS = ["Domingo","Segunda-feira","Terça-feira","Quarta-feira","Quinta-feira","Sexta-feira","Sábado"];
export type BusinessDay = { day:number; closed:boolean; open:string; close:string; break_start:string; break_end:string };
export type WorkshopIdentity = {
 name:string; legal_name:string; document:string; phone:string; email:string; address:string; city:string; state:string; document_logo:string;
 state_registration:string; municipal_registration:string; whatsapp:string; website:string; instagram:string; social_links:string;
 postal_code:string; street:string; number:string; district:string; complement:string; maps_url:string; accent_color:string;
 payment_terms:string; warranty_text:string; default_notes:string; document_footer:string; pix_key:string; receiving_info:string;
 quote_validity_days:number; business_hours:BusinessDay[];
 historical_identity_status?:string;
};
export function workshopIdentity(value:Record<string,unknown>={}):WorkshopIdentity {
 let extra:Record<string,unknown>={};
 try {extra=typeof value.profile_data==="string"?JSON.parse(value.profile_data):{};}catch{}
 const data={...extra,...value};
 const text=(key:string)=>typeof data[key]==="string"?String(data[key]):"";
 const result:Record<string,unknown>={};
 for(const key of ["name","legal_name","document","phone","email","address","city","state","document_logo",...EXTRA_PROFILE_FIELDS])result[key]=text(key);
 result.accent_color=/^#[0-9a-f]{6}$/i.test(text("accent_color"))?text("accent_color"):"#26364b";
 result.quote_validity_days=Number.isInteger(data.quote_validity_days)?Number(data.quote_validity_days):0;
 result.business_hours=Array.isArray(data.business_hours)?data.business_hours:[];
 if(data.historical_identity_status)result.historical_identity_status=String(data.historical_identity_status);
 return result as WorkshopIdentity;
}
export function workshopAddress(shop:WorkshopIdentity) {
 if(shop.address.trim())return shop.address;
 return [shop.street,shop.number,shop.complement,shop.district,[shop.city,shop.state].filter(Boolean).join(" / "),shop.postal_code].filter(Boolean).join(", ");
}
export function readableHours(shop:WorkshopIdentity) {
 return shop.business_hours.map(h=>DAYS[h.day]+": "+(h.closed?"Fechado":h.open+"–"+h.close+(h.break_start?" · Intervalo "+h.break_start+"–"+h.break_end:"")));
}
export function contrastInk(color:string) {
 const channels=(/^#[0-9a-f]{6}$/i.test(color)?color:"#26364b").slice(1).match(/../g)!.map(x=>parseInt(x,16)/255).map(v=>v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4);
 const luminance=channels[0]*.2126+channels[1]*.7152+channels[2]*.0722;
 return (luminance+.05)/.05 >= 1.05/(luminance+.05)?"#000000":"#ffffff";
}
export function validTaxDocument(value:string) {
 const d=value.replace(/[.\s/\-]/g,"").toUpperCase();
 if(!d)return true;
 if(/^(\d)\1+$/.test(d))return false;
 const digit=(part:string,weights:number[])=>{const n=part.split("").reduce((s,c,i)=>s+(c.charCodeAt(0)-48)*weights[i],0)%11;return n<2?0:11-n;};
 if(d.length===11&&/^\d{11}$/.test(d)){const a=digit(d.slice(0,9),[10,9,8,7,6,5,4,3,2]);return a===Number(d[9])&&digit(d.slice(0,10),[11,10,9,8,7,6,5,4,3,2])===Number(d[10]);}
 if(d.length===14&&/^[A-Z0-9]{12}\d{2}$/.test(d))return digit(d.slice(0,12),[5,4,3,2,9,8,7,6,5,4,3,2])===Number(d[12])&&digit(d.slice(0,13),[6,5,4,3,2,9,8,7,6,5,4,3,2])===Number(d[13]);
 return false;
}
export function formatWorkshopDocument(value:string) {
 const d=value.replace(/[.\s/\-]/g,"").toUpperCase();
 if(d.length===14&&/^[A-Z0-9]{12}\d{2}$/.test(d))return d.replace(/^(.{2})(.{3})(.{3})(.{4})(\d{2})$/,"$1.$2.$3/$4-$5");
 if(d.length===11)return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/,"$1.$2.$3-$4");
 return value;
}
