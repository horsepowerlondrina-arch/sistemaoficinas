import { z } from "zod";
import { salePrice, normalizePricingRules } from "../../shared/pricing.js";
import { transaction, type DB } from "../db/database.js";
import type { Context } from "../auth/session.js";
import { requireAdmin } from "./payments.js";
import { audit } from "./workshop.js";
export const defaultRules = [
  { up_to: 2000, markup_bps: 8000, minimum_profit: 800 },
  { up_to: 5000, markup_bps: 6000, minimum_profit: 1000 },
  { up_to: 10000, markup_bps: 5000, minimum_profit: 2000 },
  { up_to: 25000, markup_bps: 4500, minimum_profit: 0 },
  { up_to: 50000, markup_bps: 4000, minimum_profit: 0 },
  { up_to: 100000, markup_bps: 3500, minimum_profit: 0 },
  { up_to: null, markup_bps: 3000, minimum_profit: 0 },
];
const rulesSchema = z
  .array(
    z.object({
      from: z.number().int().min(0).max(100000000).optional(),
      up_to: z.number().int().min(0).max(100000000).nullable(),
      markup_bps: z.number().int().min(0).max(100000),
      minimum_profit: z.number().int().min(0).max(100000000),
    }),
  )
  .min(1)
  .max(20)
  .superRefine((rules, ctx) => {
    try {
      normalizePricingRules(rules);
    } catch (e) {
      ctx.addIssue({ code: "custom", message: (e as Error).message });
    }
  });
export const partsPricingSchema = z
  .object({
    mode: z.enum(["legacy", "markup", "margin"]).default("legacy"),
    rate_bps: z.number().int().min(0).max(100000).default(4000),
    rules: rulesSchema.default(defaultRules),
    service_markup_bps: z.number().int().min(0).max(100000).optional(),
    service_rules: rulesSchema
      .refine(
        (r) => r.every((v) => v.minimum_profit === 0),
        "Terceiros usam somente o percentual sobre o custo.",
      )
      .optional(),
  })
  .refine(
    (v) => v.mode !== "margin" || v.rate_bps < 10000,
    "A margem sobre a venda deve ser menor que 100%.",
  );
export function legacyPrice(cost: number, rules = defaultRules) {
  const rule = rules.find((r) => r.up_to === null || cost <= r.up_to)!;
  return Math.max(
    Math.round((cost * (10000 + rule.markup_bps)) / 10000),
    cost + rule.minimum_profit,
  );
}
export function priceFromCost(
  cost: number,
  mode: string,
  rate: number,
  rules = defaultRules,
) {
  return salePrice(cost, {
    mode: mode as "legacy" | "markup" | "margin",
    rate_bps: rate,
    rules,
  });
}
export async function getPartsPricing(db: DB, tenant: string) {
  const r = await db
    .prepare(
      "SELECT parts_pricing_mode mode,parts_pricing_bps rate_bps,parts_pricing_rules FROM tenants WHERE id=?",
    )
    .get(tenant);
  // Existing installations store a plain array; newer policies also store service markup.
  const stored = r?.parts_pricing_rules
    ? JSON.parse(r.parts_pricing_rules)
    : defaultRules;
  return partsPricingSchema.parse({
    ...r,
    rules: Array.isArray(stored) ? stored : stored.rules,
    service_rules: Array.isArray(stored) ? undefined : stored.service_rules,
    service_markup_bps: Array.isArray(stored)
      ? 3000
      : (stored.service_markup_bps ?? 3000),
  });
}
export async function savePartsPricing(db: DB, ctx: Context, body: unknown) {
  requireAdmin(ctx);
  if (ctx.modules?.settings === false)
    throw Object.assign(new Error("Módulo não habilitado."), { status: 403 });
  const patch = z
    .object({
      mode: z.unknown().optional(),
      rate_bps: z.unknown().optional(),
      rules: z.unknown().optional(),
      service_markup_bps: z.unknown().optional(),
      service_rules: z.unknown().optional(),
    })
    .parse(body);
  return transaction(db, async () => {
    const current = await getPartsPricing(db, ctx.tenantId);
    const policy = partsPricingSchema.parse({ ...current, ...patch });
    await db
      .prepare(
        "UPDATE tenants SET parts_pricing_mode=?,parts_pricing_bps=?,parts_pricing_rules=? WHERE id=?",
      )
      .run(
        policy.mode,
        policy.rate_bps,
        JSON.stringify({
          rules: policy.rules,
          service_markup_bps: policy.service_markup_bps,
          service_rules: policy.service_rules,
        }),
        ctx.tenantId,
      );
    await audit(db, ctx, "parts_pricing.updated", ctx.tenantId);
  });
}
export async function workshopPrice(db: DB, tenant: string, cost: number) {
  const s = await getPartsPricing(db, tenant);
  return priceFromCost(cost, s.mode, s.rate_bps, s.rules);
}
