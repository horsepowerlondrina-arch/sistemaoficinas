import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {createDatabase} from "../server/db/database";
import {createApp} from "../server/app";
import {digest} from "../server/auth/session";
import {getWorkshopProfile,saveWorkshopProfile,validDocumentLogo} from "../server/services/workshopProfile";
import {createShare,readShare} from "../server/services/sharing";
import {OrderPrint} from "../src/components/OrderPrint";
import {ChecklistPrint} from "../src/components/ChecklistPrint";
const ctx={tenantId:"a",userId:"u",role:"owner"};
const png="data:image/png;base64,"+readFileSync("public/site/favicon.png").toString("base64");
function fixture(){
 const db=createDatabase(":memory:");
 db.exec("INSERT INTO tenants(id,name) VALUES('a','Oficina A'),('b','Oficina B'); INSERT INTO users VALUES('u','Admin','test@example.test','disabled'),('m','Operador','m@example.test','disabled'); INSERT INTO memberships VALUES('u','a','owner'),('m','a','operator'); INSERT INTO orders(id,tenant_id,number,kind,status,entered_on,due_on,km,total) VALUES('o','a',1,'quote','quote','2026-10-11','2026-10-11',0,8000); INSERT INTO catalog(id,tenant_id,kind,name,sku,cost,price,stock) VALUES('p','a','product','Filtro','F',2500,4000,5)");
 return db;
}
test("workshop identity editing is scoped and draft OS links use current office details",async()=>{
 const db=fixture();try{
  const before=db.prepare("SELECT * FROM catalog").get(),user=db.prepare("SELECT * FROM users WHERE id='u'").get(),order=db.prepare("SELECT * FROM orders").get();
  const share=await createShare(db,ctx,"o");
  const profile=await saveWorkshopProfile(db,ctx,{name:"Minha oficina",legal_name:"Minha oficina Ltda",document:"12.345.678/0001-95",email:"contato@example.test",phone:"43 99999-0000",address:"Rua Um, 100",city:"Londrina",state:"pr",document_logo:png,tenant_id:"a"});
  assert.equal(profile.document,"12345678000195");assert.equal(profile.state,"PR");
  assert.equal((await getWorkshopProfile(db,ctx)).document_logo,png);
  assert.equal(db.prepare("SELECT name FROM tenants WHERE id='b'").get()!.name,"Oficina B");
  assert.deepEqual(db.prepare("SELECT * FROM catalog").get(),before);
  assert.deepEqual(db.prepare("SELECT * FROM users WHERE id='u'").get(),user);
  assert.deepEqual(db.prepare("SELECT * FROM orders").get(),order);
  const publicData=(await readShare(db,share.path.slice(3)))!;
  assert.equal(publicData.shop!.name,"Minha oficina");
  const newer=await createShare(db,ctx,"o");
  assert.notEqual(newer.path,share.path);
  assert.equal((await readShare(db,share.path.slice(3)))!.shop.name,"Minha oficina");
  const newPublicData=(await readShare(db,newer.path.slice(3)))!;
  assert.equal(newPublicData.shop!.name,"Minha oficina");assert.equal(newPublicData.shop!.email,"contato@example.test");
  assert.equal(newPublicData.shop!.document_logo,png);
  await assert.rejects(()=>saveWorkshopProfile(db,{...ctx,role:"operator"},profile),/administrador/);
  await assert.rejects(()=>saveWorkshopProfile(db,ctx,{...profile,tenant_id:"b"}),/oficina selecionada mudou/);
  await assert.rejects(()=>saveWorkshopProfile(db,ctx,{...profile,email:"invalid"}));
 }finally{db.close();}
});
test("logo validation accepts prepared PNGs and blocks remote URLs SVG corruption and oversized content",()=>{
 assert.equal(validDocumentLogo(png),true);
 assert.equal(validDocumentLogo("/brand/icon.jpg"),true);
 assert.equal(validDocumentLogo(""),true);
 for(const value of ["https://tracking.example/logo.png","data:image/svg+xml;base64,PHN2Zz4=","data:text/html;base64,PHNjcmlwdD4=","data:image/png;base64,"+Buffer.from("not an image").toString("base64"),"data:image/png;base64,"+"A".repeat(300000)])assert.equal(validDocumentLogo(value),false);
 const corrupted=Buffer.from(png.slice(22),"base64");corrupted[45]^=1;
 assert.equal(validDocumentLogo("data:image/png;base64,"+corrupted.toString("base64")),false);
});
test("printed orders public documents and checklist use the same configurable header without exposing internal customer data",()=>{
 const tenant={id:"a",name:"Outra oficina",email:"contato@example.test",document_logo:png,phone:"43 1234"};
 const order={id:"o",number:12,kind:"quote",status:"quote",entered_on:"2026-10-11",discount:0,problem:"RELATO INTERNO",notes:"OBS INTERNA",items:[{id:"i",kind:"product",name:"Filtro",price:4000,quantity:2,cost:2500}]};
 const privateHtml=renderToStaticMarkup(createElement(OrderPrint,{tenant,order,customer:{id:"c",name:"Cliente",document:"DOCUMENTO PRIVADO",phone:"TELEFONE PRIVADO",address:"ENDEREÇO PRIVADO"}}));
 const publicHtml=renderToStaticMarkup(createElement(OrderPrint,{publicView:true,tenant,order,customer:{id:"c",name:"Cliente",document:"DOCUMENTO PRIVADO",phone:"TELEFONE PRIVADO",address:"ENDEREÇO PRIVADO"}}));
 const checklistHtml=renderToStaticMarkup(createElement(ChecklistPrint,{tenant,checklist:{id:"check",customer_name:"Cliente",vehicle_label:"Veículo",plate:"ABC1D23",conditions:{Pneus:"ok"}}}));
 for(const html of [privateHtml,publicHtml,checklistHtml]){
  assert.match(html,/document-header/);assert.match(html,/workshop-document/);assert.match(html,/Outra oficina/);
  assert.match(html,/contato@example.test/);assert.ok(!html.includes("Horse Power"));
 }
 assert.match(privateHtml,/DOCUMENTO PRIVADO/);
 for(const secret of ["DOCUMENTO PRIVADO","TELEFONE PRIVADO","ENDEREÇO PRIVADO","RELATO INTERNO","OBS INTERNA","25,00"])assert.ok(!publicHtml.includes(secret));
 assert.match(publicHtml,/8.000|80,00/);assert.match(publicHtml,/ORÇAMENTO/);
 assert.ok(!publicHtml.includes("Assinatura Cliente"));
});
test("profile HTTP requires login and admin and accepts a logo payload above the general JSON body limit",async()=>{
 const db=fixture();
 db.prepare("INSERT INTO sessions VALUES(?,?,?,?)").run(digest("owner"),"u","a",Date.now()+60000);
 db.prepare("INSERT INTO sessions VALUES(?,?,?,?)").run(digest("operator"),"m","a",Date.now()+60000);
 const server=createApp(db).listen(0,"127.0.0.1");await new Promise<void>(r=>server.once("listening",r));
 const base=`http://127.0.0.1:${(server.address() as {port:number}).port}/api/workshop-profile`;
 try{
  assert.equal((await fetch(base)).status,401);
  assert.equal((await fetch(base,{headers:{Cookie:"hp_session=operator"}})).status,403);
  const r=await fetch(base,{method:"PUT",headers:{Cookie:"hp_session=owner","Content-Type":"application/json"},body:JSON.stringify({name:"HTTP oficina",document_logo:png,tenant_id:"a"})});
  assert.equal(r.status,200);assert.equal((await r.json()).name,"HTTP oficina");
  const invalid=await fetch(base,{method:"PUT",headers:{Cookie:"hp_session=owner","Content-Type":"application/json"},body:JSON.stringify({name:"Inválida",document_logo:"data:image/png;base64,"+"A".repeat(270000)})});
  assert.equal(invalid.status,400);assert.match((await invalid.json()).error,/Logotipo/);
  assert.equal((await(await fetch(base,{headers:{Cookie:"hp_session=owner"}})).json()).name,"HTTP oficina");
 }finally{await new Promise<void>(r=>server.close(()=>r()));db.close();}
});
