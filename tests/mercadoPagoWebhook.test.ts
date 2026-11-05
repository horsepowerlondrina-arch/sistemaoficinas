import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import { verifyMercadoPagoWebhook } from "../server/services/mercadoPagoWebhook.js";

test("accepts only authentic recent Mercado Pago webhooks", () => {
  const now = Date.parse("2026-11-05T12:00:00Z");
  const ts = String(Math.floor(now / 1000));
  const dataId = "ABCD1234";
  const requestId = "fictional-request";
  const secret = "fictional-webhook-secret";
  const hash = createHmac("sha256", secret)
    .update(`id:abcd1234;request-id:${requestId};ts:${ts};`).digest("hex");
  const signature = `ts=${ts},v1=${hash}`;
  assert.equal(verifyMercadoPagoWebhook(signature, requestId, dataId, secret, now), true);
  assert.equal(verifyMercadoPagoWebhook(signature, requestId, "OTHER", secret, now), false);
  assert.equal(verifyMercadoPagoWebhook(signature, requestId, dataId, "wrong", now), false);
  assert.equal(verifyMercadoPagoWebhook(signature, requestId, dataId, secret, now + 301_000), false);
  assert.equal(verifyMercadoPagoWebhook("ts=bad,v1="+hash, requestId, dataId, secret, now), false);
  assert.equal(verifyMercadoPagoWebhook(undefined, requestId, dataId, secret, now), false);
});
