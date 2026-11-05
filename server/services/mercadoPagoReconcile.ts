import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { fetchMercadoPagoInvoice, verifyProviderInvoice } from "./mercadoPagoInvoice.js";

type ProviderInvoiceHeader = { preapproval_id?: unknown };

/** Read the provider resource again for every notification; never trust the webhook body as payment proof. */
export async function reconcileMercadoPagoInvoice(
  pool: Pool,
  eventId: string,
  invoiceId: string,
  accessToken: string,
  send: typeof fetch = fetch,
): Promise<"processed" | "ignored"> {
  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(eventId)) throw new Error("Identificador de notificação inválido.");
  const payload = await fetchMercadoPagoInvoice(invoiceId, accessToken, send);
  const providerSubscriptionId = (payload as ProviderInvoiceHeader | null)?.preapproval_id;
  if (typeof providerSubscriptionId !== "string" || !providerSubscriptionId) {
    throw new Error("A fatura do provedor está incompleta.");
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const subscription = await client.query(`SELECT id,tenant_id,provider_subscription_id,monthly_price_cents
      FROM platform_admin.billing_subscriptions
      WHERE provider_subscription_id=$1 FOR UPDATE`, [providerSubscriptionId]);
    if (!subscription.rowCount) {
      await client.query(`INSERT INTO platform_admin.billing_webhook_events
        (provider_event_id,topic,resource_id,result,processed_at)
        VALUES($1,'subscription_authorized_payment',$2,'ignored',statement_timestamp())
        ON CONFLICT(provider_event_id) DO NOTHING`, [eventId,invoiceId]);
      await client.query("COMMIT");
      return "ignored";
    }
    const row = subscription.rows[0];
    const invoice = verifyProviderInvoice(payload, row.provider_subscription_id, row.monthly_price_cents);
    if (invoice.providerInvoiceId !== invoiceId) throw new Error("Identificador da fatura divergente.");
    const previous = await client.query(
      "SELECT result FROM platform_admin.billing_webhook_events WHERE provider_event_id=$1 FOR UPDATE",
      [eventId],
    );
    if (previous.rows[0]?.result === "processed") {
      await client.query("COMMIT");
      return "processed";
    }
    const saved = await client.query(`INSERT INTO platform_admin.billing_invoices
      (id,subscription_id,tenant_id,provider_invoice_id,provider_payment_id,
       period_start,period_end,due_on,amount_cents,status,paid_at)
      VALUES($1,$2,$3,$4,$5,$6::timestamptz,$6::timestamptz+interval '1 month',
        ($6::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date,$7,$8,
        CASE WHEN $8='approved' THEN statement_timestamp() ELSE NULL END)
      ON CONFLICT(provider_invoice_id) DO UPDATE SET
        provider_payment_id=EXCLUDED.provider_payment_id,
        status=EXCLUDED.status,
        paid_at=CASE WHEN EXCLUDED.status='approved'
          THEN COALESCE(platform_admin.billing_invoices.paid_at,statement_timestamp())
          ELSE NULL END,
        updated_at=statement_timestamp()
      WHERE platform_admin.billing_invoices.subscription_id=EXCLUDED.subscription_id
        AND platform_admin.billing_invoices.tenant_id=EXCLUDED.tenant_id
        AND platform_admin.billing_invoices.amount_cents=EXCLUDED.amount_cents`,
      [randomUUID(),row.id,row.tenant_id,invoice.providerInvoiceId,
        invoice.providerPaymentId,invoice.debitDate,invoice.amountCents,invoice.status]);
    if (saved.rowCount !== 1) throw new Error("A fatura conflita com uma cobrança registrada.");
    await client.query(`UPDATE platform_admin.billing_subscriptions s SET
      last_confirmed_paid_until=(
        SELECT max(i.period_end) FROM platform_admin.billing_invoices i
        WHERE i.subscription_id=s.id AND i.status='approved'
      ),
      current_period_end=(
        SELECT max(i.period_end) FROM platform_admin.billing_invoices i
        WHERE i.subscription_id=s.id
      ),
      updated_at=statement_timestamp()
      WHERE s.id=$1`, [row.id]);
    await client.query(`INSERT INTO platform_admin.billing_webhook_events
      (provider_event_id,topic,resource_id,result,processed_at)
      VALUES($1,'subscription_authorized_payment',$2,'processed',statement_timestamp())
      ON CONFLICT(provider_event_id) DO UPDATE SET result='processed',processed_at=statement_timestamp()`,
      [eventId,invoiceId]);
    await client.query("COMMIT");
    return "processed";
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
