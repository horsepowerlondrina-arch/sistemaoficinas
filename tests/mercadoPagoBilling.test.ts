import assert from "node:assert/strict";
import { test } from "node:test";
import { createMercadoPagoSubscription } from "../server/services/mercadoPagoBilling.js";

test("creates a monthly hosted checkout without exposing provider token", async () => {
  let body: Record<string, unknown> = {};
  const send: typeof fetch = async (_url, options) => {
    body = JSON.parse(String(options?.body));
    assert.equal(options?.headers && (options.headers as Record<string,string>)["X-Idempotency-Key"], "test-subscription-1");
    return new Response(JSON.stringify({
      id: "provider-test-1", init_point: "https://www.mercadopago.com.br/subscriptions/checkout/test", status: "pending",
    }), { status: 201, headers: { "Content-Type": "application/json" } });
  };
  const result = await createMercadoPagoSubscription({
    id: "test-subscription-1", plan: "professional", priceCents: 12035,
    payerEmail: "fictional@example.test", returnUrl: "https://example.test/assinatura",
  }, "fictional-test-token", send);
  assert.equal(result.status, "pending");
  assert.deepEqual(body.auto_recurring, { frequency: 1, frequency_type: "months", transaction_amount: 120.35, currency_id: "BRL" });
  assert.equal(JSON.stringify(body).includes("fictional-test-token"), false);
});

test("rejects provider checkout URL outside Mercado Pago", async () => {
  const send: typeof fetch = async () => new Response(JSON.stringify({
    id: "provider-test-2", init_point: "https://example.test/steal", status: "pending",
  }), { status: 201 });
  await assert.rejects(createMercadoPagoSubscription({
    id: "test-subscription-2", plan: "basic", priceCents: 1000,
    payerEmail: "fictional@example.test", returnUrl: "https://example.test/assinatura",
  }, "fictional-test-token", send), /resposta inválida/);
});
