import {spawn} from "node:child_process";
import {mkdirSync,writeFileSync} from "node:fs";
import {resolve} from "node:path";
import {setTimeout as delay} from "node:timers/promises";
import {chromium,expect} from "@playwright/test";
const output=resolve(process.env.RUNNER_TEMP||"/tmp","adm0021-ui");
mkdirSync(output,{recursive:true});
const server=spawn("node",["node_modules/vite/bin/vite.js","--host","127.0.0.1","--port","5179","--strictPort"],{stdio:"ignore"});
let browser;
try{
 let ready=false;for(let i=0;i<60;i++){try{if((await fetch("http://127.0.0.1:5179")).ok){ready=true;break;}}catch{}await delay(500);}if(!ready)throw Error("UI test server unavailable");
 browser=await chromium.launch();
 const context=await browser.newContext({viewport:{width:1440,height:1000}});
 const page=await context.newPage();page.setDefaultTimeout(15000);
 const errors=[];page.on("pageerror",e=>errors.push(e.message));
 let readOnly=false,failSave=true,failHistory=true,updates=0,planUpdates=0,memberUpdates=0;
 const modules=Object.fromEntries(["dashboard","orders","checklists","customers_vehicles","catalog","technical_catalog","professionals","suppliers","inventory","finance","settings"].map(k=>[k,true]));
 let ent={plan_code:null,effective_plan_code:null,plan_policy_activated_at:null,trial_active:false,plan_configured:false,plan_module_defaults:{},module_overrides:{},override_expires_at:{},modules,plate_lookup:{status:"unauthorized",enabled:false,configured:true,authorized:false},max_users_override:null,max_users:null,trial_days_override:null,trial_days:14,user_count:2};
 let workshop={tenant_id:"fictional-a",name:"Oficina Demonstração ADM",document:"",phone:"",status:"trial",source:"admin",responsible_name:"Responsável Fictício",responsible_email:"owner@example.test",created_at:"2026-10-01T12:00:00Z",updated_at:null,email_verified_at:"2026-10-01T12:00:00Z",trial_started_at:"2026-10-01T12:00:00Z",trial_ends_at:"2026-10-15T12:00:00Z",trial_days_remaining:7,status_reason:"Ativação fictícia",invitation_status:"activated",invitation_expires_at:null,invitation_sent_at:null,catalog_access:{status:"active",enabled:true,valid_until:null,activated_at:null,grant_source:"commercial",updated_by_admin_id:null,updated_by_admin_email:"",updated_at:null,reason:"Autorização fictícia",catalog_installed:true}};
 let members=[{user_id:"owner",name:"Responsável Fictício",email:"owner@example.test",role:"owner"},{user_id:"operator",name:"Colaborador Fictício",email:"operator@example.test",role:"operator"}];
 let events=[{id:"event1",action:"admin.workshop.membership_changed",result:"success",actor_email:"admin@example.test",created_at:"2026-10-01T12:00:00Z",technical_context:{reason:"Revisão fictícia de acesso"}}];
 await page.route("**/admin-api/**",async route=>{
  const req=route.request(),path=new URL(req.url()).pathname,method=req.method(),body=req.postDataJSON();
  const json=(value,status=200)=>route.fulfill({status,json:value});
  if(path.endsWith("/session"))return json({administrator:{id:"admin",name:"Admin Fictício",email:"admin@example.test",role:"principal",permissions:readOnly?["workshops:read"]:["workshops:read","workshops:manage","modules:manage","data-transfer:manage","audit:read"]}});
  if(path==="/admin-api/workshops")return json({items:[workshop],total:1});
  if(path.includes("/data-transfer/"))return json([]);
  if(path.endsWith("/history")){if(failHistory)return json({error:"Histórico temporariamente indisponível"},503);return json(events);}
  if(path.endsWith("/entitlements")){
   if(method==="PUT"){updates++;ent={...ent,module_overrides:body.module_overrides,override_expires_at:body.override_expires_at,max_users_override:body.max_users,trial_days_override:body.trial_days,modules:{...modules,...body.module_overrides},plate_lookup:{status:body.module_overrides.external_plate_lookup===true?"available":"unauthorized",enabled:body.module_overrides.external_plate_lookup===true,configured:true,authorized:body.module_overrides.external_plate_lookup===true}};return json({entitlements:ent});}
   return json(ent);
  }
  if(path.endsWith("/plan")){planUpdates++;ent={...ent,plan_code:body.plan_code,effective_plan_code:body.plan_code,plan_policy_activated_at:new Date().toISOString(),plan_configured:true};return json({entitlements:ent});}
  if(path.endsWith("/users"))return json({items:members});
  if(path.endsWith("/users/operator")){memberUpdates++;members=members.map(m=>m.user_id==="operator"?{...m,role:body.role}:m);return json({ok:true});}
  if(path.endsWith("/status")){workshop={...workshop,status:body.status,status_reason:body.reason};return json({ok:true});}
  if(path.endsWith("/catalog-access")){workshop={...workshop,catalog_access:{...workshop.catalog_access,enabled:body.enabled,status:body.enabled?"active":"revoked"}};return json({ok:true});}
  if(path.endsWith("/manual-activation-link"))return json({activation_url:"http://127.0.0.1:5179/ativar#token=fictitious-ui-only",invitation_expires_at:"2026-11-01T12:00:00Z"});
  if(path.endsWith("/invitations"))return json([]);
  if(path.endsWith("/invitation/cancel"))return json({invitation_status:"cancelled"});
  if(path.endsWith("/invitation"))return json({invitation_status:"sent"});
  if(path.endsWith("/fictional-a")){
   if(method==="PUT"){if(failSave)return json({error:"Cadastro recusado para teste"},400);workshop={...workshop,...body};return json({ok:true});}return json(workshop);
  }
  if(path.includes("backup")||path.includes("archive")||path.includes("critical"))return json({items:[]});
  return json({});
 });
 await page.goto("http://127.0.0.1:5179/admin");
 await page.getByRole("button",{name:"Oficinas",exact:true}).click();
 await page.getByRole("button",{name:/Oficina Demonstração ADM/}).click();
 await expect(page.getByRole("tab",{name:"Dados gerais",exact:true})).toBeVisible();
 await expect(page.getByRole("tabpanel",{name:"Dados gerais",exact:true})).toBeVisible();
 await page.getByRole("button",{name:"Editar dados",exact:true}).click();
 await page.getByLabel("Nome da oficina",{exact:true}).fill("Oficina Editada Fictícia");
 await page.getByRole("button",{name:"Salvar cadastro"}).click();
 await expect(page.getByRole("alert")).toHaveText("Cadastro recusado para teste");
 await expect(page.getByLabel("Nome da oficina",{exact:true})).toHaveValue("Oficina Editada Fictícia");
 failSave=false;
 await page.getByRole("button",{name:"Salvar cadastro"}).click();
 await expect(page.getByRole("status").filter({hasText:"Dados administrativos atualizados"})).toBeVisible();
 await page.getByRole("tab",{name:"Histórico",exact:true}).click();
 await expect(page.getByRole("alert")).toHaveText("Histórico temporariamente indisponível");
 failHistory=false;await page.getByRole("button",{name:"Atualizar histórico"}).click();
 await expect(page.getByText("Vínculo de usuário alterado",{exact:true})).toBeVisible();
 await expect(page.getByText("Justificativa: Revisão fictícia de acesso")).toBeVisible();
 await page.getByRole("tab",{name:"Acessos e permissões",exact:true}).click();
 await expect(page.getByLabel("Exceção: Catálogo Técnico de Tempos",{exact:true})).toBeEnabled();
 await page.getByLabel("Exceção: Catálogo Técnico de Tempos",{exact:true}).selectOption("deny");
 await page.getByLabel("Exceção: Consulta externa de placas",{exact:true}).selectOption("allow");
 await page.getByLabel("Justificativa das exceções",{exact:true}).fill("Bloqueio fictício para regressão");
 await page.getByRole("tab",{name:"Usuários",exact:true}).click();
 await page.getByRole("tab",{name:"Acessos e permissões",exact:true}).click();
 await expect(page.getByLabel("Exceção: Catálogo Técnico de Tempos",{exact:true})).toHaveValue("deny");
 page.once("dialog",d=>d.dismiss());
 await page.getByRole("button",{name:"Voltar à lista"}).click();
 await expect(page.getByRole("tab",{name:"Acessos e permissões",exact:true})).toBeVisible();
 await page.getByRole("button",{name:"Salvar exceções",exact:true}).click();
 await expect(page.getByText("Exceções salvas e auditadas.")).toBeVisible();
 if(updates!==1)throw Error("Duplicate entitlement update");
 await expect(page.getByRole("row").filter({hasText:"Consulta externa de placas"})).toContainText("Liberado");
 await expect(page.getByRole("row").filter({hasText:"Catálogo Técnico de Tempos"})).toContainText("Bloqueado");
 await page.getByText("Recursos de cada plano",{exact:true}).click();
 await expect(page.locator(".pa-plans").getByText(/Premium · 10 usuários/)).toBeVisible();
 await page.getByLabel("Plano comercial",{exact:true}).selectOption("professional");
 await page.getByLabel("Justificativa da alteração do plano",{exact:true}).fill("Atribuir plano Profissional à oficina fictícia");
 page.once("dialog",d=>d.accept());
 await page.getByRole("button",{name:"Aplicar plano",exact:true}).click();
 await expect(page.getByText("Plano aplicado e registrado na auditoria.",{exact:false})).toBeVisible();
 if(planUpdates!==1)throw Error("Duplicate plan update");
 await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:resolve(output,"oficina-permissoes-desktop.png"),fullPage:true});
 await page.getByLabel("Justificativa das exceções",{exact:true}).fill("Restaurar configuração fictícia");
 page.once("dialog",d=>d.accept());
 await page.getByRole("button",{name:"Restaurar padrões do plano",exact:true}).click();
 await expect(page.getByLabel("Exceção: Catálogo Técnico de Tempos",{exact:true})).toHaveValue("inherit");
 await expect(page.getByLabel("Exceção: Consulta externa de placas",{exact:true})).toHaveValue("inherit");
 page.once("dialog",d=>d.dismiss());
 await page.getByRole("button",{name:"Desabilitar catálogo",exact:true}).click();
 await expect(page.getByRole("row").filter({hasText:"Catálogo Técnico de Tempos"})).toContainText("Liberado");
 await page.getByLabel("Nova situação",{exact:true}).selectOption("read_only");
 await page.getByLabel("Justificativa",{exact:true}).last().fill("Restrição fictícia temporária");
 page.once("dialog",d=>d.accept());
 await page.getByRole("button",{name:"Registrar mudança"}).click();
 await expect(page.getByText("Situação alterada e registrada na auditoria.")).toBeVisible();
 await page.getByRole("tab",{name:"Usuários",exact:true}).click();
 await page.getByLabel("Justificativa para alterar um vínculo").fill("Promover colaborador fictício");
 const ownerCard=page.locator(".pa-member").filter({hasText:"Responsável Fictício"});
 await expect(ownerCard.getByRole("button",{name:"Remover desta oficina"})).toBeDisabled();
 page.once("dialog",d=>d.accept());
 await page.getByRole("button",{name:"Tornar proprietário"}).click();
 await expect(page.getByText("Vínculo atualizado e auditado.")).toBeVisible();
 if(memberUpdates!==1)throw Error("Duplicate membership update");
 await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:resolve(output,"oficina-usuarios-desktop.png"),fullPage:true});
 await page.getByRole("tab",{name:"Convites",exact:true}).click();
 await expect(page.getByText("Ativação concluída",{exact:true})).toBeVisible();
 await expect(page.getByRole("button",{name:"Gerar link manual"})).toHaveCount(0);
 await page.setViewportSize({width:390,height:844});
 await page.getByRole("tab",{name:"Dados gerais",exact:true}).click();
 await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:resolve(output,"oficina-dados-mobile.png"),fullPage:true});
 if(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1))throw Error("Page overflows mobile viewport");
 // Pending activation uses the original explicit ownership confirmation.
 workshop={...workshop,status:"pending_verification",invitation_status:"expired",email_verified_at:null};
 await page.reload();await page.getByRole("button",{name:"Oficinas",exact:true}).click();await page.getByRole("button",{name:/Oficina Editada Fictícia/}).click();
 await page.getByRole("tab",{name:"Convites",exact:true}).click();
 await page.getByRole("button",{name:"Gerar link manual",exact:true}).click();
 await expect(page.getByRole("button",{name:"Confirmar e gerar link"})).toBeDisabled();
 await page.getByRole("checkbox").check();
 await page.getByRole("button",{name:"Confirmar e gerar link"}).click();
 await expect(page.getByLabel("Link de ativação",{exact:true})).toHaveValue(/fictitious-ui-only/);
 await page.getByRole("button",{name:"Fechar e apagar",exact:true}).click();
 await expect(page.getByRole("dialog")).toHaveCount(0);
 await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:resolve(output,"oficina-convites-mobile.png"),fullPage:true});
 readOnly=true;await page.reload();await page.getByRole("button",{name:"Oficinas",exact:true}).click();await page.getByRole("button",{name:/Oficina Editada Fictícia/}).click();
 await expect(page.getByRole("button",{name:"Editar dados",exact:true})).toHaveCount(0);
 await page.getByRole("tab",{name:"Acessos e permissões",exact:true}).click();
 await expect(page.getByLabel("Exceção: Catálogo Técnico de Tempos",{exact:true})).toBeDisabled();
 await expect(page.getByRole("button",{name:"Salvar permissões",exact:true})).toHaveCount(0);
 await page.getByRole("tab",{name:"Usuários",exact:true}).click();
 await expect(page.getByRole("button",{name:"Remover desta oficina"})).toHaveCount(0);
 await expect(page.getByRole("tab",{name:"Transferência de dados",exact:true})).toHaveCount(0);
 if(errors.length)throw Error(errors.join("\n"));
 writeFileSync(resolve(output,"README.md"),"# ADM-002.1 — regressão visual\n\nInterface real em Chromium com respostas de API fictícias interceptadas. Não comprova o backend nem homologação; integração PostgreSQL é executada separadamente no mesmo CI. Nenhum dado persistente ou segredo é utilizado.\n");
 console.log("ADM-002.1 browser regression passed: forms, errors, tabs, unsaved drafts, permissions, users, invitations, history, read-only and mobile.");
}finally{await browser?.close();server.kill("SIGTERM");}
