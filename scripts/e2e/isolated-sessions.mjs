import { lstatSync, readFileSync } from "node:fs";

export const HOMOLOGATION = "https://sistema-oficinas-homologacao.vercel.app";
export const profiles = { master: "Master", manager: "Gerente", advisor: "Consultor de Serviços", mechanic: "Mecânico", finance: "Financeiro" };
export class SessionTestError extends Error {
  constructor(code) { super(code); this.code = code; }
}
const fail = code => { throw new SessionTestError(code); };
export function targetPolicy(baseURL, mode) {
  let url;
  try { url = new URL(baseURL); } catch { fail("TARGET_REFUSED"); }
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") fail("TARGET_REFUSED");
  const local = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) && url.protocol === "http:";
  if (mode === "homologation" ? url.origin !== HOMOLOGATION : mode !== "isolated" || !local) fail("TARGET_REFUSED");
  return { origin: url.origin, mode };
}
export function validateAccounts(accounts) {
  if (!Array.isArray(accounts) || accounts.length < 2 || accounts.length > 20) fail("ACCOUNTS_INVALID");
  const ids = new Set();
  for (const a of accounts) {
    if (!a || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(a.id) || ids.has(a.id) || a.fictitious !== true ||
      !Object.hasOwn(profiles, a.profile) || typeof a.email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a.email) ||
      typeof a.password !== "string" || !a.password.length || a.password.length > 200 ||
      typeof a.tenantId !== "string" || !/^[a-zA-Z0-9_-]{1,120}$/.test(a.tenantId) ||
      typeof a.workshopName !== "string" || !/fict[ií]ci|teste|demonstra/i.test(a.workshopName) ||
      (a.visibleOrderIds !== undefined && (!Array.isArray(a.visibleOrderIds) || a.visibleOrderIds.some(id => !/^[a-zA-Z0-9_-]{1,120}$/.test(id))))) fail("ACCOUNTS_INVALID");
    ids.add(a.id);
  }
  return accounts;
}
export function readAccountsFile(path) {
  let stat, data;
  try {
    stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 100_000 ||
      (process.platform !== "win32" && ((stat.mode & 0o077) !== 0 || stat.uid !== process.getuid()))) fail("CREDENTIAL_FILE_PRIVATE_REQUIRED");
    data = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    if (error instanceof SessionTestError) throw error;
    fail("CREDENTIAL_FILE_UNAVAILABLE");
  }
  if (data.schemaVersion !== 1) fail("ACCOUNTS_INVALID");
  targetPolicy(data.baseURL, "homologation");
  validateAccounts(data.accounts);
  return data;
}

export function permitsRequest(policy, method, address, draftOrders = new Set()) {
  let url;
  try { url = new URL(address, policy.origin); } catch { return false; }
  if (url.origin !== policy.origin || url.username || url.password) return false;
  if (policy.mode === "isolated") return true;
  const path = url.pathname;
  if (method === "POST") return ["/api/login", "/api/logout", "/api/tenant"].includes(path) && !url.search;
  if (!["GET", "HEAD"].includes(method)) return false;
  if (!path.startsWith("/api/")) return !/^\/(admin|p)(\/|$)/.test(path);
  if (/^\/api\/(session|workspace|users|users\/history|staff|approvals|cash-control)$/.test(path)) return !url.search;
  if (/^\/api\/orders\/[a-zA-Z0-9_-]+\/assignments$/.test(path)) return !url.search;
  const document = path.match(/^\/api\/documents\/order\/([a-zA-Z0-9_-]+)$/);
  return !!document && draftOrders.has(document[1]) && (!url.search || url.search === "?current=1");
}

// Every invocation owns a fresh browser. Never attach to Chrome, a user profile,
// CDP, an existing storageState, or the session used by the person developing.
export async function createSessionPool(baseURL, accounts, mode = "homologation") {
  const policy = targetPolicy(baseURL, mode);
  validateAccounts(accounts);
  const { chromium } = await import("@playwright/test");
  const browser = await chromium.launch({ headless: true });
  const sessions = new Map();
  const close = async () => {
    let failures = 0;
    for (const s of sessions.values()) {
      try { await s.logout(); } catch { failures++; }
      await s.context.close().catch(() => {});
    }
    await browser.close();
    return failures;
  };
  try {
    for (const account of accounts) {
      const context = await browser.newContext({ serviceWorkers: "block", acceptDownloads: false });
      context.setDefaultTimeout(15_000);
      const draftOrders = new Set();
      const blocked = [];
      await context.route("**/*", async route => {
        const request = route.request();
        if (permitsRequest(policy, request.method(), request.url(), draftOrders)) return route.continue();
        blocked.push({ method: request.method(), api: new URL(request.url()).pathname.startsWith("/api/") });
        return route.abort("blockedbyclient");
      });
      const request = async (method, path, data) => {
        if (!permitsRequest(policy, method, path, draftOrders)) fail("READ_ONLY_BLOCKED");
        return context.request.fetch(new URL(path, policy.origin).href, {
          method, data, maxRedirects: 0, timeout: 20_000,
          headers: { Origin: policy.origin },
        });
      };
      const session = {
        account, context, blocked, request,
        async identity() {
          const response = await request("GET", "/api/session");
          if (response.status() !== 200) fail("SESSION_UNAVAILABLE");
          const identity = await response.json();
          if (identity.user?.email?.toLowerCase() !== account.email.toLowerCase() || identity.tenant?.id !== account.tenantId ||
            identity.tenant?.name !== account.workshopName || identity.access?.profile !== account.profile || !identity.access?.active) fail("IDENTITY_MISMATCH");
          return identity;
        },
        async workspace() {
          const response = await request("GET", "/api/workspace");
          if (response.status() !== 200) fail("WORKSPACE_UNAVAILABLE");
          const workspace = await response.json();
          const orders = workspace.orders || [];
          if (orders.some(o => o.tenant_id !== account.tenantId)) fail("TENANT_LEAK");
          if (account.visibleOrderIds && (orders.length !== account.visibleOrderIds.length || orders.some(o => !account.visibleOrderIds.includes(o.id)))) fail("ORDER_SCOPE_MISMATCH");
          draftOrders.clear();
          for (const order of orders) if (["quote", "open", "working", "ready"].includes(order.status)) draftOrders.add(order.id);
          return workspace;
        },
        async logout() {
          const response = await request("POST", "/api/logout", {});
          if (![200, 401].includes(response.status())) fail("LOGOUT_FAILED");
        },
      };
      sessions.set(account.id, session);
      const response = await request("POST", "/api/login", { email: account.email, password: account.password });
      if (response.status() !== 200) fail("LOGIN_FAILED");
      const initialResponse = await request("GET", "/api/session");
      if (initialResponse.status() !== 200) fail("SESSION_UNAVAILABLE");
      const initial = await initialResponse.json();
      if (!initial.tenants?.some(t => t.id === account.tenantId && t.name === account.workshopName)) fail("IDENTITY_MISMATCH");
      if (initial.tenant.id !== account.tenantId || initial.must_select_office) {
        const selected = await request("POST", "/api/tenant", { tenant_id: account.tenantId });
        if (selected.status() !== 200) fail("OFFICE_SELECTION_FAILED");
      }
      await session.identity();
    }
    return { sessions, close, origin: policy.origin };
  } catch (error) {
    await close();
    throw error instanceof SessionTestError ? error : new SessionTestError("BROWSER_OR_NETWORK_FAILED");
  }
}
