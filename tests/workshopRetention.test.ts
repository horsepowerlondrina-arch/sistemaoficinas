import test from "node:test";
import assert from "node:assert/strict";
import { daysAfterCoverage, retentionCoverageEnd, retentionDecision } from "../shared/workshopRetention.js";

test("retention counts São Paulo calendar days, not elapsed 24-hour blocks", () => {
  assert.equal(daysAfterCoverage("2026-11-15", new Date("2026-11-16T02:59:59Z")), 0);
  assert.equal(daysAfterCoverage("2026-11-15", new Date("2026-11-16T03:00:00Z")), 1);
  assert.equal(retentionDecision("2026-11-15", new Date("2026-11-15T15:00:00Z")), "covered");
});

test("notices and deletion are reached on exact calendar days", () => {
  const atDay = (day: number) => new Date(Date.UTC(2026, 0, 31 + day, 12));
  assert.equal(retentionDecision("2026-01-31", atDay(29)), "read_only");
  assert.equal(retentionDecision("2026-01-31", atDay(30)), "notice_30");
  assert.equal(retentionDecision("2026-01-31", atDay(60)), "notice_60");
  assert.equal(retentionDecision("2026-01-31", atDay(89)), "notice_89");
  assert.equal(retentionDecision("2026-01-31", atDay(90)), "deletion_due");
});

test("invalid coverage dates cannot schedule deletion", () => {
  for (const bad of ["2026-02-30", "2026-13-01", "2026-01-00", "", "2026-01-01T00:00:00Z"])
    assert.throws(() => retentionDecision(bad, new Date("2026-05-01")));
});

test("prazo usa pagamento confirmado, preserva teste vigente e respeita acesso administrativo", () => {
  const base = { status: "active", emailVerified: true, managedBilling: true, paidUntil: "2026-04-30", dueOn: "2026-04-01", trialEndsOn: "2026-03-01" };
  assert.equal(retentionCoverageEnd(base), "2026-04-30");
  assert.equal(retentionCoverageEnd({ ...base, paidUntil: null, trialEndsOn: "2026-04-15" }), "2026-04-15");
  assert.equal(retentionCoverageEnd({ ...base, status: "blocked" }), null);
  assert.equal(retentionCoverageEnd({ ...base, emailVerified: false }), null);
  assert.equal(retentionCoverageEnd({ ...base, managedBilling: false }), null);
  assert.equal(retentionCoverageEnd({ ...base, managedBilling: false, status: "trial", paidUntil: null }), "2026-03-01");
});
