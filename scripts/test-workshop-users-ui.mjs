import { spawn, execFileSync } from "node:child_process";
import { readFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium, expect } from "@playwright/test";
const base = "http://127.0.0.1:5173";
if (process.env.VERCEL || process.env.NODE_ENV === "production")
  throw Error("Somente aplicação de testes em loopback.");
let credential;
const output = resolve(process.env.RUNNER_TEMP || "/tmp", "ops004-users-ui");
mkdirSync(output, { recursive: true });
const children = [
  spawn("node", ["--import", "tsx", "server/index.ts"], {
    stdio: ["ignore", "ignore", "pipe"],
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
let browser, page;
const serverErrors = [];
children[0].stderr.on("data", (chunk) => {
  for (const line of String(chunk).split("\n"))
    if (
      /^(error|Error|TypeError|ReferenceError|SyntaxError|RangeError):/.test(
        line,
      )
    )
      serverErrors.push(line.replace(/[a-f0-9]{32,}/gi, "[omitido]"));
});
try {
  let ready = false;
  for (let i = 0; i < 90; i++) {
    try {
      const apiReady = await fetch(base + "/api/session");
      if (
        (await fetch(base)).ok &&
        apiReady.status === 401 &&
        apiReady.headers.get("content-type")?.includes("application/json")
      ) {
        ready = true;
        break;
      }
    } catch {}
    await delay(500);
  }
  if (!ready) throw Error("Aplicação isolada não iniciou.");
  execFileSync(
    process.execPath,
    ["--import", "tsx", "scripts/ops004-ui-fixture.ts"],
    { stdio: "pipe" },
  );
  const collaborator = JSON.parse(
    readFileSync(
      resolve(process.env.RUNNER_TEMP || "/tmp", "ops004-ui-identity.json"),
      "utf8",
    ),
  );
  credential = {
    email: collaborator.ownerEmail,
    password: collaborator.ownerPassword,
  };
  browser = await chromium.launch();
  page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  page.setDefaultTimeout(15000);
  const capture = async (options) => {
    await page.evaluate(() => {
      window.scrollTo(0, 0);
      document.querySelectorAll(".table-scroll").forEach((el) => {
        el.scrollLeft = 0;
      });
    });
    await page.screenshot({ ...options, animations: "disabled" });
  };
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("response", (r) => {
    const path = new URL(r.url()).pathname;
    if (path.startsWith("/api/") && r.status() >= 500)
      console.log("OPS004 resposta", path, r.status());
  });
  let rejectNextDialog = false,
    guardPrompts = 0;
  page.on("dialog", (d) => {
    guardPrompts++;
    if (rejectNextDialog) {
      rejectNextDialog = false;
      return d.dismiss();
    }
    return d.accept();
  });
  await page.goto(base + "/configuracoes?aba=usuarios");
  await page.getByLabel("E-mail", { exact: true }).fill(credential.email);
  await page.getByLabel("Senha", { exact: true }).fill(credential.password);
  const [login] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith("/api/login") && r.request().method() === "POST",
    ),
    page.getByRole("button", { name: "Entrar na oficina" }).click(),
  ]);
  if (login.status() !== 200)
    throw Error("Login fictício falhou; valores de credenciais omitidos.");
  await page
    .getByRole("heading", { name: "Por onde vamos começar?", exact: true })
    .waitFor({ timeout: 15000 });
  await page.goto(base + "/configuracoes?aba=usuarios");
  await expect(page.locator(".user-card").getByText("Master", { exact: true })).toHaveCount(1);
  await expect(
    page.getByRole("heading", { name: "Usuários e permissões", exact: true }),
  ).toBeVisible({ timeout: 15000 });
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
    page
      .getByRole("cell", {
        name: "OPS004 Funcionário Fictício",
        exact: true,
      })
      .first(),
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
    page
      .getByRole("cell", { name: "ops004-ui@example.test", exact: true })
      .first(),
  ).toBeVisible();
  const invitation = page
    .getByRole("table")
    .filter({
      has: page.getByRole("columnheader", { name: "E-mail", exact: true }),
    })
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
    await capture({
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
    await capture({
      path: resolve(output, `ops004-permissions-${viewport}.png`),
      fullPage: true,
    });
    await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
    await page
      .getByRole("button", { name: "Novo funcionário", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await capture({
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
    .getByRole("checkbox", { name: "OPS004 Funcionário Fictício", exact: true })
    .check();
  await page
    .getByRole("button", { name: "Salvar responsáveis", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (
          await (
            await page.request.get(base + `/api/orders/${order.id}/assignments`)
          ).json()
        ).filter((a) => !a.removed_at).length,
    )
    .toBe(1);
  await expect(
    page.getByRole("button", { name: "Salvar responsáveis", exact: true }),
  ).toBeEnabled();
  for (const [viewport, size] of [
    ["desktop", { width: 1440, height: 1000 }],
    ["mobile", { width: 390, height: 844 }],
  ]) {
    await page.setViewportSize(size);
    await capture({
      path: resolve(output, `ops004-order-access-${viewport}.png`),
      fullPage: true,
    });
  }

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
    await capture({
      path: resolve(output, `ops004-approvals-${viewport}.png`),
      fullPage: true,
    });
  }
  await page.request.post(base + "/api/logout", { data: {} });
  await page.goto(base + "/inicio");
  await page.getByLabel("E-mail", { exact: true }).fill(collaborator.email);
  await page.getByLabel("Senha", { exact: true }).fill(collaborator.password);
  await page.getByRole("button", { name: "Entrar na oficina" }).click();
  const officeDialog = page.getByRole("dialog", {
    name: "Selecione a oficina",
  });
  await expect(officeDialog).toBeVisible();
  for (const [viewport, size] of [
    ["desktop", { width: 1440, height: 1000 }],
    ["mobile", { width: 390, height: 844 }],
  ]) {
    await page.setViewportSize(size);
    await capture({
      path: resolve(output, `ops004-office-${viewport}.png`),
      fullPage: true,
    });
  }

  await officeDialog
    .getByRole("button", { name: "Oficina Fictícia A", exact: true })
    .click();
  await expect(officeDialog).toHaveCount(0);
  await page.goto(base + "/inicio");
  await expect(
    page.getByRole("heading", { name: "Por onde vamos começar?", exact: true }),
  ).toBeVisible();
  const accountA = await (await page.request.get(base + "/api/session")).json();
  expect(accountA.access.profile).toBe("finance");
  await expect(page.locator(".user-card").getByText("Financeiro", { exact: true })).toHaveCount(1);
  expect(accountA.tenant.id).toBe(collaborator.tenantA);
  const dataA = await (await page.request.get(base + "/api/workspace")).json();
  for (const customer of dataA.customers)
    for (const field of ["phone", "email", "address", "document", "birthday"])
      expect(customer[field]).toBeUndefined();
  expect((await page.request.get(base + "/api/users")).status()).toBe(403);
  await page.goto(base + "/ordens/" + order.id);
  const draftReason = page.getByRole("textbox", {
    name: "Justificativa",
    exact: true,
  });
  await draftReason.fill("Rascunho fictício ainda não enviado.");
  const promptsBefore = guardPrompts;
  rejectNextDialog = true;
  await page
    .getByRole("combobox", { name: "Oficina ativa" })
    .selectOption(collaborator.tenantB);
  await expect.poll(() => guardPrompts).toBe(promptsBefore + 1);
  expect(
    (await (await page.request.get(base + "/api/session")).json()).tenant.id,
  ).toBe(collaborator.tenantA);
  await expect(draftReason).toHaveValue("Rascunho fictício ainda não enviado.");
  await page
    .getByRole("combobox", { name: "Oficina ativa" })
    .selectOption(collaborator.tenantB);
  await expect
    .poll(
      async () =>
        (await (await page.request.get(base + "/api/session")).json()).tenant
          .id,
    )
    .toBe(collaborator.tenantB);
  const accountB = await (await page.request.get(base + "/api/session")).json();
  expect(accountB.access.profile).toBe("mechanic");
  await expect(page.locator(".user-card").getByText("Mecânico", { exact: true })).toHaveCount(1);
  await expect(
    page.getByRole("heading", { name: "Por onde vamos começar?", exact: true }),
  ).toBeVisible();
  const dataB = await (await page.request.get(base + "/api/workspace")).json();
  expect(dataB.orders.every((o) => o.tenant_id === collaborator.tenantB)).toBe(
    true,
  );
  await page.goto(base + "/aceitar-convite#" + collaborator.inviteToken);
  await expect(page.getByLabel("Seu nome", { exact: true })).toBeVisible();
  await expect.poll(() => new URL(page.url()).hash).toBe("");
  for (const [viewport, size] of [
    ["desktop", { width: 1440, height: 1000 }],
    ["mobile", { width: 390, height: 844 }],
  ]) {
    await page.setViewportSize(size);
    await capture({
      path: resolve(output, `ops004-invite-${viewport}.png`),
      fullPage: true,
    });
  }
  await page
    .getByLabel("Seu nome", { exact: true })
    .fill("Colaborador Ativado Fictício");
  await page
    .getByLabel("Crie sua senha (mínimo de 12 caracteres)", { exact: true })
    .fill(collaborator.password);
  await page
    .getByRole("button", { name: "Aceitar convite", exact: true })
    .click();
  await expect(
    page.getByText("Convite aceito. A conta está vinculada à oficina.", {
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Entrar no sistema", exact: true })
    .click();
  await page
    .getByLabel("E-mail", { exact: true })
    .fill(collaborator.activationEmail);
  await page.getByLabel("Senha", { exact: true }).fill(collaborator.password);
  await page.getByRole("button", { name: "Entrar na oficina" }).click();
  await expect(
    page.getByRole("heading", { name: "Por onde vamos começar?", exact: true }),
  ).toBeVisible();
  const activated = await (
    await page.request.get(base + "/api/session")
  ).json();
  expect(activated.user.email).toBe(collaborator.activationEmail);
  expect(activated.tenant.id).toBe(collaborator.tenantA);
  expect(activated.access.profile).toBe("mechanic");
  expect(activated.must_select_office).toBe(false);
  expect(activated.access.orderScope).toBe("assigned");
  const ownerContext = await browser.newContext();
  try {
    const login = await ownerContext.request.post(base + "/api/login", {
      data: { email: collaborator.ownerEmail, password: collaborator.ownerPassword },
    });
    expect(login.status()).toBe(200);
    const staffResponse = await ownerContext.request.post(base + "/api/staff", {
      data: { name: "OPS004 Mecânico Ativado Fictício", role: "Mecânico", active: true, productive: true, user_id: activated.user.id },
    });
    expect(staffResponse.ok()).toBe(true);
    const staff = await staffResponse.json();
    const assignment = await ownerContext.request.put(base + `/api/orders/${order.id}/assignments`, {
      data: { professional_ids: [staff.id] },
    });
    expect(assignment.ok()).toBe(true);
  } finally {
    await ownerContext.close();
  }
  await page.goto(base + "/ordens/" + order.id);
  await expect(page.getByRole("heading", { name: "Detalhes da OS", exact: true })).toBeVisible();
  const technicalWorkspace = await (await page.request.get(base + "/api/workspace")).json();
  expect(technicalWorkspace.orders.map(o => o.id)).toEqual([order.id]);
  expect(technicalWorkspace.vehicles).toEqual([]);
  expect(technicalWorkspace.customers).toEqual([]);
  expect(technicalWorkspace.orders[0].vehicle_year).toBe(2024);
  expect(technicalWorkspace.orders[0].vehicle_model_year).toBe(2025);
  expect(technicalWorkspace.orders[0].total).toBeUndefined();
  for (const [viewport, size] of [
    ["desktop", { width: 1440, height: 1000 }],
    ["mobile", { width: 390, height: 844 }],
  ]) {
    await page.setViewportSize(size);
    await expect(page.getByText("2024 / 2025", { exact: true })).toBeVisible();
    await expect(page.locator(".user-card").getByText("Mecânico", { exact: true })).toHaveCount(1);
    await expect(page.locator(".user-card").getByText("Administrador", { exact: true })).toHaveCount(0);
    await capture({ path: resolve(output, `ops004-mechanic-order-${viewport}.png`), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2)).toBe(false);
  }
  await page.goto(base + "/servicos");
  await expect(
    page.getByRole("tab", { name: "Catálogo de Tempos", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByRole("tab", { name: "Serviços Próprios", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Novo serviço", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("combobox", { name: "Marca", exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
  console.log(
    "OPS004: navegação, funcionário sem login, convites, cancelamento, formulários, aprovações e três tamanhos validados com API e PostgreSQL fictícios.",
  );
} catch (error) {
  for (const line of serverErrors.slice(-10))
    console.log("OPS004 servidor:", line);
  if (page && (await page.locator("input[type=password]").count()) === 0)
    await page
      .screenshot({ path: resolve(output, "failure.png"), fullPage: true })
      .catch(() => {});
  throw error;
} finally {
  await browser?.close();
  for (const child of children) child.kill("SIGTERM");
}
