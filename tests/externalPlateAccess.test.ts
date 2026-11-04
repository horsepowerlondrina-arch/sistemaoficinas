import test from "node:test";
import assert from "node:assert/strict";
import {createDatabase} from "../server/db/database.js";
import {lookupVehicle,lookupVehicleExternal,plateLookupStatus} from "../server/services/vehicleLookup.js";

test("ADM-002.2: autorização, configuração, cache e consultas locais preservadas",async()=>{
 const before={tokens:process.env.FIPEPLACA_TOKENS_JSON,platform:process.env.FIPEPLACA_PLATFORM_TOKEN,allow:process.env.FIPEPLACA_ALLOWED_TENANT_IDS,legacy:process.env.PLACA_FIPE_TOKENS_JSON};
 const db=createDatabase(":memory:");
 const flags:Record<string,boolean|undefined>={};
 const scoped=Object.assign(db,{getTenantModuleAccess:async(tenant:string):Promise<Record<string,boolean>>=>flags[tenant]===undefined?{}:{external_plate_lookup:flags[tenant]!}});
 let calls=0;
 const provider=(async(url: string | URL | Request)=>{
  calls++;return Response.json(String(url).endsWith("/fipe")?[]:{marca:"Marca Fictícia",modelo:"Modelo Fictício",anoFabricacao:2020,anoModelo:2021,cor:"Prata"});
 }) as typeof fetch;
 try{
  process.env.FIPEPLACA_TOKENS_JSON=JSON.stringify({a:"fake-a",b:"fake-b"});
  process.env.FIPEPLACA_ALLOWED_TENANT_IDS="a";
  delete process.env.FIPEPLACA_PLATFORM_TOKEN;
  delete process.env.PLACA_FIPE_TOKENS_JSON;
  db.exec("INSERT INTO tenants(id,name) VALUES('a','A'),('b','B'),('c','C'); INSERT INTO customers(id,tenant_id,name) VALUES('c','a','Cliente Fictício')");
  assert.equal((await lookupVehicle(scoped,"a","ABC1D23",provider)).source,"external");
  assert.equal(calls,2);
  assert.equal((await lookupVehicle(scoped,"b","ABC1D23",provider)).source,"unavailable");
  assert.equal(calls,2);
  flags.a=false;
  const blocked=await lookupVehicleExternal(scoped,"a","ABC1D23",provider);
  assert.equal(blocked.source,"unavailable");assert.match(blocked.message,/não está autorizada/);
  assert.equal(calls,2,"cache também exige autorização atual");
  flags.b=true;
  assert.equal((await lookupVehicle(scoped,"b","ABC1D23",provider)).source,"external");
  assert.equal(calls,4,"liberação administrativa usa somente a chave da oficina");
  assert.equal((await lookupVehicleExternal(scoped,"b","ABC1D23",provider)).source,"external");
  assert.equal(calls,4,"cache autorizado evita nova cobrança");
  flags.c=true;
  const missing=await lookupVehicleExternal(scoped,"c","ABC1D23",provider);
  assert.match(missing.message,/integração.*não está configurada/);
  assert.equal(calls,4);
  process.env.FIPEPLACA_PLATFORM_TOKEN="fake-platform";
  assert.equal((await lookupVehicleExternal(scoped,"c","ABC1D23",provider)).source,"external","plano autorizado usa a chave central");
  assert.equal(calls,6);
  flags.c=false;
  assert.equal((await lookupVehicleExternal(scoped,"c","ABC1D23",provider)).source,"unavailable","plano bloqueado não usa cache nem chave central");
  flags.c=true;
  db.exec("INSERT INTO vehicles(id,tenant_id,customer_id,plate,brand,model,year) VALUES('v','a','c','ABC1D23','Marca','Modelo',2021)");
  assert.equal((await lookupVehicle(scoped,"a","ABC1D23",provider)).source,"local","bloqueio externo não impede cadastro local");
  assert.equal(calls,6);
  flags.b=false;
  assert.equal((await lookupVehicleExternal(scoped,"b","ABC1D23",provider)).source,"unavailable");
  delete flags.a;
  assert.equal((await lookupVehicleExternal(scoped,"a","ABC1D23",provider)).source,"external","restaurar padrão conserva allowlist anterior");
  delete process.env.FIPEPLACA_PLATFORM_TOKEN;
  process.env.FIPEPLACA_ALLOWED_TENANT_IDS="a,c";
  assert.equal(plateLookupStatus("c").status,"not_configured","allowlist sem chave é configuração ausente, não falta de autorização");
  assert.deepEqual(plateLookupStatus("c",true),{status:"not_configured",enabled:false,configured:false,authorized:true});
  assert.ok(!JSON.stringify(plateLookupStatus("a")).includes("fake-a"));
  flags.b=true;
  await assert.rejects(()=>lookupVehicleExternal(scoped,"b","XYZ9Z99",(async()=>Response.json({erro:{codigo:"CHAVE_INVALIDA",mensagem:"fake-b"}},{status:401})) as typeof fetch),
   (error:unknown)=>error instanceof Error && /chave FipePlaca/.test(error.message) && !error.message.includes("fake-b"));
  assert.equal(process.env.FIPEPLACA_TOKENS_JSON,JSON.stringify({a:"fake-a",b:"fake-b"}));
 }finally{
  for(const [key,value] of [["FIPEPLACA_TOKENS_JSON",before.tokens],["FIPEPLACA_PLATFORM_TOKEN",before.platform],["FIPEPLACA_ALLOWED_TENANT_IDS",before.allow],["PLACA_FIPE_TOKENS_JSON",before.legacy]] as const){
   if(value===undefined)delete process.env[key];else process.env[key]=value;
  }
  db.close();
 }
});
