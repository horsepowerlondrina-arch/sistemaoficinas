import type { Pool } from "pg";
import { z } from "zod";
import { providerAmountToCents } from "../../shared/platformBilling.js";

const schema = z.object({
  id: z.string().min(1),
  external_reference: z.union([z.string(), z.number()]).transform(String),
  status: z.enum(["pending", "authorized", "paused", "cancelled"]),
  payment_method_id: z.string().nullable().optional(),
  auto_recurring: z.object({
    currency_id: z.literal("BRL"),
    transaction_amount: z.union([z.string(), z.number()]),
  }),
}).passthrough();

/** A signed signal is never proof of subscription state: fetch it again from Mercado Pago. */
export async function reconcileMercadoPagoSubscription(
  pool: Pool,
  eventId: string,
  providerId: string,
  accessToken: string,
  send: typeof fetch = fetch,
): Promise<"processed" | "ignored"> {
  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(eventId)
    || !/^[a-zA-Z0-9_-]{1,160}$/.test(providerId)
    || !accessToken) throw new Error("Notificação de assinatura inválida.");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  let payload: unknown;
  try {
    const response = await send(`https://api.mercadopago.com/preapproval/${encodeURIComponent(providerId)}`, {
      headers: { Authorization: `Bearer ${accessToken}` }, signal: controller.signal,
    });
    if (!response.ok) throw new Error("O provedor não respondeu à consulta da assinatura.");
    payload = await response.json();
  } finally {
    clearTimeout(timer);
  }
  const parsed = schema.safeParse(payload);
  if (!parsed.success || parsed.data.id !== providerId) {
    throw new Error("A assinatura do provedor está incompleta.");
  }
  const remote = parsed.data;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(`SELECT id,tenant_id,monthly_price_cents
      FROM platform_admin.billing_subscriptions
      WHERE provider_subscription_id=$1 FOR UPDATE`, [providerId]);
    if (!result.rowCount) {
      await client.query(`INSERT INTO platform_admin.billing_webhook_events
        (provider_event_id,topic,resource_id,result,processed_at)
        VALUES($1,'subscription_preapproval',$2,'ignored',statement_timestamp())
        ON CONFLICT(provider_event_id) DO NOTHING`, [eventId,providerId]);
      await client.query("COMMIT");
      return "ignored";
    }
    const row = result.rows[0];
    if (remote.external_reference !== row.id
      || providerAmountToCents(remote.auto_recurring.transaction_amount) !== row.monthly_price_cents) {
      throw new Error("A assinatura não corresponde ao contrato registrado.");
    }
    const method = remote.payment_method_id?.toLowerCase();
    const paymentMode = method === "pix" ? "pix"
      : method && /^(visa|master|mastercard|amex|elo|hipercard|diners|cabal)$/.test(method) ? "card"
      : "unknown";
    await client.query(`UPDATE platform_admin.billing_subscriptions
      SET provider_status=$2,payment_mode=$3,updated_at=statement_timestamp()
      WHERE id=$1`, [row.id,remote.status,paymentMode]);
    await client.query(`INSERT INTO platform_admin.billing_webhook_events
      (provider_event_id,topic,resource_id,result,processed_at)
      VALUES($1,'subscription_preapproval',$2,'processed',statement_timestamp())
      ON CONFLICT(provider_event_id) DO UPDATE SET result='processed',processed_at=statement_timestamp()`, [eventId,providerId]);
    await client.query("COMMIT");
    return "processed";
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
