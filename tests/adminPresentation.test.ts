import test from "node:test";
import assert from "node:assert/strict";
import {adminActionLabel,adminReason,adminRequest,localDateInput,optionalWholeNumber,plannedWorkshopPlans,workshopTabs} from "../src/lib/adminPresentation";
test("ADM-002.1: sections preserve transfers and future plans do not supply effective grants",()=>{
 assert.deepEqual(workshopTabs.map(t=>t[0]),["general","access","users","invitations","history","transfer"]);
 assert.deepEqual(plannedWorkshopPlans.map(p=>p.label),["Básico","Profissional","Premium"]);
 assert.match(plannedWorkshopPlans[2].description,/Catálogo Técnico/);
 assert.ok(plannedWorkshopPlans.every(p=>!("modules" in p)));
});
test("ADM-002.1: audit presentation does not expose arbitrary technical context",()=>{
 assert.equal(adminActionLabel("admin.workshop.membership_changed"),"Vínculo de usuário alterado");
 assert.equal(adminReason({reason:"Revisão autorizada",secret:"not for display"}),"Revisão autorizada");
 assert.equal(adminReason({token:"not for display"}),"Justificativa não registrada neste evento.");
});
test("ADM-002.1: optional limits and invalid historical timestamps",()=>{
 assert.equal(optionalWholeNumber("",90),null);assert.equal(optionalWholeNumber("14",90),14);
 for(const value of ["0","-1","1.5","abc","91"])assert.throws(()=>optionalWholeNumber(value,90));
 assert.equal(localDateInput("invalid"),"");assert.equal(localDateInput(null),"");
});
test("ADM-002.1: request failures are actionable and retain same-origin authentication",async()=>{
 const original=globalThis.fetch;
 try{
  for(const [status,message] of [[401,/sessão expirou/],[403,/permissão/],[503,/concluir a operação/]] as const){
   globalThis.fetch=async()=>new Response("unavailable",{status});
   await assert.rejects(adminRequest("/workshops"),message);
  }
  globalThis.fetch=async()=>{throw new Error("network");};
  await assert.rejects(adminRequest("/workshops"),/conectar ao painel/);
  globalThis.fetch=async()=>new Response("html",{status:200});
  await assert.rejects(adminRequest("/workshops"),/resposta inválida/);
  globalThis.fetch=async(url,options)=>{assert.equal(url,"/admin-api/workshops");assert.equal(options?.credentials,"same-origin");return Response.json({ok:true});};
  assert.deepEqual(await adminRequest("/workshops"),{ok:true});
 }finally{globalThis.fetch=original;}
});
