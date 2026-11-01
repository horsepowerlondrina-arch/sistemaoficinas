import {expect} from "@playwright/test";
export async function captureSettings(page,entry){
 if(entry.module!=="14-configuracoes")return;
 await expect(page.getByRole("heading",{name:"Configurações",exact:true})).toBeVisible();
 if(entry.id==="config-dados-oficina-desktop"){
  const name=page.getByRole("textbox",{name:"Nome fantasia *",exact:true});
  const initial=await name.inputValue();
  await name.fill("Oficina Rascunho Fictícia");
  page.once("dialog",dialog=>dialog.dismiss());
  await page.locator('[data-settings-tab="pecas"]').click();
  await expect(name).toHaveValue("Oficina Rascunho Fictícia");
  await name.fill(initial);
  await page.goto(new URL("/configuracoes?aba=inexistente",page.url()).toString());
  await expect(page.locator('[data-settings-tab="oficina"]')).toHaveAttribute("aria-current","page");
 }
 if(entry.id==="config-geral-taxas-desktop"){
  const debit=page.getByRole("spinbutton",{name:"Taxa da oficina — débito (%)",exact:true});
  const initial=await debit.inputValue();await debit.fill(initial==="7"?"8":"7");
  page.once("dialog",dialog=>dialog.accept());
  await page.locator('[data-settings-tab="conta"]').click();
  await page.locator('[data-settings-tab="geral"]').click();
  await expect(debit).toHaveValue(initial);
  const sessionResponse=await page.request.get(new URL("/api/session",page.url()).toString());
  const session=await sessionResponse.json();
  const workspaceResponse=await page.request.get(new URL("/api/workspace",page.url()).toString());
  const workspace=await workspaceResponse.json();
  const sessionRoute=route=>route.fulfill({json:{...session,modules:{...session.modules,finance:false}}});
  const workspaceRoute=route=>route.fulfill({json:{...workspace,payment_settings:null,card_rates:[],modules:{...workspace.modules,finance:false}}});
  await page.route("**/api/session",sessionRoute);await page.route("**/api/workspace",workspaceRoute);
  await page.reload();
  await expect(page.getByRole("heading",{name:"Financeiro não habilitado"})).toBeVisible();
  await expect(page.getByRole("button",{name:"Salvar taxas"})).toHaveCount(0);
  await page.unroute("**/api/session",sessionRoute);await page.unroute("**/api/workspace",workspaceRoute);
  await page.reload();
 }
 if(entry.id==="config-lucro-pecas-desktop"){
  const response=await page.request.get(new URL("/api/workspace",page.url()).toString());
  const workspace=await response.json();
  const route=route=>route.fulfill({json:{...workspace,parts_pricing:{...workspace.parts_pricing,mode:"margin",rate_bps:2500}}});
  await page.route("**/api/workspace",route);await page.reload();
  await expect(page.getByRole("combobox",{name:"Regra de preço das peças"})).toHaveValue("margin");
  let submitted;
  const saveRoute=async route=>{submitted=route.request().postDataJSON();await route.fulfill({json:{ok:true}});};
  await page.route("**/api/parts-pricing",saveRoute);
  await page.getByRole("button",{name:"Salvar política de preços"}).click();
  await expect.poll(()=>submitted?.mode).toBe("margin");
  expect(submitted.rate_bps).toBe(2500);
  await page.unroute("**/api/parts-pricing",saveRoute);await page.unroute("**/api/workspace",route);await page.reload();
 }
 if(entry.id==="config-dados-oficina"){
  const dates=await page.locator(".profile-document-preview .hp-print-dates").boundingBox();
  const totals=await page.locator(".profile-document-preview .hp-print-totalbox").boundingBox();
  expect(dates).not.toBeNull();expect(totals).not.toBeNull();
  expect(totals.y).toBeGreaterThanOrEqual(dates.y+dates.height);
  const monogram=await page.locator(".profile-document-preview .document-monogram").boundingBox();
  const company=await page.locator(".profile-document-preview .document-company").boundingBox();
  if(monogram&&company)expect(company.x).toBeGreaterThanOrEqual(monogram.x+monogram.width);
 }
 if(entry.route.includes("aba=servicos"))await expect(page.getByRole("button",{name:"Salvar valores da hora"})).toBeEnabled();
 await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
}
