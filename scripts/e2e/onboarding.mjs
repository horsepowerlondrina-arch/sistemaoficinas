import { randomBytes } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { chromium, expect } from "@playwright/test";
import { HOMOLOGATION } from "./isolated-sessions.mjs";
import { activationLink } from "./activation-mail.mjs";

const command = process.argv[2], file = resolve(process.env.TEST_ONBOARDING_FILE || "data/test-onboarding.json");
const save = value => writeFileSync(file, JSON.stringify(value, null, 2), { mode: 0o600 });
if (command === "init") {
  if (existsSync(file)) throw Error("MANIFEST_ALREADY_EXISTS");
  const run = process.env.TEST_RUN_ID || new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  if (!/^[a-z0-9-]{8,24}$/.test(run)) throw Error("RUN_ID_INVALID");
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const offices = [["basic", 2], ["professional", 5], ["premium", 10]].map(([plan, limit]) => ({
    plan, limit, name: `Oficina Fictícia Automação ${plan} ${run}`, tenantId: null,
    members: Array.from({ length: limit }, (_, i) => ({ id: `${plan}-${i}`, email: `${plan}-${run}-${i}@testes.osdrive.com.br`, password: randomBytes(24).toString("base64url"), profile: i === 0 ? "master" : ["mechanic", "advisor", "finance", "manager"][(i - 1) % 4], registeredAt: null, activated: false })),
  }));
  save({ schemaVersion: 2, baseURL: HOMOLOGATION, run, offices });
  console.log(JSON.stringify({ initialized: true, masterEmails: offices.map(o => o.members[0].email) }));
  process.exit(0);
}
const stat = lstatSync(file);
if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) || stat.uid !== process.getuid()) throw Error("PRIVATE_MANIFEST_REQUIRED");
const data = JSON.parse(readFileSync(file, "utf8"));
if (data.schemaVersion !== 2 || data.baseURL !== HOMOLOGATION || data.offices.length !== 3) throw Error("MANIFEST_INVALID");
if (!new Set(["register", "activate", "checkout", "invite", "accept", "verify", "export", "fixtures"]).has(command)) throw Error("COMMAND_INVALID");
for (const office of data.offices) {
  if (!['basic','professional','premium'].includes(office.plan) || !/Fictícia/.test(office.name) || office.members.length !== office.limit) throw Error('FICTITIOUS_MANIFEST_REQUIRED');
  for (const account of office.members) if (!/^[a-z0-9._-]+@testes\.osdrive\.com\.br$/.test(account.email) || account.password.length < 12 || !['master','mechanic','manager','advisor','finance'].includes(account.profile)) throw Error('FICTITIOUS_MANIFEST_REQUIRED');
}
if (command === 'export') {
  const accounts = data.offices.flatMap(o => o.members.filter(a => a.activated).map(a => ({ ...a, fictitious: true, tenantId: o.tenantId, workshopName: o.name })));
  writeFileSync(resolve(dirname(file), 'test-accounts.json'), JSON.stringify({schemaVersion:1,baseURL:HOMOLOGATION,accounts},null,2), {mode:0o600});
  console.log(JSON.stringify({exported:accounts.length})); process.exit(0);
}
const messages = process.env.TEST_MAIL_FILE ? JSON.parse(readFileSync(process.env.TEST_MAIL_FILE, "utf8")) : [];
const browser = await chromium.launch({ headless: true });
const report = { command, checks: [], errors: [] };
const request = async (context, method, path, body) => {
  if (!path.startsWith("/api/") || path.includes("..") || path.includes("?")) throw Error("PATH_REFUSED");
  const r = await context.request.fetch(HOMOLOGATION + path, { method, data: body, headers: { Origin: HOMOLOGATION }, maxRedirects: 0 });
  if (!r.ok()) throw Error(`API_${r.status()}`); return r.json();
};
const login = async (context, account, tenantId) => {
  await request(context, "POST", "/api/login", { email: account.email, password: account.password });
  const identity = await request(context, "GET", "/api/session");
  if (identity.user.email !== account.email || identity.tenant.id !== tenantId) throw Error("IDENTITY_MISMATCH");
  return identity;
};
try {
  for (const office of data.offices) {
    const context = await browser.newContext({ serviceWorkers: "block", acceptDownloads: false });
    const page = await context.newPage(); page.setDefaultTimeout(20000);
    const master = office.members[0];
    try {
      if (command === "register") {
        if (master.registeredAt) continue;
        await page.goto(HOMOLOGATION + "/criar-oficina");
        await page.getByLabel("Nome da oficina", { exact: true }).fill(office.name);
        await page.getByLabel("Nome do responsável").fill("Master Fictício Automação");
        await page.getByLabel("E-mail do responsável").fill(master.email);
        await page.getByLabel("Plano inicial").selectOption(office.plan);
        master.registeredAt = new Date().toISOString(); save(data);
        await page.getByRole("button", { name: "Receber ativação por e-mail" }).click();
        await expect(page.getByRole("status")).toContainText("ativação");
      } else if (command === "activate" || command === "accept") {
        const selected = command === "activate" ? [master] : office.members.slice(1);
        for (const account of selected) {
          if (account.activated) continue;
          const matching = messages.filter(m => (Array.isArray(m.to) ? m.to : [m.to]).includes(account.email));
          if (matching.length !== 1) throw Error("ACTIVATION_MAIL_REQUIRED");
          await page.goto(activationLink(matching[0], { email: account.email, after: account.registeredAt, path: command === "activate" ? "/ativar-oficina" : "/aceitar-convite" }));
          if (command === "activate") {
            await expect(page.getByText(office.name, { exact: true })).toBeVisible();
            await page.getByLabel("Crie uma senha", { exact: true }).fill(account.password);
            await page.getByLabel("Confirme a senha").fill(account.password);
            const [r] = await Promise.all([page.waitForResponse(r => r.url().endsWith("/workshop-activation/complete")), page.getByRole("button", { name: "Confirmar e ativar oficina" }).click()]);
            if (!r.ok()) throw Error("ACTIVATION_FAILED"); office.tenantId = (await r.json()).tenant_id;
            await login(context, account, office.tenantId);
          } else {
            await expect(page.getByLabel("E-mail convidado")).toHaveValue(account.email);
            await page.getByLabel("Seu nome", { exact: true }).fill("Usuário Fictício Automação");
            await page.getByLabel("Crie sua senha (mínimo de 12 caracteres)").fill(account.password);
            await page.getByRole("button", { name: "Aceitar convite" }).click();
            await expect(page.getByText("Convite aceito. A conta está vinculada à oficina.")).toBeVisible();
          }
          account.activated = true; save(data);
        }
      } else {
        if (!office.tenantId || !master.activated) throw Error("MASTER_ACTIVATION_REQUIRED");
        await login(context, master, office.tenantId);
        if (command === "checkout") {
          const summary = await request(context, "GET", "/api/account/billing");
          if (summary.test_mode !== true) throw Error("STRIPE_TEST_MODE_REQUIRED");
          if (summary.payments.some(p => p.status === "paid") && summary.account?.plan_code === office.plan) { office.paid = true; save(data); continue; }
          await page.goto(HOMOLOGATION + "/configuracoes?aba=assinatura");
          await page.getByRole("button", { name: "Assinar plano", exact: true }).click();
          const price = summary.prices.find(p => p.plan_code === office.plan); if (!price) throw Error("PRICE_REQUIRED");
          await page.getByLabel("Plano mensal").selectOption(price.id);
          await page.getByLabel(/Li os valores/).check();
          await page.getByRole("button", { name: "Continuar no Stripe" }).click();
          await page.waitForURL(u => u.hostname === "checkout.stripe.com");
          if (!page.url().includes("test_")) throw Error("STRIPE_TEST_CHECKOUT_REQUIRED");
          await page.locator('[name="cardNumber"]').fill("4242424242424242");
          await page.locator('[name="cardExpiry"]').fill("12/34");
          await page.locator('[name="cardCvc"]').fill("123");
          await page.locator('[name="billingName"]').fill("Master Fictício Automação");
          const country = page.locator('[name="billingCountry"]'); if (await country.count()) await country.selectOption("BR");
          await page.locator('[data-testid="hosted-payment-submit-button"]').click();
          await page.waitForURL(u => u.origin === HOMOLOGATION || u.origin === "https://osdrive.com.br", { timeout: 90000 });
          const verified = await request(context, "POST", "/api/account/billing/refresh", {});
          if (!verified.payments.some(p => p.status === "paid") || verified.account?.plan_code !== office.plan || !verified.account?.managed) throw Error("PAYMENT_NOT_CONFIRMED");
          office.paid = true; save(data);
        } else if (command === "invite") {
          if (!office.paid) throw Error("CONFIRMED_PAYMENT_REQUIRED");
          const users = await request(context, "GET", "/api/users");
          if (users.capacity.limit !== office.limit) throw Error("PLAN_CAPACITY_MISMATCH");
          for (const account of office.members.slice(1)) {
            if (account.registeredAt) continue;
            account.registeredAt = new Date().toISOString(); save(data);
            if (account.profile === "mechanic" && !account.professionalId) {
              const staff = await request(context, "POST", "/api/staff", { name: "Mecânico Fictício " + account.id, role: "Mecânico", active: true, productive: true, user_id: null });
              account.professionalId = staff.id; save(data);
            }
            await request(context, "POST", "/api/user-invites", { email: account.email, profile: account.profile, order_scope: account.profile === "mechanic" ? "assigned" : "all", professional_id: account.professionalId || null });
          }
        } else if (command === "fixtures") {
          if (!office.paid || !office.members.every(a => a.activated)) throw Error("ACTIVATED_ACCOUNTS_REQUIRED");
          if (!office.customerId) {
            const linked = await request(context, "POST", "/api/customers-with-vehicle", {
              customer: { name: "Cliente Fictício " + office.plan, phone: "00000000000", email: `cliente-${office.plan}-${data.run}@testes.osdrive.com.br`, address: "Endereço Fictício de Teste", document: "", notes: "Dados fictícios para validação" },
              vehicle: { plate: ['TST0A01','TST0A02','TST0A03'][data.offices.indexOf(office)], brand: "Marca Fictícia", model: "Veículo Fictício", year: 2026, model_year: 2026, color: "Prata", km: 0, service_model_id: null, service_link_mode: "none" },
            }); office.customerId = linked.id; office.vehicleId = linked.vehicle_id; save(data);
          }
          office.orderIds ||= [];
          while (office.orderIds.length < 2) {
            const day = new Date().toISOString().slice(0,10);
            const order = await request(context, "POST", "/api/orders", { customer_id: office.customerId, vehicle_id: office.vehicleId, status: "open", entered_on: day, due_on: day, km: 0, problem: "Validação fictícia de permissões", notes: "Sem movimentação financeira operacional", discount: 0, items: [] });
            office.orderIds.push(order.id); save(data);
          }
          await request(context, "PUT", `/api/orders/${office.orderIds[0]}/assignments`, { professional_ids: office.members.filter(a => a.profile === 'mechanic').map(a => a.professionalId) });
          for (const account of office.members) account.visibleOrderIds = account.profile === 'mechanic' ? [office.orderIds[0]] : office.orderIds;
          save(data);
        } else {
          const users = await request(context, "GET", "/api/users"), billing = await request(context, "GET", "/api/account/billing");
          if (users.capacity.active !== office.limit || users.capacity.available !== 0 || billing.account?.plan_code !== office.plan || !billing.payments.some(p => p.status === "paid")) throw Error("FINAL_STATE_MISMATCH");
          report.checks.push({ plan: office.plan, activeUsers: users.capacity.active, paid: true });
        }
      }
    } catch (error) { report.errors.push({ plan: office.plan, code: /^[A-Z_0-9]+$/.test(error.message) ? error.message : "UI_VALIDATION_FAILED" }); process.exitCode = 1; }
    finally { await context.request.post(HOMOLOGATION + "/api/logout", { headers: { Origin: HOMOLOGATION }, data: {} }).catch(() => {}); await context.close(); }
  }
} finally {
  await browser.close();
  writeFileSync(process.env.TEST_REPORT_FILE || "/tmp/osdrive-onboarding-report.json", JSON.stringify(report, null, 2), { mode: 0o600 });
  console.log(JSON.stringify(report));
}
