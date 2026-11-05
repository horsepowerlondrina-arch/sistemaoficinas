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
      const body = await response.json().catch(() => null) as {
        error?: unknown; message?: unknown; cause?: Array<{ code?: unknown }>;
      } | null;
      const providerCode = typeof body?.error === "string" &&
        /^[a-zA-Z0-9_.-]{1,80}$/.test(body.error) ? body.error : undefined;
      const causeCodes = Array.isArray(body?.cause)
        ? body.cause.map((item) => String(item.code ?? ""))
          .filter((code) => /^[a-zA-Z0-9_.-]{1,80}$/.test(code)).slice(0, 5)
        : [];
      const message = typeof body?.message === "string" ? body.message.toLowerCase() : "";
      const field = ["payer", "email", "amount", "back_url", "frequency", "currency", "token"]
        .find((part) => message.includes(part));
      console.warn("Mercado Pago preapproval rejected", {
        status: response.status, providerCode, causeCodes, field,
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
