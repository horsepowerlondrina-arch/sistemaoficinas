import assert from "node:assert/strict";
import test from "node:test";
import { workshopBillingAction } from "../src/lib/billingDisplay.js";
import type { BillingSummary } from "../shared/stripeBilling.js";

const base: BillingSummary = { enabled: true, prices: [{ id: "price", plan_code: "basic", amount_cents: 500 }], pending: null, account: null, payments: [], read_only: false };
const account: NonNullable<BillingSummary["account"]> = {
  plan_code: "basic", method: "pix", managed: true, due_on: "2026-12-06", paid_until: "2026-12-06",
  recurring: false, cancel_at_period_end: false, subscription_status: null, invoice_payment_url: null,
};
const today = "2026-11-09";

test("billing action follows the actual checkout and payment states", () => {
  assert.deepEqual(workshopBillingAction(base, false, today), { kind: "choose", label: "Assinar plano" });
  assert.deepEqual(workshopBillingAction({ ...base, account }, false, today), { kind: "success" });
  assert.deepEqual(workshopBillingAction({ ...base, account: { ...account, paid_until: today, due_on: today } }, false, today),
    { kind: "choose", label: "Pagar próxima mensalidade" });
  assert.deepEqual(workshopBillingAction({ ...base, account: { ...account, paid_until: "2026-11-08" }, read_only: true }, false, today),
    { kind: "choose", label: "Regularizar pagamento" });
  assert.deepEqual(workshopBillingAction({ ...base, account: { ...account, method: "card", recurring: true } }, false, today), { kind: "success" });
  assert.equal(workshopBillingAction(base, true, today).kind, "unavailable");
});

test("pending and invoice links take priority and reject other destinations", () => {
  const pending = { ...base, pending: { url: "https://checkout.stripe.com/c/test", method: "pix" } };
  assert.deepEqual(workshopBillingAction(pending, false, today),
    { kind: "link", label: "Continuar pagamento", url: "https://checkout.stripe.com/c/test" });
  assert.equal(workshopBillingAction({ ...pending, pending: { ...pending.pending, url: "https://example.com/fake" } }, false, today).kind, "unavailable");
  assert.deepEqual(workshopBillingAction({ ...base, account: { ...account, method: "card", recurring: true, invoice_payment_url: "https://invoice.stripe.com/i/test" } }, false, today),
    { kind: "link", label: "Regularizar pagamento", url: "https://invoice.stripe.com/i/test" });
});
