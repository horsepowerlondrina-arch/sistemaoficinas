import { z } from "zod";
import { providerAmountToCents } from "../../shared/platformBilling.js";

const invoiceSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  preapproval_id: z.string().min(1),
  currency_id: z.literal("BRL"),
  transaction_amount: z.union([z.string(), z.number()]),
  debit_date: z.string().datetime({ offset: true }),
  payment: z.object({
    id: z.union([z.string(), z.number()]).transform(String).nullable().optional(),
    status: z.string(),
  }).nullable().optional(),
}).passthrough();

export type VerifiedProviderInvoice = {
  providerInvoiceId: string;
  providerSubscriptionId: string;
  providerPaymentId: string | null;
  debitDate: string;
  amountCents: number;
  status: "approved" | "pending" | "rejected" | "refunded";
};

/**
 * A notification is only a signal. Fetch the invoice with the server token,
 * then compare its subscription and amount with the immutable local snapshot.
 */
export function verifyProviderInvoice(
  payload: unknown,
  expectedSubscriptionId: string,
  expectedAmountCents: number,
): VerifiedProviderInvoice {
  const result = invoiceSchema.safeParse(payload);
  if (!result.success) throw new Error("A fatura do provedor está incompleta.");
  const invoice = result.data;
  const amountCents = providerAmountToCents(invoice.transaction_amount);
  if (invoice.preapproval_id !== expectedSubscriptionId || amountCents !== expectedAmountCents) {
    throw new Error("A fatura não corresponde à assinatura contratada.");
  }
  const paymentStatus = invoice.payment?.status;
  const status = paymentStatus === "approved" ? "approved"
    : paymentStatus === "refunded" || paymentStatus === "charged_back" ? "refunded"
    : paymentStatus === "rejected" || paymentStatus === "cancelled" ? "rejected"
    : "pending";
  return {
    providerInvoiceId: invoice.id,
    providerSubscriptionId: invoice.preapproval_id,
    providerPaymentId: invoice.payment?.id ?? null,
    debitDate: invoice.debit_date,
    amountCents,
    status,
  };
}

export async function fetchMercadoPagoInvoice(
  invoiceId: string,
  accessToken: string,
  send: typeof fetch = fetch,
): Promise<unknown> {
  if (!/^[0-9]{1,30}$/.test(invoiceId) || !accessToken) {
    throw new Error("A fatura não pôde ser consultada.");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await send(
      `https://api.mercadopago.com/authorized_payments/${invoiceId}`,
      { headers: { Authorization: `Bearer ${accessToken}` }, signal: controller.signal },
    );
    if (!response.ok) throw new Error("O provedor não respondeu à consulta da fatura.");
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}
