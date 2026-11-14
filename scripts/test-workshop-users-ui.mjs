import { spawn } from "node:child_process";
import { readFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium, expect } from "@playwright/test";
const base = "http://127.0.0.1:5173";
if (process.env.VERCEL || process.env.NODE_ENV === "production")
  throw Error("Somente aplicação de testes em loopback.");
const credential = JSON.parse(
  readFileSync(
    process.env.LOCAL_TEST_CREDENTIALS_FILE || "data/local-credentials.json",
    "utf8",
  ),
).find((c) => c.tenant === "local-a");
if (!credential) throw Error("Credenciais fictícias locais ausentes.");
const output = resolve(process.env.RUNNER_TEMP || "/tmp", "ops004-users-ui");
mkdirSync(output, { recursive: true });
const children = [
  spawn("node", ["--import", "tsx", "server/index.ts"], {
    stdio: "ignore",
    env: { ...process.env, PORT: "3001" },
  }),
  spawn(
    "node",
    [
      "node_modules/vite/bin/vite.js",
      "--host",
      "127.0.0.1",
      "--port",
      "5173",
      "--strictPort",
    ],
    { stdio: "ignore" },
  ),
];
let browser;
try {
  let ready = false;
  for (let i = 0; i < 90; i++) {
    try {
      if ((await fetch(base)).ok) {
        ready = true;
        break;
      }
    } catch {}
    await delay(500);
  }
  if (!ready) throw Error("Aplicação isolada não iniciou.");
  browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.accept());
  await page.goto(base + "/configuracoes?aba=usuarios");
  await page.getByLabel("E-mail", { exact: true }).fill(credential.email);
  await page.getByLabel("Senha", { exact: true }).fill(credential.password);
  await page.getByRole("button", { name: "Entrar na oficina" }).click();
  await page.goto(base + "/configuracoes?aba=usuarios");
  await expect(
    page.getByRole("heading", { name: "Usuários e permissões", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Novo funcionário", exact: true })
    .click();
  let dialog = page.getByRole("dialog");
  await dialog
    .getByRole("textbox", { name: "Nome", exact: true })
    .fill("OPS004 Funcionário Fictício");
  await dialog
    .getByRole("textbox", { name: "Função", exact: true })
    .fill("Mecânico");
  await dialog.getByRole("button", { name: "Salvar funcionário" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("cell", {
      name: "OPS004 Funcionário Fictício",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Convidar usuário" }).click();
  dialog = page.getByRole("dialog");
  await dialog
    .getByRole("textbox", { name: "E-mail", exact: true })
    .fill("ops004-ui@example.test");
  await dialog
    .getByRole("combobox", { name: "Funcionário existente (opcional)" })
    .selectOption({ label: "OPS004 Funcionário Fictício" });
  await dialog.getByRole("button", { name: "Salvar acesso" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("cell", { name: "ops004-ui@example.test", exact: true }),
  ).toBeVisible();
  const invitation = page
    .getByRole("row")
    .filter({
      has: page.getByRole("cell", {
        name: "ops004-ui@example.test",
        exact: true,
      }),
    });
  await invitation
    .getByRole("button", { name: "Reenviar", exact: true })
    .click();
  await expect(
    invitation.getByRole("cell", { name: "Pendente", exact: true }),
  ).toBeVisible();
  await invitation.getByRole("button", { name: "Cancelar convite" }).click();
  await expect(
    invitation.getByRole("cell", { name: "Cancelado", exact: true }),
  ).toBeVisible();
  for (const [viewport, size] of [
    ["desktop", { width: 1440, height: 1000 }],
    ["tablet", { width: 768, height: 1024 }],
    ["mobile", { width: 390, height: 844 }],
  ]) {
    await page.setViewportSize(size);
    await page.screenshot({
      path: resolve(output, `ops004-users-${viewport}.png`),
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Editar acesso", exact: true })
      .first()
      .click();
    dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("heading", { name: "Editar acesso" }),
    ).toBeVisible();
    await page.screenshot({
      path: resolve(output, `ops004-permissions-${viewport}.png`),
      fullPage: true,
    });
    await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
    await page
      .getByRole("button", { name: "Novo funcionário", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.screenshot({
      path: resolve(output, `ops004-staff-${viewport}.png`),
      fullPage: true,
    });
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Fechar", exact: true })
      .click();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth + 2,
    );
    expect(overflow).toBe(false);
  }
  const workspace = await (
    await page.request.get(base + "/api/workspace")
  ).json();
  const order = workspace.orders.find(
    (o) =>
      ["quote", "open", "working", "ready"].includes(o.status) &&
      o.items.length &&
      o.total > 0,
  );
  if (!order) throw Error("OS fictícia para validação de aprovação ausente.");
  await page.goto(base + "/ordens/" + order.id);
  await page
    .getByRole("spinbutton", { name: "Desconto total solicitado" })
    .fill("1");
  await page
    .getByRole("textbox", { name: "Justificativa", exact: true })
    .fill("Solicitação fictícia para validar a interface.");
  await page
    .getByRole("button", { name: "Solicitar aprovação", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Justificativa", exact: true }),
  ).toHaveValue("");
  await page.goto(base + "/aprovacoes");
  await expect(
    page.getByRole("heading", { name: "Central de aprovações", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "Pendente", exact: true }).first(),
  ).toBeVisible();
  for (const [viewport, size] of [
    ["desktop", { width: 1440, height: 1000 }],
    ["mobile", { width: 390, height: 844 }],
  ]) {
    await page.setViewportSize(size);
    await page.screenshot({
      path: resolve(output, `ops004-approvals-${viewport}.png`),
      fullPage: true,
    });
  }
  expect(errors).toEqual([]);
  console.log(
    "OPS004: navegação, funcionário sem login, convites, cancelamento, formulários, aprovações e três tamanhos validados com API e PostgreSQL fictícios.",
  );
} finally {
  await browser?.close();
  for (const child of children) child.kill("SIGTERM");
}
