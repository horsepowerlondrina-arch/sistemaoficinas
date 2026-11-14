import { type DB, transaction } from "../db/transactions.js";
import type { Context } from "../auth/session.js";
import { requireAdmin } from "./payments.js";
import { audit } from "./workshop.js";

// Maintenance operation, deliberately not exposed as an HTTP endpoint.
// Retain catalog IDs used by historical documents and stock movements.
export async function enableExtensionCatalog(db: DB, ctx: Context) {
  requireAdmin(ctx);
  return transaction(db, async () => {
    const tenant = await db
      .prepare("SELECT * FROM tenants WHERE id=?")
      .get(ctx.tenantId);
    if (!tenant) throw new Error("Oficina não encontrada.");
    if (tenant.catalog_mode === "extension")
      return { changed: false, archived: 0 };
    const result = await db
      .prepare(
        "UPDATE catalog SET archived_at=?,active=0 WHERE tenant_id=? AND archived_at IS NULL",
      )
      .run(new Date().toISOString(), ctx.tenantId);
    await db
      .prepare("DELETE FROM service_aliases WHERE tenant_id=?")
      .run(ctx.tenantId);
    await db
      .prepare("DELETE FROM external_catalog_links WHERE tenant_id=?")
      .run(ctx.tenantId);
    // Require a fresh connection so a pending import cannot race the reset.
    await db
      .prepare("DELETE FROM capture_sessions WHERE tenant_id=?")
      .run(ctx.tenantId);
    await db
      .prepare("UPDATE tenants SET catalog_mode='extension' WHERE id=?")
      .run(ctx.tenantId);
    await audit(db, ctx, "catalog.reset.extension", ctx.tenantId);
    return { changed: true, archived: Number(result.changes) };
  });
}
