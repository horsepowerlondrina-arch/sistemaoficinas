import test from "node:test";
import assert from "node:assert/strict";
import { createDatabase } from "../server/db/database";
import { saveWorkshopProfile, workshopProfileSchema } from "../server/services/workshopProfile";
import { documentHistory, issueDocument, readDocument } from "../server/services/documents";
import { createShare, readShare } from "../server/services/sharing";
import { digest } from "../server/auth/session";
import { contrastInk, formatWorkshopDocument, validTaxDocument } from "../shared/workshopIdentity";

const ownerA={tenantId:"a",userId:"u",role:"owner"};
const ownerB={tenantId:"b",userId:"v",role:"owner"};
function fixture(){
 const db=createDatabase(":memory:");
 db.exec("INSERT INTO tenants(id,name) VALUES('a','Oficina A'),('b','Oficina B'); INSERT INTO users VALUES('u','Admin A','a@test.invalid','unused'),('v','Admin B','b@test.invalid','unused'),('op','Operador','op@test.invalid','unused'); INSERT INTO memberships VALUES('u','a','owner'),('v','b','owner'),('op','a','operator'); INSERT INTO orders(id,tenant_id,number,kind,status,guest_name,guest_plate,guest_vehicle,entered_on,due_on,km,total) VALUES('o','a',4,'quote','quote','Cliente Fictício','ABC1D23','Honda Civic','2026-10-20','2026-10-22',12,5000); INSERT INTO order_items(id,tenant_id,order_id,kind,name,quantity,price,cost,service_snapshot) VALUES('i','a','o','service','Revisão',1,5000,3000,'serviço fictício')");
 return db;
}

test("CPF/CNPJ checks include the Receita Federal alphanumeric CNPJ format",()=>{
 assert.equal(validTaxDocument("529.982.247-25"),true);
 assert.equal(validTaxDocument("52998224724"),false);
 assert.equal(validTaxDocument("12.345.678/0001-95"),true);
 assert.equal(validTaxDocument("00.000.000/E08G-12"),true);
 assert.equal(formatWorkshopDocument("00000000e08g12"),"00.000.000/E08G-12");
 assert.equal(validTaxDocument("00.000.000/E08G-13"),false);
});

test("office profile validates schedules and optional fields without requiring a phone/WhatsApp coupling",()=>{
 const base={name:"Oficina A",legal_name:"",document:"",phone:"",email:"",address:"",city:"",state:"",document_logo:"",state_registration:"",municipal_registration:"",whatsapp:"",website:"",instagram:"",social_links:"",postal_code:"",street:"",number:"s/n",district:"",complement:"",maps_url:"",accent_color:"#26364b",business_hours:[],quote_validity_days:0,payment_terms:"",warranty_text:"",default_notes:"",document_footer:"",pix_key:"",receiving_info:""};
 assert.equal(workshopProfileSchema.parse({...base,whatsapp:"(43) 99999-0000",business_hours:[{day:1,closed:false,open:"08:00",close:"18:00",break_start:"12:00",break_end:"13:00"}]}).whatsapp,"(43) 99999-0000");
 assert.throws(()=>workshopProfileSchema.parse({...base,business_hours:[{day:1,closed:false,open:"18:00",close:"08:00",break_start:"",break_end:""}]}));
 assert.throws(()=>workshopProfileSchema.parse({...base,business_hours:[{day:1,closed:true,open:"",close:"",break_start:"",break_end:""},{day:1,closed:true,open:"",close:"",break_start:"",break_end:""}]}));
 assert.equal(contrastInk("#000000"),"#ffffff");assert.equal(contrastInk("#ffffff"),"#000000");
});

test("new OS print and share use current data without revisions; legacy snapshots remain isolated",async()=>{
 const db=fixture();
 try{
  await saveWorkshopProfile(db,ownerA,{tenant_id:"a",name:"Oficina A Inicial",phone:"111",payment_terms:"Pix fictício"});
  await saveWorkshopProfile(db,ownerB,{tenant_id:"b",name:"Oficina B Privada"});
  const first=await issueDocument(db,ownerA,"order","o");
  const repeated=await issueDocument(db,ownerA,"order","o");
  assert.equal(first.revision,0);assert.equal(repeated.revision,0);
  assert.equal(first.shop.name,"Oficina A Inicial");
  assert.equal(first.order.items[0].price,5000);
  assert.equal((await documentHistory(db,ownerA,"order","o")).revisions.length,0);
  const link=await createShare(db,ownerA,"o");
  const token=link.path.slice(3);
  assert.equal((await readShare(db,token))!.shop.name,"Oficina A Inicial");
  await saveWorkshopProfile(db,ownerA,{tenant_id:"a",name:"Oficina A Atualizada",phone:"333"});
  const second=await issueDocument(db,ownerA,"order","o");
  assert.equal(second.shop.name,"Oficina A Atualizada");
  assert.equal((await readShare(db,token))!.shop.name,"Oficina A Atualizada");
  assert.equal((await documentHistory(db,ownerA,"order","o")).revisions.length,0);
  await assert.rejects(()=>readDocument(db,ownerB,"order","o",1));
  await assert.rejects(()=>saveWorkshopProfile(db,ownerA,{tenant_id:"b",name:"Tentativa"}),/oficina selecionada mudou/);
  assert.equal((await db.prepare("SELECT name FROM tenants WHERE id='b'").get())!.name,"Oficina B Privada");
  await db.prepare("UPDATE orders SET identity_legacy=1 WHERE tenant_id='a' AND id='o'").run();
  const legacy=await issueDocument(db,ownerA,"order","o",true);
  assert.equal(legacy.revision,1);
  assert.throws(()=>db.prepare("UPDATE document_revisions SET payload='{}' WHERE tenant_id='a' AND entity_id='o'").run(),/imutável/);
  assert.equal((await documentHistory(db,ownerA,"order","o")).revisions.length,1);
 }finally{db.close();}
});

test("legacy shared records do not infer old identity from current settings",async()=>{
 const db=fixture();
 try{
  await saveWorkshopProfile(db,ownerA,{name:"Identidade atual fictícia"});
  await db.prepare("UPDATE orders SET identity_legacy=1 WHERE tenant_id='a' AND id='o'").run();
  const token="a".repeat(64);
  await db.prepare("INSERT INTO public_shares(token_hash,tenant_id,order_id,expires_at,token_value) VALUES(?,?,?,?,?)").run(digest(token),"a","o",Number.MAX_SAFE_INTEGER,token);
  const historic=(await readShare(db,token))!;
  assert.equal("historical_unavailable" in historic&&historic.historical_unavailable,true);
  assert.equal(historic.shop.name,"Identidade histórica não registrada");
  await assert.rejects(()=>issueDocument(db,ownerA,"order","o"),e=>(e as {status?:number}).status===409);
  const revision=await issueDocument(db,ownerA,"order","o",true);
  assert.equal(revision.reissued_legacy,true);assert.equal(revision.shop.name,"Identidade atual fictícia");
 }finally{db.close();}
});
