import { type DB, transaction } from "../db/transactions.js";
import type { Context } from "../auth/session.js";
import { requireAdmin } from "./payments.js";
import { audit, id, scoped } from "./workshop.js";
export const serviceNameKey = (name: string) =>
  name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((w) => w && !["de", "do", "da", "dos", "das"].includes(w))
    .join(" ");
export async function assertUniqueService(
  db: DB,
  tenant: string,
  name: string,
  record?: string,
) {
  const key = serviceNameKey(name);
  const alias = await db
    .prepare(
      "SELECT c.id,c.name FROM service_aliases a JOIN catalog c ON c.id=a.catalog_id AND c.tenant_id=a.tenant_id WHERE a.tenant_id=? AND a.alias_key=? AND c.id<>? AND c.archived_at IS NULL",
    )
    .get(tenant, key, record || "");
  const existing =
    alias ||
    (
      await db
        .prepare(
          "SELECT id,name FROM catalog WHERE tenant_id=? AND kind='service' AND merged_into IS NULL AND id<>? AND archived_at IS NULL",
        )
        .all(tenant, record || "")
    ).find((c) => serviceNameKey(String(c.name)) === key);
  if (existing)
    throw new Error(
      `Este serviço já está cadastrado como “${existing.name}”. Selecione o cadastro existente (ou reative-o se estiver inativo).`,
    );
}
export async function mergeServices(
  db: DB,
  ctx: Context,
  canonicalId: string,
  duplicateIds: string[],
  name: string,
) {
  requireAdmin(ctx);
  return await transaction(db, async () => {
    const ids = [canonicalId, ...duplicateIds];
    if (new Set(ids).size !== ids.length || !duplicateIds.length)
      throw new Error("Grupo de serviços inválido.");
    const records = await Promise.all(
      ids.map(
        async (record) => await scoped(db, "catalog", ctx.tenantId, record),
      ),
    );
    if (records.some((r) => r.kind !== "service" || !r.active || r.merged_into))
      throw new Error(
        "Só é possível consolidar serviços ativos ainda não unificados.",
      );
    const beforeItems = await db
      .prepare(
        `SELECT id,catalog_id FROM order_items WHERE tenant_id=? AND catalog_id IN (${ids.map(() => "?").join(",")})`,
      )
      .all(ctx.tenantId, ...ids);
    const aliases = [
      name,
      ...records.flatMap((r) => [r.name, r.sku]),
      ...(
        await db
          .prepare(
            `SELECT alias FROM service_aliases WHERE tenant_id=? AND catalog_id IN (${ids.map(() => "?").join(",")})`,
          )
          .all(ctx.tenantId, ...ids)
      ).map((r) => String(r.alias)),
    ];
    for (const alias of aliases) {
      const key = serviceNameKey(alias);
      const prior = await db
        .prepare(
          "SELECT catalog_id FROM service_aliases WHERE tenant_id=? AND alias_key=?",
        )
        .get(ctx.tenantId, key);
      if (prior && !ids.includes(String(prior.catalog_id)))
        throw new Error("Nome alternativo já pertence a outro serviço.");
      await db
        .prepare(
          "INSERT INTO service_aliases(tenant_id,alias_key,alias,catalog_id) VALUES(?,?,?,?) ON CONFLICT(tenant_id,alias_key) DO UPDATE SET catalog_id=excluded.catalog_id",
        )
        .run(ctx.tenantId, key, alias, canonicalId);
    }
    await db
      .prepare(
        "INSERT INTO service_merge_history(id,tenant_id,canonical_id,previous_records) VALUES(?,?,?,?)",
      )
      .run(
        id(),
        ctx.tenantId,
        canonicalId,
        JSON.stringify({ records, items: beforeItems }),
      );
    await db
      .prepare("UPDATE catalog SET name=? WHERE tenant_id=? AND id=?")
      .run(name, ctx.tenantId, canonicalId);
    for (const duplicate of duplicateIds) {
      await db
        .prepare(
          "UPDATE order_items SET catalog_id=? WHERE tenant_id=? AND catalog_id=?",
        )
        .run(canonicalId, ctx.tenantId, duplicate);
      await db
        .prepare(
          "UPDATE catalog SET active=0,merged_into=? WHERE tenant_id=? AND id=?",
        )
        .run(canonicalId, ctx.tenantId, duplicate);
    }
    await audit(db, ctx, "services.consolidated", canonicalId);
  });
}
