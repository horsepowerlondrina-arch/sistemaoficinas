import type { DB } from "../db/database";
import type { Context } from "../auth/session";
import {
  effectivePermissions,
  type Permission,
  type PermissionMap,
  type UserProfile,
  discountAllowed,
} from "../../shared/userPermissions";
import { createHash } from "node:crypto";

export type UserAccess = {
  profile: UserProfile;
  active: boolean;
  permissions: PermissionMap;
  orderScope: "all" | "assigned";
  discountBps: number;
  discountCents: number | null;
};
export function accessDenied(
  message = "Você não tem permissão para esta ação.",
): never {
  throw Object.assign(new Error(message), { status: 403 });
}
export async function readUserAccess(
  db: DB,
  ctx: Context,
): Promise<UserAccess> {
  const row = await db
    .prepare(
      "SELECT * FROM workshop_user_access WHERE tenant_id=? AND user_id=?",
    )
    .get(ctx.tenantId, ctx.userId);
  const profile: UserProfile =
    ctx.role === "owner"
      ? "master"
      : row?.profile && row.profile !== "master"
        ? row.profile
        : "mechanic";
  return {
    profile,
    active: row ? row.active === 1 : true,
    permissions: effectivePermissions(
      profile,
      row ? JSON.parse(row.permissions) : {},
      ctx.modules,
    ),
    orderScope: profile === "master" ? "all" : row?.order_scope || "all",
    discountBps:
      profile === "master" ? 10000 : row ? Number(row.discount_bps) : 0,
    discountCents:
      profile === "master" ||
      row?.discount_cents === undefined ||
      row?.discount_cents === null
        ? null
        : Number(row.discount_cents),
  };
}
export function requirePermission(ctx: Context, permission: Permission) {
  if (ctx.access) {
    if (!ctx.access.active || !ctx.access.permissions[permission])
      accessDenied();
  } else if (ctx.role !== "owner") accessDenied();
}
export async function assertOrderVisible(
  db: DB,
  ctx: Context,
  orderId: string,
) {
  requirePermission(ctx, "orders.view");
  const order = await db
    .prepare("SELECT * FROM orders WHERE tenant_id=? AND id=?")
    .get(ctx.tenantId, orderId);
  if (!order)
    throw Object.assign(new Error("OS não encontrada nesta oficina."), {
      status: 404,
    });
  if (ctx.access?.orderScope === "assigned") {
    const match = await db
      .prepare(
        "SELECT 1 FROM order_assignments a JOIN staff_accounts s ON s.tenant_id=a.tenant_id AND s.professional_id=a.professional_id WHERE a.tenant_id=? AND a.order_id=? AND s.user_id=? AND a.removed_at IS NULL",
      )
      .get(ctx.tenantId, orderId, ctx.userId);
    if (!match)
      throw Object.assign(new Error("OS não encontrada nesta oficina."), {
        status: 404,
      });
  }
  return order;
}
export function orderStateDigest(order: Record<string, any>): string {
  const items = (order.items || [])
    .map((i: any) => ({
      id: i.id || "",
      catalog_id: i.catalog_id || "",
      quantity: i.quantity,
      price: i.price,
      cost: i.cost ?? i.cost_override ?? 0,
    }))
    .sort((a: any, b: any) => a.id.localeCompare(b.id));
  return createHash("sha256")
    .update(
      JSON.stringify({
        id: order.id,
        status: order.status,
        customer: order.customer_id,
        vehicle: order.vehicle_id,
        discount: order.discount, payment_state:order.payment_state,
        items,
      }),
    )
    .digest("hex");
}
export function canDiscount(
  ctx: Context,
  subtotal: number,
  discount: number,
): boolean {
  if (ctx.access)
    return (
      ctx.access.permissions["orders.discount"] &&
      discountAllowed(
        subtotal,
        discount,
        ctx.access.discountBps,
        ctx.access.discountCents,
      )
    );
  return (
    ctx.role === "owner" && discountAllowed(subtotal, discount, 10000, null)
  );
}

