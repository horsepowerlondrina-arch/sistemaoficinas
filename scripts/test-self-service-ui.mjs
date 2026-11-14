import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium, expect } from "@playwright/test";
if (process.env.VERCEL || process.env.NODE_ENV === "production") throw Error("ISOLATED_ONLY");
const output = resolve(process.env.RUNNER_TEMP || "/tmp", "self-service-ui"); mkdirSync(output, { recursive: true });
const child = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", "5184", "--strictPort"], { stdio: "ignore" });
let browser;
try {
  let ready = false;
  for (let i = 0; i < 60; i++) { try { if ((await fetch("http://127.0.0.1:5184")).ok) { ready = true; break; } } catch {} await delay(250); }
  if (!ready) throw Error("TEST_SERVER_UNAVAILABLE");
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = []; page.on("pageerror", () => errors.push("PAGE_ERROR"));
  let sent = 0;
  await page.route("**/admin-api/workshop-registration", async route => {
    if (route.request().method() === "GET") return route.fulfill({ json: { enabled: true } });
    const body = route.request().postDataJSON();
    if (body.plan_code !== "professional" || body.workshop.name !== "Oficina Fictícia de Teste") throw Error("FORM_PAYLOAD_MISMATCH");
    sent++; return route.fulfill({ status: 202, json: { message: "Se o cadastro puder prosseguir, você receberá o e-mail de ativação. Confira a caixa de entrada." } });
  });
  await page.goto("http://127.0.0.1:5184/criar-oficina");
  await expect(page.getByRole("heading", { name: "Criar minha oficina" })).toBeVisible();
  await page.screenshot({ path: resolve(output, "signup-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: resolve(output, "signup-mobile.png"), fullPage: true });
  if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) throw Error("MOBILE_OVERFLOW");
  await page.getByLabel("Nome da oficina", { exact: true }).fill("Oficina Fictícia de Teste");
  await page.getByLabel("Nome do responsável").fill("Master Fictício");
  await page.getByLabel("E-mail do responsável").fill("ficticio@testes.osdrive.com.br");
  await page.getByLabel("Plano inicial").selectOption("professional");
  await page.getByRole("button", { name: "Receber ativação por e-mail" }).click();
  await expect(page.getByRole("status")).toContainText("ativação");
  if (sent !== 1 || errors.length) throw Error("SUBMISSION_OR_RUNTIME_FAILURE");
  await page.screenshot({ path: resolve(output, "signup-confirmation-mobile.png"), fullPage: true });
  console.log("Self-service form, submission and responsive layout passed; API fixture only, PostgreSQL tested separately.");
} finally { await browser?.close(); child.kill("SIGTERM"); }
