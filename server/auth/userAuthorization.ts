import type { Request, Response, NextFunction } from "express";
import type { DB } from "../db/database";
import type { Context } from "./session";
import {
  assertOrderVisible,
  requirePermission,
  accessDenied,
} from "../services/userAccess";
import type { Permission, PermissionMap } from "../../shared/userPermissions";

export function permissionForRequest(
  path: string,
  method: string,
  body: any = {},
): Permission | null {
  const p = path.replace(/^\/api(?=\/)/, "");
  const read = ["GET", "HEAD"].includes(method);
  if (p.startsWith("/users") || p.startsWith("/user-invites"))
    return "users.manage";
  if (p.startsWith("/staff")) return read ? "staff.view" : "staff.manage";
  if (p.startsWith("/approvals"))
    return read ? "orders.discount" : "orders.approve";
  if (/^\/orders\/[^/]+\/discount-requests$/.test(p)) return "orders.discount";
  if (/^\/orders\/[^/]+\/assignments$/.test(p))
    return read ? "orders.view" : "orders.assign";
  if (/^\/orders\/[^/]+\/status$/.test(p))
    return body.status === "cancelled"
      ? "orders.admin"
      : body.status === "completed"
        ? "orders.finalize"
        : body.status === "quote"
          ? "orders.reopen"
          : "orders.status";
  if (/^\/orders\/[^/]+\/notes$/.test(p)) return "orders.notes";
  if (p.startsWith("/orders"))
    return read
      ? "orders.view"
      : p.includes("basic-receipt")
        ? "orders.basic_receive"
        : /capture/.test(p)
          ? "orders.items"
          : /share/.test(p)
            ? "orders.prices"
            : "orders.edit";
  if (p.startsWith("/checklists") || p.startsWith("/checklist-photos"))
    return read
      ? "checklists.view"
      : /finalize/.test(p)
        ? "checklists.finalize"
        : method === "POST" && p === "/checklists"
          ? "checklists.create"
          : "checklists.edit";
  if (p.startsWith("/documents"))
    return p.includes("/checklist/") ? "checklists.view" : "orders.view";
  if (p.startsWith("/customers") || p.startsWith("/vehicles"))
    return read
      ? "customers.view"
      : method === "POST" && /lookup|model-options|preview/.test(p)
        ? "customers.view"
        : method === "POST" &&
            /^\/(customers|vehicles|customers-with-vehicle)$/.test(p)
          ? "customers.create"
          : "customers.edit";
  if (p.startsWith("/professionals"))
    return read ? "staff.view" : "staff.manage";
  if (/^\/(catalog|product-categories|workshop-service)/.test(p))
    return read
      ? "catalog.view"
      : method === "DELETE" || /status$/.test(p)
        ? "catalog.remove"
        : method === "POST" && !/preview/.test(p)
          ? "catalog.create"
          : "catalog.edit";
  if (p.startsWith("/repair-services"))
    return p.includes("/rates")
      ? "settings.manage"
      : p.includes("/preview") || p.includes("/reprice")
        ? "technical.rates"
        : "technical.view";
  if (p.startsWith("/stock")) return read ? "stock.view" : "stock.manage";
  if (p.startsWith("/suppliers"))
    return read
      ? "catalog.view"
      : method === "POST"
        ? "catalog.create"
        : "catalog.edit";
  if (/^\/(expenses|payables|expense-templates)/.test(p))
    return read ? "finance.view" : "finance.expenses";
  if (p.startsWith("/management-results")) return "finance.profit";
  if (p.startsWith("/cash")) return read ? "finance.view" : "finance.policies";
  if (p.startsWith("/card-machines") || p.startsWith("/payment-settings"))
    return read ? "finance.receive" : "finance.policies";
  if (/^\/(receivables|installments)/.test(p))
    return read
      ? "finance.view"
      : /reverse|cancel|refund/.test(p)
        ? "finance.reverse"
        : /discount/.test(p)
          ? "orders.discount"
          : /settle|receive/.test(p)
            ? "finance.receive"
            : "finance.edit";
  if (p.startsWith("/parts-pricing"))
    return /preview/.test(p) ? "catalog.view" : "settings.manage";
  if (p.startsWith("/workshop-profile"))
    return read ? "settings.view" : "settings.manage";
  return null;
}
const ownRoutes = new Set([
  "/repair-services/access",
  "/workspace",
  "/session",
  "/logout",
  "/tenant",
  "/reauthenticate",
]);
export function redactResponse(value: any, p: PermissionMap): any {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => redactResponse(v, p));
  const result: Record<string, any> = {};
  for (const [key, child] of Object.entries(value)) {
    if (
      !p["personal.contact"] &&
      /^(phone|whatsapp|customer_phone|tenant_phone)$/.test(key)
    )
      continue;
    if (!p["personal.email"] && /^(email|customer_email)$/.test(key)) continue;
    if (!p["personal.address"] && /^(address|customer_address)$/.test(key))
      continue;
    if (
      !p["technical.rates"] &&
      /^(rate|hourly_rate|labor_rate|tariff|rates|labor_rates|labor_commercial_rates)$/.test(
        key,
      )
    )
      continue;
    if (
      !p["personal.full"] &&
      /^(document|customer_document|birthday|signature_data)$/.test(key)
    )
      continue;
    if (
      !p["orders.prices"] &&
      /^(price|total|discount|amount|gross|net|fee|balance|paid|payment_summary|payment_status|receivable_id|subtotal|unit_price|sale_price|receivable|receivables|installments|cash|cash_accounts|card_rates|payment_settings|parts_pricing)$/.test(
        key,
      )
    )
      continue;
    if (
      !p["finance.costs"] &&
      !p["catalog.prices"] &&
      /cost|margin|profit|freight|gain/.test(key)
    )
      continue;
    if (
      (!p["finance.costs"] || !p["orders.prices"]) &&
      /^(service_snapshot|service_details|payload|metadata)$/.test(key)
    )
      continue;
    result[key] = redactResponse(child, p);
  }
  return result;
}
export function userAuthorization(db: DB) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx: Context = res.locals.context;
      if (!ctx || req.path.startsWith("/admin-api")) {
        next();
        return;
      }
      if (ownRoutes.has(req.path)) {
        next();
        return;
      }
      if (!ctx.access) {
        if (
          ctx.role === "owner" ||
          (/^\/documents\/order\/[^/]+$/.test(req.path) &&
            ["GET", "POST"].includes(req.method)) ||
          (req.method === "POST" &&
            /^\/orders\/[^/]+\/status$/.test(req.path)) ||
          (req.method === "PATCH" && /^\/orders\/[^/]+\/notes$/.test(req.path))
        ) {
          next();
          return;
        }
        accessDenied();
      }
      const permission = permissionForRequest(req.path, req.method, req.body);
      if (!permission) {
        throw Object.assign(new Error("Rota indisponível."), { status: 404 });
      }
      requirePermission(ctx, permission);
      ctx.action = permission;
      if (
        ctx.access &&
        req.method !== "GET" &&
        /^\/(catalog|workshop-services|stock)/.test(req.path) &&
        !ctx.access.permissions["catalog.prices"]
      ) {
        const hasPricing = (v: any): boolean =>
          v &&
          typeof v === "object" &&
          Object.entries(v).some(
            ([k, c]) =>
              /^(price|cost|unit_cost|unit_price|freight_unit)$/.test(k) ||
              hasPricing(c),
          );
        if (hasPricing(req.body)) requirePermission(ctx, "catalog.prices");
      }
      if (ctx.access && req.body?.active === 0) {
        if (/^\/(customers|vehicles)/.test(req.path))
          requirePermission(ctx, "customers.remove");
        if (/^\/(catalog|workshop-services|suppliers)/.test(req.path))
          requirePermission(ctx, "catalog.remove");
      }
      if (
        ctx.access &&
        req.body &&
        (req.body.new_customer || req.body.new_vehicle)
      )
        requirePermission(ctx, "customers.create");
      if (
        ctx.access &&
        req.body?.items?.some(
          (item: any) => item.cost_override !== undefined,
        ) &&
        !ctx.access.permissions["catalog.prices"]
      )
        requirePermission(ctx, "finance.costs");
      if (
        ctx.access &&
        req.method !== "GET" &&
        /^\/(card-machines|payment-settings)/.test(req.path)
      )
        requirePermission(ctx, "settings.finance");
      if (ctx.access && req.path === "/stock-invoices/import")
        requirePermission(ctx, "catalog.create");
      if (ctx.access && req.path.startsWith("/catalog-capture"))
        requirePermission(ctx, "catalog.prices");
      const orderMatch = req.path.match(
        /^\/(?:orders|documents\/order)\/([^/]+)/,
      );
      if (orderMatch && orderMatch[1] !== "archives") {
        const order = await assertOrderVisible(db, ctx, orderMatch[1]);
        if (req.method === "POST" && req.path.endsWith("/status")) {
          if (order.status === "completed")
            requirePermission(ctx, "orders.reopen");
          if (order.status === "quote" && req.body.status === "open")
            requirePermission(ctx, "orders.edit");
        }
      }
      if (
        ctx.access &&
        req.path.startsWith("/documents/archives") &&
        ctx.access.profile !== "master"
      )
        accessDenied();
      if (
        ctx.access &&
        req.path.startsWith("/documents/") &&
        req.body?.new_revision
      )
        requirePermission(ctx, "orders.edit");
      if (
        ctx.access?.orderScope === "assigned" &&
        (req.path.startsWith("/management-results") ||
          req.path.startsWith("/cash-control"))
      )
        accessDenied();
      if (
        ctx.access?.orderScope === "assigned" &&
        /^\/(checklists|checklist-photos|documents\/checklist)/.test(req.path)
      ) {
        const id = req.path.startsWith("/documents/checklist")
          ? req.path.split("/")[3]
          : req.path.split("/")[2];
        if (id) {
          const checklist = req.path.startsWith("/checklist-photos")
            ? await db
                .prepare(
                  "SELECT k.order_id FROM checklist_photos p JOIN checklists k ON k.id=p.checklist_id AND k.tenant_id=p.tenant_id WHERE p.tenant_id=? AND p.id=?",
                )
                .get(ctx.tenantId, id)
            : await db
                .prepare(
                  "SELECT order_id FROM checklists WHERE tenant_id=? AND id=?",
                )
                .get(ctx.tenantId, id);
          if (!checklist?.order_id) accessDenied();
          await assertOrderVisible(db, ctx, checklist.order_id);
        } else if (req.method !== "GET") {
          if (!req.body.order_id) accessDenied();
          await assertOrderVisible(db, ctx, req.body.order_id);
        }
      }
      if (
        ctx.access?.orderScope === "assigned" &&
        /^\/(receivables|installments)/.test(req.path)
      ) {
        const id = req.path.split("/")[2];
        const row = req.path.startsWith("/installments")
          ? await db
              .prepare(
                "SELECT r.order_id FROM payment_installments p JOIN receivables r ON r.id=p.receivable_id AND r.tenant_id=p.tenant_id WHERE p.tenant_id=? AND p.id=?",
              )
              .get(ctx.tenantId, id)
          : await db
              .prepare(
                "SELECT order_id FROM receivables WHERE tenant_id=? AND id=?",
              )
              .get(ctx.tenantId, id);
        if (!row?.order_id) accessDenied();
        await assertOrderVisible(db, ctx, row.order_id);
      }
      if (
        ctx.access &&
        ctx.access.profile !== "master" &&
        !/^\/(users|staff|user-invites|approvals)/.test(req.path)
      ) {
        const json = res.json.bind(res);
        res.json = ((value: any) =>
          json(
            redactResponse(value, ctx.access!.permissions),
          )) as typeof res.json;
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}
