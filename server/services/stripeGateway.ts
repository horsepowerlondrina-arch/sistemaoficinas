import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export const stripeApiVersion = "2025-06-30.basil";
export class StripeUnavailable extends Error {
  constructor() { super("Não foi possível consultar o pagamento. Tente novamente."); }
}
export function stripeTestKey(value: string | undefined) {
  if (!value || !/^(sk|rk)_test_[A-Za-z0-9]+$/.test(value))
    throw new Error("Configure uma chave Stripe de teste. Cobranças reais estão desabilitadas.");
  return value;
}
export function verifiedStripeEvent(raw: Buffer, signature: string, secret: string, now = Date.now()) {
  if (!secret || !secret.startsWith("whsec_") || raw.length > 262144)
    throw new Error("Notificação inválida.");
  const parts = signature.split(",").map(part => part.split("="));
  const timestamps = parts.filter(([key]) => key === "t");
  if (timestamps.length !== 1 || !/^\d+$/.test(timestamps[0][1] || ""))
    throw new Error("Notificação inválida.");
  const timestamp = Number(timestamps[0][1]);
  if (!Number.isSafeInteger(timestamp) || Math.abs(now / 1000 - timestamp) > 300)
    throw new Error("Notificação expirada.");
  const expected = createHmac("sha256", secret).update(String(timestamp) + ".").update(raw).digest();
  if (!parts.some(([key, value]) => key === "v1" && /^[a-f0-9]{64}$/.test(value || "") &&
      timingSafeEqual(expected, Buffer.from(value, "hex")))) throw new Error("Assinatura inválida.");
  const event = z.object({
    id: z.string().regex(/^evt_[A-Za-z0-9]+$/),
    type: z.string().max(150),
    livemode: z.literal(false),
    data: z.object({ object: z.object({ id: z.string().min(1).max(150) }).passthrough() }),
  }).parse(JSON.parse(raw.toString("utf8")));
  return event;
}
export function stripeForm(input: Record<string, unknown>) {
  const body = new URLSearchParams();
  function append(key: string, value: unknown) {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) { value.forEach((item,index) => append(key + "[" + index + "]",item)); return; }
    if (typeof value === "object") {
      Object.entries(value).forEach(([child,item]) => append(key + "[" + child + "]",item)); return;
    }
    body.append(key,String(value));
  }
  Object.entries(input).forEach(([key,value]) => append(key,value));
  return body;
}
export function createStripeGateway(key: string, send: typeof fetch = fetch) {
  stripeTestKey(key);
  return async function request(path: string, input?: Record<string, unknown>, idempotencyKey?: string): Promise<unknown> {
    if (!/^\/(charges|disputes|customers|prices|products|checkout\/sessions|subscriptions|invoices|payment_intents|billing_portal\/sessions)(\/[A-Za-z0-9_]+)?(\?[A-Za-z0-9_%=&.\[\]-]+)?$/.test(path))
      throw new Error("Recurso de pagamento inválido.");
    if (input && (!idempotencyKey || !/^[A-Za-z0-9:_-]{1,200}$/.test(idempotencyKey)))
      throw new Error("Identificador da operação inválido.");
    try {
      const response = await send("https://api.stripe.com/v1" + path, {
        method: input ? "POST" : "GET", redirect: "error",
        headers: { Authorization: "Bearer " + key, "Stripe-Version": stripeApiVersion,
          ...(input ? { "Content-Type":"application/x-www-form-urlencoded", "Idempotency-Key":idempotencyKey! } : {}) },
        body: input ? stripeForm(input) : undefined,
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new StripeUnavailable();
      const result: unknown = await response.json();
      if (typeof result !== "object" || result === null ||
          ("livemode" in result && result.livemode !== false)) throw new StripeUnavailable();
      return result;
    } catch { throw new StripeUnavailable(); }
  };
}
