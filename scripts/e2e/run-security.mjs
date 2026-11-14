import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { createSessionPool, readAccountsFile, profiles } from "./isolated-sessions.mjs";

const file = process.env.TEST_ACCOUNTS_FILE;
if (!file) throw Error("TEST_ACCOUNTS_FILE_REQUIRED");
const configuration = readAccountsFile(file);
const report = { environment: configuration.baseURL, startedAt: new Date().toISOString(), checks: [], blockers: [] };
let pool;
try {
  pool = await createSessionPool(configuration.baseURL, configuration.accounts);
  const identities = new Map(), workspaces = new Map();
  for (const [id, session] of pool.sessions) {
    identities.set(id, await session.identity()); workspaces.set(id, await session.workspace());
  }
  for (const [id, session] of pool.sessions) {
    const identity = identities.get(id), workspace = workspaces.get(id);
    const forbiddenIds = [...pool.sessions.values()].filter(other => other.account.tenantId !== session.account.tenantId)
      .flatMap(other => (workspaces.get(other.account.id)?.orders || []).map(o => o.id));
    for (const order of forbiddenIds.slice(0, 10)) {
      const response = await session.request("GET", `/api/orders/${order}/assignments`);
      assert.ok([403, 404].includes(response.status()), "CROSS_OFFICE_ASSIGNMENTS_EXPOSED");
      session.permitDocumentProbe(order);
      const document = await session.request("GET", `/api/documents/order/${order}?current=1`);
      assert.ok([403,404].includes(document.status()), "CROSS_OFFICE_DOCUMENT_EXPOSED");
    }
    for (const other of pool.sessions.values()) if (other.account.tenantId !== session.account.tenantId) {
      const response = await session.request("POST", "/api/tenant", { tenant_id: other.account.tenantId });
      assert.ok([403, 404].includes(response.status()), "CROSS_OFFICE_SWITCH_ALLOWED");
      await session.identity();
    }
    for (const [path, permission] of [["/api/users", "users.manage"], ["/api/staff", "staff.view"], ["/api/cash-control", "finance.view"], ["/api/repair-services/brands", "technical.view"]]) {
      const response = await session.request("GET", path);
      assert.equal(response.status(), identity.access.permissions[permission] ? 200 : 403, "ACTION_PERMISSION_MISMATCH");
    }
    if (session.account.profile === "mechanic") {
      const sameOfficeMaster = [...pool.sessions.values()].find(s => s.account.tenantId === session.account.tenantId && s.account.profile === 'master');
      const unassigned = (workspaces.get(sameOfficeMaster?.account.id)?.orders || []).filter(o => !(workspace.orders || []).some(visible => visible.id === o.id));
      assert.ok(unassigned.length, 'UNASSIGNED_ORDER_FIXTURE_REQUIRED');
      for (const order of unassigned) {
        const denied = await session.request('GET', `/api/orders/${order.id}/assignments`);
        assert.ok([403,404].includes(denied.status()), 'UNASSIGNED_ORDER_EXPOSED');
        session.permitDocumentProbe(order.id);
        const document = await session.request('GET', `/api/documents/order/${order.id}?current=1`);
        assert.ok([403,404].includes(document.status()), 'UNASSIGNED_DOCUMENT_EXPOSED');
      }
      assert.equal((await session.request("GET", "/api/users")).status(), 403, "MECHANIC_USERS_EXPOSED");
      for (const customer of workspace.customers || []) for (const key of ["phone", "email", "address"]) assert.ok(!customer[key], "PERSONAL_DATA_EXPOSED");
      for (const key of ["receivables", "cash", "cash_accounts"]) assert.equal((workspace[key] || []).length, 0, "FINANCIAL_DATA_EXPOSED");
    }
    const page = await session.context.newPage();
    await page.goto(pool.origin + "/dashboard", { waitUntil: "networkidle" });
    await page.getByText(profiles[session.account.profile], { exact: true }).first().waitFor();
    report.checks.push({ account: id, profile: identity.access.profile, tenant: session.account.tenantId, status: "passed", orders: workspace.orders.length, crossOfficeOrdersChecked: Math.min(forbiddenIds.length, 10) });
    await page.close();
  }
} catch (error) {
  report.blockers.push(error.code || (/^[A-Z_]+$/.test(error.message) ? error.message : "VALIDATION_FAILED"));
  process.exitCode = 1;
} finally {
  if (pool) report.logoutFailures = await pool.close();
  report.finishedAt = new Date().toISOString();
  writeFileSync(process.env.TEST_REPORT_FILE || "/tmp/osdrive-session-report.json", JSON.stringify(report, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ checks: report.checks.length, blockers: report.blockers, passed: !process.exitCode }));
}
