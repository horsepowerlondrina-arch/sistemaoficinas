import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { assertMonthlyPriceCents, type PlanCode } from "../../shared/platformBilling.js";
import { createMercadoPagoSubscription } from "./mercadoPagoBilling.js";

export type BillingOffer = {
  plan: PlanCode;
  monthlyPriceCents: number;
  currency: "BRL";
  status: string;
};

export function createWorkshopBilling(pool: Pool, options: {
  accessToken: string;
  returnOrigin: string;
  send?: typeof fetch;
}) {
  const configured = () => {
    if (!options.accessToken || !/^https:\/\//.test(options.returnOrigin)) {
      throw new Error("Cobranças ainda não estão configuradas neste ambiente.");
    }
  };
  const offer = async (tenantId: string): Promise<BillingOffer | null> => {
    const result = await pool.query(`SELECT w.plan_code,w.status,p.monthly_price_cents
      FROM platform_admin.workshops w
      JOIN platform_admin.plan_prices p ON p.plan_code=w.plan_code
      WHERE w.tenant_id=$1`, [tenantId]);
    const row = result.rows[0];
    if (!row || !["active","trial","read_only"].includes(row.status)
        || !row.monthly_price_cents) return null;
    return {
      plan: row.plan_code as PlanCode,
      monthlyPriceCents: assertMonthlyPriceCents(row.monthly_price_cents),
      currency: "BRL",
      status: row.status,
    };
  };
  const startCheckout = async (input: {
    tenantId: string;
    payerEmail: string;
    expectedPriceCents: number;
  }): Promise<string> => {
    configured();
    const client = await pool.connect();
    let subscriptionId: string;
    let plan: PlanCode;
    let priceCents: number;
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,71431))", [input.tenantId]);
      const found = await client.query(`SELECT w.plan_code,w.status,p.monthly_price_cents,p.price_version
        FROM platform_admin.workshops w
        JOIN platform_admin.plan_prices p ON p.plan_code=w.plan_code
        WHERE w.tenant_id=$1 FOR UPDATE OF w`, [input.tenantId]);
      const row = found.rows[0];
      if (!row || !["active","trial","read_only"].includes(row.status)
          || !row.monthly_price_cents || row.price_version < 1) {
        throw new Error("Plano ou preço indisponível para esta oficina.");
      }
      priceCents = assertMonthlyPriceCents(row.monthly_price_cents);
      if (priceCents !== input.expectedPriceCents) {
        throw new Error("O preço mudou. Atualize a tela antes de confirmar.");
      }
      plan = row.plan_code as PlanCode;
      const existing = await client.query(`SELECT id,plan_code,monthly_price_cents,
        provider_subscription_id,checkout_url,provider_status
        FROM platform_admin.billing_subscriptions WHERE tenant_id=$1 FOR UPDATE`, [input.tenantId]);
      if (existing.rowCount) {
        const prior = existing.rows[0];
        if (prior.plan_code !== plan || prior.monthly_price_cents !== priceCents) {
          throw new Error("A oficina já possui uma assinatura com outras condições.");
        }
        if (prior.provider_status !== "creating" && !prior.checkout_url) {
          throw new Error("A assinatura existente precisa de revisão administrativa.");
        }
        if (prior.checkout_url) {
          await client.query("COMMIT");
          return prior.checkout_url;
        }
        subscriptionId = prior.id;
      } else {
        subscriptionId = randomUUID();
        await client.query(`INSERT INTO platform_admin.billing_subscriptions
          (id,tenant_id,plan_code,price_version,monthly_price_cents,provider_status,payment_mode)
          VALUES($1,$2,$3,$4,$5,'creating','unknown')`,
          [subscriptionId,input.tenantId,plan,row.price_version,priceCents]);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
    // The committed reservation and provider idempotency key survive a retry or process restart.
    const created = await createMercadoPagoSubscription({
      id: subscriptionId!, plan: plan!, priceCents: priceCents!,
      payerEmail: input.payerEmail,
      returnUrl: new URL("/configuracoes?aba=conta", options.returnOrigin).toString(),
    }, options.accessToken, options.send);
    const updated = await pool.query(`UPDATE platform_admin.billing_subscriptions
      SET provider_subscription_id=$2,provider_status=$3,checkout_url=$4,updated_at=statement_timestamp()
      WHERE id=$1 AND tenant_id=$5 AND provider_subscription_id IS NULL
      RETURNING checkout_url`, [subscriptionId!,created.providerId,created.status,created.checkoutUrl,input.tenantId]);
    if (updated.rows[0]?.checkout_url) return updated.rows[0].checkout_url;
    const previous = await pool.query(`SELECT checkout_url FROM platform_admin.billing_subscriptions
      WHERE id=$1 AND tenant_id=$2`, [subscriptionId!,input.tenantId]);
    if (previous.rows[0]?.checkout_url) return previous.rows[0].checkout_url;
    throw new Error("Não foi possível registrar o link de pagamento.");
  };
  return { offer, startCheckout };
}

export type WorkshopBilling = ReturnType<typeof createWorkshopBilling>;
