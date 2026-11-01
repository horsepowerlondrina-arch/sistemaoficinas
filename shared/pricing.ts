export type PricingRule = {
  from?: number;
  up_to: number | null;
  markup_bps: number;
  minimum_profit: number;
};
export function normalizePricingRules(
  rules: PricingRule[],
): (PricingRule & { from: number })[] {
  if (!rules.length || rules.length > 20)
    throw new Error("Informe de 1 a 20 faixas.");
  let next = 0;
  return rules.map((rule, index) => {
    const from = rule.from ?? next;
    if (
      ![from, rule.markup_bps, rule.minimum_profit].every(
        Number.isSafeInteger,
      ) ||
      from < 0 ||
      from > 100000000 ||
      rule.markup_bps < 0 ||
      rule.markup_bps > 100000 ||
      rule.minimum_profit < 0 ||
      rule.minimum_profit > 100000000
    )
      throw new Error(`Faixa ${index + 1}: valores inválidos.`);
    if (from !== next)
      throw new Error(
        `Faixa ${index + 1}: ${from < next ? "sobreposição" : "lacuna"} entre faixas. O início deve ser ${next / 100}.`,
      );
    if (rule.up_to === null) {
      if (index !== rules.length - 1)
        throw new Error("Somente a última faixa pode ficar sem limite máximo.");
    } else if (
      !Number.isSafeInteger(rule.up_to) ||
      rule.up_to < from ||
      rule.up_to > 100000000
    )
      throw new Error(
        `Faixa ${index + 1}: o custo final deve ser maior ou igual ao inicial.`,
      );
    next = (rule.up_to ?? 100000000) + 1;
    return { ...rule, from };
  });
}
export interface PricingPolicy {
  mode: "legacy" | "markup" | "margin";
  rate_bps: number;
  service_markup_bps?: number;
  rules: PricingRule[];
  service_rules?: PricingRule[];
}
export function salePrice(cost: number, policy: PricingPolicy) {
  if (!Number.isSafeInteger(cost) || cost < 0)
    throw new Error("Informe um custo válido.");
  const rule =
    policy.mode === "legacy"
      ? normalizePricingRules(policy.rules).find(
          (r) => cost >= r.from && (r.up_to === null || cost <= r.up_to),
        )
      : undefined;
  if (policy.mode === "legacy" && !rule)
    throw new Error("O custo está fora das faixas cadastradas.");
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
    : thirdPartySalePrice(cost, policy);
}

export function thirdPartyMarkup(
  cost: number,
  policy: Pick<PricingPolicy, "service_rules" | "service_markup_bps">,
) {
  if (!Number.isSafeInteger(cost) || cost < 0)
    throw new Error("Informe um custo válido.");
  if (!policy.service_rules) return policy.service_markup_bps ?? 3000;
  const rule = normalizePricingRules(policy.service_rules).find(
    (r) => cost >= r.from && (r.up_to === null || cost <= r.up_to),
  );
  if (!rule)
    throw new Error("O custo está fora das faixas de serviços de terceiros.");
  return rule.markup_bps;
}
export function thirdPartySalePrice(
  cost: number,
  policy: number | Pick<PricingPolicy, "service_rules" | "service_markup_bps">,
) {
  const markup =
    typeof policy === "number" ? policy : thirdPartyMarkup(cost, policy);
  return validPrice(Math.round((cost * (10000 + markup)) / 10000));
}
