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
  testTenantId?: string;
  testPriceCents?: number;
  testPayerEmail?: string;
}) {
  if (options.testPayerEmail !== undefined) {
    if (!options.testTenantId || !/^test_user_[0-9]+@testuser\.com$/.test(options.testPayerEmail)) {
      throw new Error("Comprador de teste inválido.");
    }
  }
  if (options.testPriceCents !== undefined) {
    if (!options.testTenantId) throw new Error("Preço de teste exige oficina de teste.");
    assertMonthlyPriceCents(options.testPriceCents);
  }
  const testPrice = (tenantId: string) =>
    options.testTenantId === tenantId ? options.testPriceCents ?? null : null;
  const configured = () => {
    if (!options.accessToken || !/^https:\/\//.test(options.returnOrigin)) {
      throw new Error("Cobranças ainda não estão configuradas neste ambiente.");
    }
  };
  const offer = async (tenantId: string): Promise<BillingOffer | null> => {
    if (options.testTenantId && tenantId !== options.testTenantId) return null;
    const result = await pool.query(`SELECT w.plan_code,w.status,
        COALESCE(s.monthly_price_cents,$2::integer,p.monthly_price_cents) AS monthly_price_cents,
        s.plan_code AS subscribed_plan,s.provider_status
      FROM platform_admin.workshops w
      JOIN platform_admin.plan_prices p ON p.plan_code=w.plan_code
      LEFT JOIN platform_admin.billing_subscriptions s ON s.tenant_id=w.tenant_id
      WHERE w.tenant_id=$1`, [tenantId,testPrice(tenantId)]);
    const row = result.rows[0];
    if (!row || !["active","read_only"].includes(row.status)
        || !row.monthly_price_cents
        || (row.subscribed_plan && row.subscribed_plan !== row.plan_code)
        || row.provider_status === "authorized") return null;
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
    if (options.testTenantId && input.tenantId !== options.testTenantId) {
      throw new Error("Cobranças indisponíveis para esta oficina de teste.");
    }
    const client = await pool.connect();
    let subscriptionId: string;
    let plan: PlanCode;
    let priceCents: number;
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,71431))", [input.tenantId]);
      const found = await client.query(`SELECT w.plan_code,w.status,
        COALESCE($2::integer,p.monthly_price_cents) AS monthly_price_cents,
        CASE WHEN $2::integer IS NOT NULL THEN 1 ELSE p.price_version END AS price_version
        FROM platform_admin.workshops w
        JOIN platform_admin.plan_prices p ON p.plan_code=w.plan_code
        WHERE w.tenant_id=$1`, [input.tenantId,testPrice(input.tenantId)]);
      const row = found.rows[0];
      if (!row || !["active","read_only"].includes(row.status)
          || !row.monthly_price_cents || row.price_version < 1) {
        throw new Error("Plano ou preço indisponível para esta oficina.");
      }
      plan = row.plan_code as PlanCode;
      const existing = await client.query(`SELECT id,plan_code,monthly_price_cents,
        provider_subscription_id,checkout_url,provider_status
        FROM platform_admin.billing_subscriptions WHERE tenant_id=$1 FOR UPDATE`, [input.tenantId]);
      if (existing.rowCount) {
        const prior = existing.rows[0];
        if (prior.plan_code !== plan) {
          throw new Error("A oficina já possui uma assinatura com outras condições.");
        }
        priceCents = assertMonthlyPriceCents(prior.monthly_price_cents);
        if (priceCents !== input.expectedPriceCents) {
          throw new Error("O preço mudou. Atualize a tela antes de confirmar.");
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
        priceCents = assertMonthlyPriceCents(row.monthly_price_cents);
        if (priceCents !== input.expectedPriceCents) {
          throw new Error("O preço mudou. Atualize a tela antes de confirmar.");
        }
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
      payerEmail: options.testTenantId === input.tenantId && options.testPayerEmail
        ? options.testPayerEmail : input.payerEmail,
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
