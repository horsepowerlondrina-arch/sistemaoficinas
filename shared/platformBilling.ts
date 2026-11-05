/** Billing decisions are expressed in whole cents and calendar dates in São Paulo. */
export type PlanCode = "basic" | "professional" | "premium";
export const planCodes: readonly PlanCode[] = ["basic", "professional", "premium"];

export function assertMonthlyPriceCents(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0 || value > 100_000_000) {
    throw new Error("Informe um preço mensal válido em centavos.");
  }
  return value as number;
}

export function providerAmountToCents(value: unknown): number {
  const raw = String(value);
  if (!/^(0|[1-9][0-9]{0,6})(\.[0-9]{1,2})?$/.test(raw)) {
    throw new Error("Valor monetário inválido recebido do provedor.");
  }
  const [whole, fraction = ""] = raw.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return assertMonthlyPriceCents(cents);
}

export function centsToProviderAmount(cents: number): number {
  return assertMonthlyPriceCents(cents) / 100;
}

export function billingAccessOnDate(
  dueDate: string | null,
  paidThroughDate: string | null,
  now: Date,
): "unchanged" | "active" | "read_only" {
  if (!dueDate) return "unchanged";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) throw new Error("Vencimento inválido.");
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
  if (paidThroughDate && paidThroughDate >= today) return "active";
  return today > dueDate ? "read_only" : "unchanged";
}
