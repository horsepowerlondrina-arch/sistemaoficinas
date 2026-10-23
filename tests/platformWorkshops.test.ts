import test from "node:test";
import assert from "node:assert/strict";
import { tenantAccessDecision } from "../server/auth/tenantAccess.js";
import { canManuallyTransitionWorkshop, effectiveWorkshopStatus, workshopRegistrationSchema } from "../server/services/platformWorkshops.js";

test("central workshop registration validates fictitious optional tax identifiers", () => {
  const base = { name: "Oficina Exemplo", responsible_name: "Pessoa Fictícia", responsible_email: "responsavel@example.test" };
  assert.equal(workshopRegistrationSchema.safeParse(base).success, true);
  assert.equal(workshopRegistrationSchema.safeParse({ ...base, document: "529.982.247-25" }).success, true);
  assert.equal(workshopRegistrationSchema.safeParse({ ...base, document: "111.111.111-11" }).success, false);
  assert.equal(workshopRegistrationSchema.safeParse({ ...base, tenant_id: "tenant-browser" }).success, false);
});

test("manual workshop transitions cannot activate trials or legacy tenants", () => {
  assert.equal(canManuallyTransitionWorkshop("legacy", "blocked"), false);
  assert.equal(canManuallyTransitionWorkshop("pending_verification", "active"), false);
  assert.equal(canManuallyTransitionWorkshop("trial", "blocked"), true);
  assert.equal(canManuallyTransitionWorkshop("blocked", "read_only"), true);
  assert.equal(canManuallyTransitionWorkshop("archived", "blocked"), false);
});

test("expired trials become read-only and tenant gates preserve legacy access", () => {
  assert.equal(effectiveWorkshopStatus("trial", "2020-01-01T00:00:00Z", Date.parse("2020-01-02T00:00:00Z")), "read_only");
  assert.equal(tenantAccessDecision("legacy", "POST", "/orders"), "allow");
  assert.equal(tenantAccessDecision("pending_verification", "GET", "/orders"), "unavailable");
  assert.equal(tenantAccessDecision("blocked", "GET", "/orders"), "unavailable");
  assert.equal(tenantAccessDecision("archived", "GET", "/orders"), "unavailable");
  assert.equal(tenantAccessDecision("read_only", "GET", "/orders"), "allow");
  assert.equal(tenantAccessDecision("read_only", "POST", "/orders"), "read_only");
  assert.equal(tenantAccessDecision("read_only", "POST", "/logout"), "allow");
});
