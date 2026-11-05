import assert from "node:assert/strict";
import { test } from "node:test";
import { assertMonthlyPriceCents, billingAccessOnDate, centsToProviderAmount, providerAmountToCents } from "../shared/platformBilling.js";

test("prices remain exact in cents and reject invalid amounts", () => {
  assert.equal(providerAmountToCents("120.35"), 12035);
  assert.equal(centsToProviderAmount(12035), 120.35);
  assert.throws(() => providerAmountToCents("120.351"));
  assert.throws(() => assertMonthlyPriceCents(0));
  assert.throws(() => assertMonthlyPriceCents(1.5));
});

test("unpaid office becomes read only on the day after due date in São Paulo", () => {
  const due = "2026-11-05";
  assert.equal(billingAccessOnDate(due, null, new Date("2026-11-06T02:59:59Z")), "unchanged");
  assert.equal(billingAccessOnDate(due, null, new Date("2026-11-06T03:00:00Z")), "read_only");
  assert.equal(billingAccessOnDate(due, "2026-11-06", new Date("2026-11-06T14:00:00Z")), "active");
  assert.equal(billingAccessOnDate(null, null, new Date("2026-11-06T14:00:00Z")), "unchanged");
});
