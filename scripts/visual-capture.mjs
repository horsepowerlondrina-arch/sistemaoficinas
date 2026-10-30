import { spawn, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium, expect } from "@playwright/test";

const root = process.cwd();
const catalogPath = resolve(root, "docs/mapeamento-visual/catalog.json");
const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
const args = process.argv.slice(2);
const valueAfter = (flag) => { const index = args.indexOf(flag); return index >= 0 ? args[index + 1] : ""; };
const moduleFilter = valueAfter("--module");
const outputArg = valueAfter("--output-dir");
const noWrite = args.includes("--no-write");
const fixtureTenant = process.env.VISUAL_TEST_TENANT || "local-a";
const baseUrl = process.env.VISUAL_BASE_URL || "http://127.0.0.1:5173";
const url = new URL(baseUrl);
if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) throw new Error("Capturas só podem acessar aplicação em loopback; homologação/remoto não é permitido.");
const outputDir = outputArg ? resolve(outputArg) : "";
if (noWrite && !outputDir) throw new Error("--no-write exige --output-dir para manter os arquivos fora da biblioteca versionada.");

const moduleByChangedPath = (path) => {
  if (/^(src\/App\.tsx|src\/styles\.css|server\/app\.ts|shared\/workshopModules\.ts|src\/components\/|src\/lib\/)/i.test(path)) return "*";
  if (/src\/pages\/(Home|Dashboard)\.tsx/i.test(path)) return "02-dashboard";
  if (/PeopleRegisters/i.test(path)) return ["03-clientes", "04-veiculos"];
  if (/Checklist/i.test(path)) return "05-checklist";
  if (/Order|Orders|Payment/i.test(path)) return ["06-orcamentos", "07-ordens-servico"];
  if (/Cash|Expenses|Profit/i.test(path)) return "08-financeiro";
  if (/Registers|RepairServicePicker/i.test(path)) return "09-cadastros-servicos";
  if (/Stock|Management/i.test(path)) return "10-estoque";
  if (/Suppliers/i.test(path)) return "11-fornecedores";
  if (/PublicOrder|documents/i.test(path)) return "12-documentos";
  if (/dataTransfer|transfer/i.test(path)) return "13-transferencia-dados";
  if (/Settings|workshop-profile/i.test(path)) return "14-configuracoes";
  if (/extension/i.test(path)) return "15-integracoes";
  if (/PlatformAdmin/i.test(path)) return "17-painel-admin-central";
  return null;
};

let selectedModules = moduleFilter ? new Set([moduleFilter]) : null;
if (args.includes("--affected")) {
  let changed = [];
  try { changed = execFileSync("git", ["diff", "--name-only", "origin/main...HEAD"], { encoding: "utf8" }).trim().split(/\r?\n/).filter(Boolean); } catch {}
  try { changed.push(...execFileSync("git", ["diff", "--name-only"], { encoding: "utf8" }).trim().split(/\r?\n/).filter(Boolean)); } catch {}
  const affected = new Set(changed.map(moduleByChangedPath).filter(Boolean).flat());
  selectedModules = affected.has("*") ? null : affected.size ? affected : new Set(catalog.modules.map((item) => item.id));
}
if (moduleFilter && !catalog.modules.some((module) => module.id === moduleFilter)) throw new Error(`Módulo desconhecido: ${moduleFilter}`);

const candidates = catalog.entries.filter((entry) => entry.image && entry.route.startsWith("/") && (!selectedModules || selectedModules.has(entry.module)) && entry.id !== "login-painel-central");
if (!candidates.length) throw new Error("Nenhuma interação com rota automatizável corresponde ao filtro.");
if (!/^[a-z0-9-]+$/.test(fixtureTenant)) throw new Error("VISUAL_TEST_TENANT inválido.");
if (!noWrite) {
  const dirty = execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], { encoding: "utf8" }).trim();
  if (dirty) throw new Error("Para registrar o commit correspondente, faça primeiro o commit do código da interface; a captura gravadora exige checkout limpo.");
}
const credentialsPath = resolve(process.env.LOCAL_TEST_CREDENTIALS_FILE || "data/local-credentials.json");
if (!existsSync(credentialsPath)) throw new Error("Credenciais fictícias locais ausentes. Execute a captura somente depois de iniciar a aplicação com a base PostgreSQL de teste; os valores não são exibidos nem versionados.");
const credentials = JSON.parse(readFileSync(credentialsPath, "utf8"));
const credentialFor = (tenant) => credentials.find((item) => item.tenant === tenant);
if (!credentialFor(fixtureTenant)) throw new Error(`A oficina fictícia ${fixtureTenant} não existe no arquivo local de credenciais.`);

  const appProcess = args.includes("--start") ? spawn(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "dev"], { cwd: root, stdio: "ignore", windowsHide: true, env: { ...process.env, PORT: "3001" } }) : null;
let browser;
try {
  if (appProcess) {
    let ready = false;
    for (let attempt = 0; attempt < 90; attempt++) {
      if (appProcess.exitCode !== null) throw new Error("A aplicação local encerrou antes de ficar pronta.");
      try { const response = await fetch(baseUrl); if (response.ok) { ready = true; break; } } catch {}
      await delay(1000);
    }
    if (!ready) throw new Error("A aplicação local não ficou pronta em 90 segundos.");
  }
  browser = await chromium.launch({ headless: true });
  let est009Reference = "";
  const outputFor = (entry) => noWrite ? join(outputDir, `${entry.id}.png`) : resolve(root, entry.image);
  const save = async (page, entry) => {
    const status = await page.goto(new URL(entry.route, baseUrl).toString(), { waitUntil: "domcontentloaded", timeout: 30000 });
    if (!status?.ok()) throw new Error(`A tela ${entry.id} respondeu HTTP ${status?.status() || "sem resposta"}.`);
    await page.getByRole("main").first().waitFor({ state: "visible", timeout: 15000 }).catch(() => {});
    if (entry.id.startsWith("est009-os-private-")) {
      await page.getByRole("button", { name: "Adicionar produtos e serviços" }).click();
      await page.getByRole("button", { name: "Adicionar serviço", exact: true }).click();
      await page.getByRole("button", { name: "Serviços Próprios" }).click();
      const search = page.getByRole("combobox", { name: "Pesquisar serviços próprios" });
      await expect(page.getByRole("listbox", { name: "Serviços próprios" })).toHaveCount(0);
      if (entry.id.endsWith("desktop")) {
        await page.getByRole("button", { name: "Cadastrar serviço sem sair" }).click();
        await page.getByRole("button", { name: "Cancelar" }).click();
        await expect(page.locator(".order-item")).toHaveCount(0);
        await page.getByRole("button", { name: "Cadastrar serviço sem sair" }).click();
        est009Reference = await page.getByRole("textbox", { name: "Referência" }).inputValue();
        await page.getByRole("textbox", { name: "Descrição", exact: true }).fill("Alinhamento Fictício");
        await page.getByRole("spinbutton", { name: "Preço de venda (R$)" }).fill("100");
        await page.getByRole("button", { name: "Salvar cadastro" }).click();
        await expect(page.locator(".order-item").filter({ hasText: "Alinhamento Fictício" })).toHaveCount(1);
        await search.fill("alinhamento");
        await page.getByRole("option", { name: /Alinhamento Fictício/ }).waitFor();
        await search.press("Escape");
        await expect(page.getByRole("listbox", { name: "Serviços próprios" })).toHaveCount(0);
        await search.fill("alinhament");
        await page.getByRole("option", { name: /Alinhamento Fictício/ }).waitFor();
        await search.press("ArrowDown");
        await search.press("Enter");
        await search.press("Enter");
        await expect(page.locator(".order-item").filter({ hasText: "Alinhamento Fictício" })).toHaveCount(2);
        const first = page.locator(".order-item").filter({ hasText: "Alinhamento Fictício" }).first();
        await first.getByRole("spinbutton", { name: "Quantidade" }).fill("2");
        await first.getByRole("spinbutton", { name: "Valor unitário (R$)" }).fill("150");
        await expect(first.getByText("R$ 300,00")).toBeVisible();
        await page.getByRole("heading", { name: "Serviços da Oficina" }).click();
      } else {
        if (!est009Reference) throw new Error("Referência fictícia EST-009 ausente.");
        await search.fill(est009Reference.toLowerCase());
        await page.getByRole("option", { name: /Alinhamento Fictício/ }).waitFor();
        await page.getByRole("button", { name: "Adicionar", exact: true }).click();
        await expect(page.locator(".order-item").filter({ hasText: "Alinhamento Fictício" })).toHaveCount(1);
        await page.getByRole("heading", { name: "Serviços da Oficina" }).click();
      }
    }
    if (entry.id === "servicos-oficina-desktop") {
      await page.getByRole("button", { name: "Novo serviço" }).click();
      const cost = page.getByRole("spinbutton", { name: "Custo do serviço/terceiros (R$)" });
      const price = page.getByRole("spinbutton", { name: "Preço de venda (R$)" });
      await cost.fill("100");
      await cost.press("Enter");
      await expect(price).toHaveValue("130");
      await price.fill("145");
      await expect(price).toHaveValue("145");
      await page.getByRole("button", { name: "Cancelar" }).click();
    }
    if (entry.route.includes("aba=tempos")) {
      await page.getByRole("tab", { name: "Catálogo de Tempos" }).waitFor({ state: "visible", timeout: 15000 });
      await page.getByText("Verificando acesso ao Catálogo de Tempos…").waitFor({ state: "hidden", timeout: 15000 });
      const brand = page.getByRole("combobox", { name: "Marca" });
      if (await brand.isVisible()) {
        await brand.fill("Marca Fictícia");
        await page.getByRole("option", { name: "Marca Fictícia" }).click();
        await page.getByRole("combobox", { name: "Modelo" }).fill("Modelo Fictício");
        await page.getByRole("option", { name: /Modelo Fictício/ }).click();
        await page.getByText("Inspeção Fictícia").waitFor({ state: "visible", timeout: 15000 });
        await page.getByRole("heading", { name: "Tempos técnicos" }).click();
      }
    }
    await page.waitForTimeout(300);
    const path = outputFor(entry);
    mkdirSync(dirname(path), { recursive: true });
    await page.screenshot({ path, fullPage: true, animations: "disabled" });
    return path;
  };
  let captures = 0;
  const loginShots = candidates.filter((entry) => entry.route === "/");
  if (loginShots.length) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, deviceScaleFactor: 1 });
    const page = await context.newPage();
    for (const entry of loginShots) { await page.setViewportSize(entry.viewport === "desktop" ? { width: 1440, height: 1000 } : { width: 390, height: 844 }); await save(page, entry); captures++; }
    await context.close();
  }

  for (const tenant of [fixtureTenant]) {
    const entries = candidates.filter((entry) => entry.route !== "/" && /-b(?:-desktop)?$/.test(entry.id) === (tenant === "local-b"));
    if (!entries.length) continue;
    const credential = credentialFor(tenant);
    if (!credential) throw new Error(`Credencial fictícia de ${tenant} não encontrada.`);
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
    await page.getByPlaceholder("E-mail").fill(credential.email);
    await page.getByPlaceholder("Senha", { exact: true }).fill(credential.password);
    const [loginResponse] = await Promise.all([page.waitForResponse((response) => response.url().endsWith("/api/login") && response.request().method() === "POST"), page.getByRole("button", { name: "Entrar" }).click()]);
    if (loginResponse.status() !== 200) throw new Error("A autenticação com a conta fictícia de teste falhou; nenhuma credencial foi exibida.");
    await page.getByRole("heading", { name: "Início" }).waitFor({ state: "visible", timeout: 15000 }).catch(() => {});
    for (const entry of entries) {
      await page.setViewportSize(entry.viewport === "desktop" ? { width: 1440, height: 1000 } : { width: 390, height: 844 });
      await save(page, entry);
      captures++;
    }
    await context.close();
  }

  if (!noWrite) {
    const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    const now = new Date().toISOString().slice(0, 10);
    for (const entry of candidates) {
      entry.status = "capturada";
      entry.updatedAt = now;
      entry.commit = commit;
      entry.freshness = "atual";
      entry.reason = null;
    }
    writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);
    execFileSync(process.execPath, ["scripts/update-visual-library.mjs", "--write"], { stdio: "inherit" });
  }
  console.log(`Capturas reais concluídas: ${captures}. Módulo: ${moduleFilter || (args.includes("--affected") ? "arquivos alterados" : "todos com rota automatizável")}.`);
} finally {
  await browser?.close();
  if (appProcess) {
    appProcess.kill("SIGTERM");
    await Promise.race([new Promise((resolvePromise) => appProcess.once("exit", resolvePromise)), delay(5000)]);
    if (appProcess.exitCode === null) appProcess.kill("SIGKILL");
  }
}
