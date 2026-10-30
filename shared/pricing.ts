export interface PricingPolicy {
  mode: "legacy" | "markup" | "margin";
  rate_bps: number;
  service_markup_bps?: number;
  rules: { up_to: number | null; markup_bps: number; minimum_profit: number }[];
}
export function salePrice(cost: number, policy: PricingPolicy) {
  const rule = policy.rules.find((r) => r.up_to === null || cost <= r.up_to);
  const value =
    policy.mode === "margin"
      ? Math.round((cost * 10000) / (10000 - policy.rate_bps))
      : policy.mode === "markup"
        ? Math.round((cost * (10000 + policy.rate_bps)) / 10000)
        : rule
          ? Math.max(
              Math.round((cost * (10000 + rule.markup_bps)) / 10000),
              cost + rule.minimum_profit,
            )
          : NaN;
  return validPrice(value);
}
function validPrice(value: number) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 100000000)
    throw new Error(
      "O preço calculado ultrapassa o limite permitido. Revise custo e percentual.",
    );
  return value;
}
export function catalogSalePrice(
  kind: string,
  cost: number,
  freight: number,
  policy: PricingPolicy,
) {
  return kind === "product"
    ? salePrice(cost + freight, policy)
    : thirdPartySalePrice(cost, policy.service_markup_bps ?? 3000);
}

export function thirdPartySalePrice(cost: number, markupBps: number) {
  return validPrice(Math.round((cost * (10000 + markupBps)) / 10000));
}
