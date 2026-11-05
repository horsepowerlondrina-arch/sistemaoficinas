import { z } from "zod";
import { centsToProviderAmount, type PlanCode } from "../../shared/platformBilling.js";

const responseSchema = z.object({
  id: z.string().min(1),
  init_point: z.string().url(),
  status: z.string(),
}).passthrough();

export type MercadoPagoSubscriptionRequest = {
  id: string;
  plan: PlanCode;
  priceCents: number;
  payerEmail: string;
  returnUrl: string;
};

/** Only the server receives the access token. The browser receives the hosted checkout URL. */
export async function createMercadoPagoSubscription(
  input: MercadoPagoSubscriptionRequest,
  token: string,
  send: typeof fetch = fetch,
): Promise<{ providerId: string; checkoutUrl: string; status: string }> {
  if (!token || !/^https:\/\//.test(input.returnUrl)) throw new Error("Integração de pagamento indisponível.");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await send("https://api.mercadopago.com/preapproval", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-Idempotency-Key": input.id,
      },
      body: JSON.stringify({
        reason: `OSDrive ${input.plan}`,
        external_reference: input.id,
        payer_email: input.payerEmail,
        auto_recurring: {
          frequency: 1,
          frequency_type: "months",
          transaction_amount: centsToProviderAmount(input.priceCents),
          currency_id: "BRL",
        },
        back_url: input.returnUrl,
        status: "pending",
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const raw = await response.text().catch(() => "");
      let parsedError: unknown;
      try { parsedError = JSON.parse(raw); } catch { parsedError = null; }
      const details = parsedError && typeof parsedError === "object" && !Array.isArray(parsedError)
        ? parsedError as Record<string, unknown> : {};
      const keys = Object.keys(details).filter((key) => /^[a-zA-Z0-9_]{1,60}$/.test(key)).slice(0, 12);
      const codes = ["error", "code", "error_code", "status"].flatMap((key) => {
        const value = String(details[key] ?? "");
        return /^[a-zA-Z0-9_.-]{1,80}$/.test(value) ? [`${key}:${value}`] : [];
      });
      const causes = Array.isArray(details.cause) ? details.cause : [];
      const causeCodes = causes.flatMap((item) => {
        const value = item && typeof item === "object" ? String((item as { code?: unknown }).code ?? "") : "";
        return /^[a-zA-Z0-9_.-]{1,80}$/.test(value) ? [value] : [];
      }).slice(0, 5);
      const message = String(details.message ?? details.error_message ?? "").toLowerCase();
      const categories = [
        "payer", "email", "amount", "minimum", "value", "back_url", "frequency",
        "currency", "token", "subscription", "preapproval", "credential",
        "seller", "collector", "buyer", "user", "test", "sandbox", "production",
        "application", "access", "invalid", "required", "missing", "not", "allowed",
        "payment", "card", "reason", "transaction", "status", "date",
        "both", "real", "must", "valid", "exist", "same", "different", "site",
        "associated", "cannot", "operation", "disabled", "unauthorized", "forbidden",
        "create", "account", "credentials", "collector", "payer",
      ].filter((word) => new RegExp(`\\b${word}\\b`).test(message));
      console.warn("Mercado Pago preapproval rejected", {
        status: response.status,
        contentType: response.headers.get("content-type")?.split(";")[0],
        format: parsedError === null ? "non-json" : Array.isArray(parsedError) ? "array" : typeof parsedError,
        keys, codes, causeCodes, categories,
        credentialClass: token.startsWith("TEST-") ? "TEST" : token.startsWith("APP_USR-") ? "APP_USR" : "other",
        payerClass: /^test_user_[0-9]+@testuser\.com$/.test(input.payerEmail) ? "test-user" : "other",
      });
      throw new Error("O provedor não conseguiu iniciar a assinatura.");
    }
    const parsed = responseSchema.safeParse(await response.json());
    if (!parsed.success || !/^https:\/\/(www\.)?mercadopago\.com(\.br)?\//.test(parsed.data.init_point)) {
      console.warn("Mercado Pago preapproval returned an invalid checkout response");
      throw new Error("O provedor retornou uma resposta inválida.");
    }
    return { providerId: parsed.data.id, checkoutUrl: parsed.data.init_point, status: parsed.data.status };
  } finally {
    clearTimeout(timer);
  }
}
