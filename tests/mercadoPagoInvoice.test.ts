import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchMercadoPagoInvoice, verifyProviderInvoice } from "../server/services/mercadoPagoInvoice.js";

const sample = {
  id: 101,
  preapproval_id: "subscription-1",
  currency_id: "BRL",
  transaction_amount: "120.35",
  debit_date: "2026-11-05T11:12:25.892-03:00",
  payment: { id: 456, status: "approved" },
};

test("only a matching invoice can confirm a contracted payment", () => {
  assert.deepEqual(verifyProviderInvoice(sample, "subscription-1", 12035), {
    providerInvoiceId: "101",
    providerSubscriptionId: "subscription-1",
    providerPaymentId: "456",
    debitDate: sample.debit_date,
    amountCents: 12035,
    status: "approved",
  });
  assert.throws(() => verifyProviderInvoice(sample, "another-subscription", 12035));
  assert.throws(() => verifyProviderInvoice(sample, "subscription-1", 12036));
  assert.throws(() => verifyProviderInvoice({ ...sample, currency_id: "USD" }, "subscription-1", 12035));
  assert.equal(verifyProviderInvoice({ ...sample, payment: null }, "subscription-1", 12035).status, "pending");
  assert.equal(verifyProviderInvoice({ ...sample, payment: { status: "rejected" } }, "subscription-1", 12035).status, "rejected");
});

test("invoice retrieval uses only a fixed provider host and numeric identifier", async () => {
  let called = 0;
  const send = (async (url: string | URL | Request, init?: RequestInit) => {
    called++;
    assert.equal(String(url), "https://api.mercadopago.com/authorized_payments/101");
    assert.equal(init?.headers && (init.headers as Record<string,string>).Authorization, "Bearer test-token");
    return { ok: true, json: async () => sample } as Response;
  }) as typeof fetch;
  assert.deepEqual(await fetchMercadoPagoInvoice("101", "test-token", send), sample);
  await assert.rejects(fetchMercadoPagoInvoice("https://evil.test", "test-token", send));
  assert.equal(called, 1);
});
