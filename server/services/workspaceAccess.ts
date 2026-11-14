import type { DB } from "../db/database";
import type { Context } from "../auth/session";
import { redactResponse } from "../auth/userAuthorization";
export async function projectWorkspace(
  db: DB,
  ctx: Context,
  workspace: Record<string, any>,
) {
  if (!ctx.access) return workspace;
  const p = ctx.access.permissions;
  const result = { ...workspace };
  let orders = p["orders.view"] ? [...(workspace.orders || [])] : [];
  if (ctx.access.profile === "mechanic" && !p["orders.edit"])
    orders = orders.filter((o: any) => o.status !== "quote");
  if (ctx.access.orderScope === "assigned") {
    const assignments = await db
      .prepare(
        "SELECT a.order_id FROM order_assignments a JOIN staff_accounts s ON s.tenant_id=a.tenant_id AND s.professional_id=a.professional_id WHERE a.tenant_id=? AND s.user_id=? AND a.removed_at IS NULL",
      )
      .all(ctx.tenantId, ctx.userId);
    const allowed = new Set(assignments.map((a) => a.order_id));
    orders = orders.filter((o: any) => allowed.has(o.id));
  }
  result.orders = orders;
  if (!p["settings.manage"] && !p["catalog.prices"] && !p["finance.costs"])
    delete result.parts_pricing;
  const orderIds = new Set(orders.map((o: any) => o.id));
  const customerIds = new Set(orders.map((o: any) => o.customer_id));
  const vehicleIds = new Set(orders.map((o: any) => o.vehicle_id));
  result.customers = p["customers.view"]
    ? (workspace.customers || []).filter(
        (c: any) => p["personal.full"] || customerIds.has(c.id),
      )
    : [];
  if (!p["personal.full"])
    result.customers = result.customers.map((c: any) =>
      Object.fromEntries(
        [
          "id",
          "name",
          "active",
          ...(p["personal.contact"] ? ["phone"] : []),
          ...(p["personal.email"] ? ["email"] : []),
          ...(p["personal.address"] ? ["address"] : []),
        ].map((key) => [key, c[key]]),
      ),
    );
  result.vehicles = p["customers.view"]
    ? (workspace.vehicles || []).filter(
        (v: any) => p["personal.full"] || vehicleIds.has(v.id),
      )
    : [];
  result.professionals = p["staff.view"] ? workspace.professionals : [];
  result.catalog = p["catalog.view"] ? workspace.catalog : [];
  result.product_categories = p["catalog.view"]
    ? workspace.product_categories
    : [];
  result.suppliers = p["catalog.view"] ? workspace.suppliers : undefined;
  if (!p["catalog.view"]) delete result.product_categories;
  if (!p["finance.view"])
    for (const key of [
      "receivables",
      "cash",
      "installments",
      "cash_accounts",
      "movements",
      "receipt_accounts",
    ])
      result[key] = [];
  else if (ctx.access.orderScope === "assigned") {
    result.receivables = (workspace.receivables || []).filter((r: any) =>
      orderIds.has(r.order_id),
    );
    const receivableIds = new Set(result.receivables.map((r: any) => r.id));
    result.installments = (workspace.installments || []).filter((i: any) =>
      receivableIds.has(i.receivable_id),
    );
    result.cash = [];
    result.movements = [];
  }
  if (!p["settings.finance"] && !p["finance.receive"]) {
    result.payment_settings = null;
    result.card_rates = [];
  }
  if (p["orders.basic_receive"] && ctx.modules?.finance === false)
    result.receipt_accounts = workspace.receipt_accounts || [];
  const redacted =
    ctx.access.profile === "master" ? result : redactResponse(result, p);
  for (const key of [
    "customers",
    "vehicles",
    "catalog",
    "professionals",
    "orders",
    "receivables",
    "cash",
    "movements",
    "installments",
    "card_rates",
    "cash_accounts",
    "receipt_accounts",
  ])
    if (!Array.isArray(redacted[key])) redacted[key] = [];
  if (!redacted.payment_settings) redacted.payment_settings = null;
  return redacted;
}
