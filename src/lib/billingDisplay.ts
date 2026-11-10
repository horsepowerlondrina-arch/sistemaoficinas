import type { BillingSummary } from "../../shared/stripeBilling";

export type BillingAction =
  | { kind: "link"; label: string; url: string }
  | { kind: "choose"; label: string }
  | { kind: "success" }
  | { kind: "unavailable"; message: string };

function stripeUrl(value: string | null | undefined, hosts: readonly string[]): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && hosts.includes(url.hostname) ? url.href : null;
  } catch {
    return null;
  }
}

export function checkoutUrl(value: string): string | null {
  return stripeUrl(value, ["checkout.stripe.com"]);
}

export function workshopBillingAction(data: BillingSummary, trialActive: boolean, today: string): BillingAction {
  if (data.pending) {
    const url = checkoutUrl(data.pending.url);
    return url ? { kind: "link", label: "Continuar pagamento", url } :
      { kind: "unavailable", message: "O endereço do pagamento pendente está indisponível. Solicite ajuda à administração." };
  }
  const invoiceUrl = stripeUrl(data.account?.invoice_payment_url, ["invoice.stripe.com", "pay.stripe.com"]);
  if (invoiceUrl) return { kind: "link", label: "Regularizar pagamento", url: invoiceUrl };
  if (data.account?.recurring && data.read_only) return {
    kind: "unavailable", message: "Não há um link de regularização disponível. Solicite ajuda à administração."
  };
  if (data.account?.recurring || (data.account?.paid_until && data.account.paid_until > today)) return { kind: "success" };
  if (trialActive) return { kind: "unavailable", message: "Seu teste gratuito está ativo. A contratação ficará disponível ao final do teste." };
  if (!data.prices.length) return { kind: "unavailable", message: "Os valores ainda serão configurados pela administração." };
  return { kind: "choose", label: !data.account ? "Assinar plano" : data.read_only ? "Regularizar pagamento" : "Pagar próxima mensalidade" };
}
