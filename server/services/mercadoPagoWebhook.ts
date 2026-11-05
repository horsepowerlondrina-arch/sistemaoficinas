import { createHmac, timingSafeEqual } from "node:crypto";

/** Validate Mercado Pago's signed change signal before looking up its resource. */
export function verifyMercadoPagoWebhook(
  signature: string | undefined,
  requestId: string | undefined,
  dataId: string | undefined,
  secret: string | undefined,
  now = Date.now(),
): boolean {
  if (!signature || !requestId || !dataId || !secret || dataId.length > 160 || requestId.length > 160) return false;
  const parts = Object.fromEntries(signature.split(",").map(part => part.trim().split("=", 2)));
  if (!/^\d{10,13}$/.test(parts.ts || "") || !/^[a-f0-9]{64}$/i.test(parts.v1 || "")) return false;
  const timestamp = Number(parts.ts) * (parts.ts.length === 10 ? 1000 : 1);
  if (!Number.isSafeInteger(timestamp) || Math.abs(now - timestamp) > 300_000) return false;
  const manifest = `id:${dataId.toLowerCase()};request-id:${requestId};ts:${parts.ts};`;
  const expected = createHmac("sha256", secret).update(manifest).digest();
  const received = Buffer.from(parts.v1, "hex");
  return received.length === expected.length && timingSafeEqual(received, expected);
}
