import test from "node:test";
import assert from "node:assert/strict";
import { targetPolicy, permitsRequest, validateAccounts } from "../scripts/e2e/isolated-sessions.mjs";
const base = "https://sistema-oficinas-homologacao.vercel.app";
test("session automation rejects production, credentials in URLs and remote isolated targets", () => {
  for (const target of ["https://osdrive.com.br", base + "/api", base + "?token=x", "https://user:pass@sistema-oficinas-homologacao.vercel.app"]) assert.throws(() => targetPolicy(target, "homologation"));
  assert.throws(() => targetPolicy(base, "isolated"));
  assert.equal(targetPolicy("http://127.0.0.1:5173", "isolated").mode, "isolated");
});
test("session verification cannot mutate operational records or call outside services", () => {
  const policy = targetPolicy(base, "homologation");
  for (const [method, path] of [["POST", "/api/orders"], ["PUT", "/api/workshop-profile"], ["GET", "https://attacker.test/api/session"], ["GET", "/admin"], ["GET", "/api/workspace?tenant_id=other"], ["GET", "/api/documents/order/paid"]]) assert.equal(permitsRequest(policy, method, path), false);
  assert.equal(permitsRequest(policy, "POST", "/api/login"), true);
  assert.equal(permitsRequest(policy, "GET", "/api/workspace"), true);
});
test("accounts must explicitly be fictitious and cannot silently duplicate identities", () => {
  const a = { id: "master", fictitious: true, email: "a@testes.osdrive.com.br", password: "private", profile: "master", tenantId: "fixture-a", workshopName: "Oficina Fictícia A" };
  assert.throws(() => validateAccounts([a, { ...a, fictitious: false }]));
  assert.throws(() => validateAccounts([a, a]));
  assert.equal(validateAccounts([a, { ...a, id: "b", profile: "mechanic" }]).length, 2);
});
