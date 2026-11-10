import {spawn} from "node:child_process";
import {mkdirSync,writeFileSync,rmSync,existsSync} from "node:fs";
import {resolve} from "node:path";
import {setTimeout as delay} from "node:timers/promises";
import {chromium,expect} from "@playwright/test";
const output=resolve(process.env.RUNNER_TEMP||"/tmp","stripe-ui");
mkdirSync(output,{recursive:true});
const files=["stripe-ui-fixture.html","stripe-ui-fixture.tsx"];
if(files.some(existsSync))throw Error("Fixture path already exists");
writeFileSync(files[0],'<div id="root"></div><script type="module" src="/stripe-ui-fixture.tsx"></script>');
writeFileSync(files[1],`import React from "react";import {createRoot} from "react-dom/client";import {AdminBilling,WorkshopBilling} from "./src/components/StripeBilling";import "./src/styles.css";import "./src/platform-admin.css";createRoot(document.getElementById("root")!).render(<main className="pa-shell"><div className="pa-content">{location.search.includes("owner")?<WorkshopBilling tenantId="fictional"/>:<AdminBilling/>}</div></main>);`);
const server=spawn("node",["node_modules/vite/bin/vite.js","--host","127.0.0.1","--port","5181","--strictPort"],{stdio:"ignore"});
let browser;
try{
 let ready=false;for(let i=0;i<60;i++){try{if((await fetch("http://127.0.0.1:5181")).ok){ready=true;break;}}catch{}await delay(500);}if(!ready)throw Error("UI fixture unavailable");
 browser=await chromium.launch();const page=await browser.newPage({viewport:{width:1400,height:1000}});page.setDefaultTimeout(15000);
 const errors=[];page.on("pageerror",e=>errors.push(e.message));
 const prices=[{id:"00000000-0000-4000-8000-000000000001",plan_code:"basic",amount_cents:1000},{id:"00000000-0000-4000-8000-000000000002",plan_code:"professional",amount_cents:2000},{id:"00000000-0000-4000-8000-000000000003",plan_code:"premium",amount_cents:3000}];
 const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"America/Sao_Paulo",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());
 const datePart=type=>parts.find(p=>p.type===type).value;
 const today=`${datePart("year")}-${datePart("month")}-${datePart("day")}`;
 let saves=0,fail=true,cancelled=false,incomplete=false,refreshes=0;
 await page.route("**/admin-api/billing**",async route=>{
  if(route.request().method()==="POST"){
   if(fail)return route.fulfill({status:503,json:{error:"Falha fictícia temporária"}});
   saves++;const body=route.request().postDataJSON();if(body.amount_cents!==1234)throw Error("Price precision lost");
   return route.fulfill({json:{id:"fixture"}});
  }
  return route.fulfill({json:{enabled:true,test_mode:true,prices,accounts:[]}});
 });
 await page.route("**/api/account/billing**",async route=>{
  if(route.request().url().endsWith("/cancel")){if(route.request().postDataJSON().confirm!==true)throw Error("Missing confirmation");cancelled=true;}
  if(route.request().url().endsWith("/refresh"))refreshes++;
  return route.fulfill({json:{enabled:true,test_mode:true,prices,read_only:false,pending:null,account:{plan_code:"premium",method:incomplete?"card":"pix",managed:!incomplete,due_on:today,paid_until:today,recurring:incomplete,cancel_at_period_end:cancelled,subscription_status:null,invoice_payment_url:null},payments:[]}});
 });
 await page.route("**/api/account/plan",route=>route.fulfill({json:{plan:{plan_code:"premium",status:"active",trial_ends_at:null}}}));
 await page.goto("http://127.0.0.1:5181/stripe-ui-fixture.html");
 await page.getByLabel("Mensalidade em reais").fill("12,34");await page.getByLabel("Justificativa").fill("Teste fictício de preço");
 await page.getByRole("button",{name:"Salvar novo preço"}).click();await expect(page.getByRole("alert")).toHaveText("Falha fictícia temporária");
 await expect(page.getByLabel("Mensalidade em reais")).toHaveValue("12,34");
 fail=false;await page.getByRole("button",{name:"Salvar novo preço"}).click();await expect(page.getByRole("status")).toHaveText("Novo preço registrado com auditoria.");
 if(saves!==1)throw Error("Duplicate price submission");
 await page.screenshot({path:resolve(output,"stripe-admin-desktop.png"),fullPage:true});
 await page.goto("http://127.0.0.1:5181/stripe-ui-fixture.html?owner");
 await expect(page.getByLabel("Plano mensal")).toHaveCount(0);
 await expect.poll(()=>refreshes).toBe(1);
 await expect(page.getByRole("button",{name:"Atualizar situação do pagamento"})).toHaveCount(0);
 await page.getByRole("button",{name:"Pagar próxima mensalidade"}).click();
 await page.getByLabel("Plano mensal").selectOption(prices[0].id);
 await expect(page.getByRole("button",{name:"Continuar no Stripe"})).toBeDisabled();
 await page.getByLabel(/Li os valores/).check();await expect(page.getByRole("button",{name:"Continuar no Stripe"}).first()).toBeEnabled();
 await page.getByLabel("Forma de pagamento").selectOption("pix");await expect(page.getByRole("button",{name:"Continuar no Stripe"}).first()).toBeDisabled();
 await expect(page.getByRole("button",{name:"Cancelar renovação",exact:true})).toBeDisabled();
 await page.getByLabel(/Confirmo o cancelamento/).check();await page.getByRole("button",{name:"Cancelar renovação",exact:true}).click();
 await expect(page.getByText("Renovação cancelada. O período já pago será preservado.")).toBeVisible();
 await page.screenshot({path:resolve(output,"stripe-oficina-desktop.png"),fullPage:true});
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:resolve(output,"stripe-oficina-mobile.png"),fullPage:true});
 if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1))throw Error("Billing overflows mobile viewport");
 incomplete=true;cancelled=false;await page.reload();
 await expect(page.getByText("Tudo certo com o seu Plano!")).toBeVisible();
 await expect(page.getByRole("button",{name:"Cancelar renovação",exact:true})).toBeVisible();
 await page.getByLabel(/Confirmo o cancelamento/).check();await page.getByRole("button",{name:"Cancelar renovação",exact:true}).click();
 await expect(page.getByText("Renovação cancelada. O período já pago será preservado.")).toBeVisible();
 if(errors.length)throw Error(errors.join("\n"));
 writeFileSync(resolve(output,"README.md"),"# Stripe — interfaces de teste\nComponentes reais, API fictícia interceptada. Não comprova webhook ou checkout Stripe online. Backend é testado no PostgreSQL 17 separadamente.\nCommit: "+process.env.GITHUB_SHA+"\n");
 console.log("Stripe UI passed: prices, precision, errors, confirmation, cancellation and mobile.");
}finally{await browser?.close();server.kill("SIGTERM");for(const file of files)rmSync(file,{force:true});}
