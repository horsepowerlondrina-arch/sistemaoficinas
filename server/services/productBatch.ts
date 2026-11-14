import { z } from "zod";
import { createHash } from "node:crypto";
import { transaction, type DB } from "../db/transactions.js";
import type { Context } from "../auth/session.js";
import { requireAdmin } from "./payments.js";
import { audit, id } from "./workshop.js";
import { validProductCategory } from "./productCategories.js";
import { getPartsPricing } from "./partsPricing.js";
import { allocateFreight } from "../../shared/freight.js";
import { salePrice } from "../../shared/pricing.js";
const cents = z.number().int().min(0).max(100000000);
export const productBatchSchema = z.object({
  request_id: z.string().uuid(),
  freight_total: cents,
  items: z
    .array(
      z.object({
        name: z.string().trim().min(2).max(150),
        sku: z.string().trim().min(1).max(40),
        brand: z.string().trim().max(300).default(""),
        manufacturer_code: z.string().trim().max(300).default(""),
        application: z.string().trim().max(1000).default(""),
        category: z.string().trim().max(100).default(""),
        cost: cents,
        quantity: z.number().int().min(1).max(1000000),
      }),
    )
    .min(1)
    .max(100),
});
export async function createProductBatch(db: DB, ctx: Context, body: unknown) {
  requireAdmin(ctx);
  const input = productBatchSchema.parse(body);
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(input))
    .digest("hex");
  const action = "catalog.batch.created:" + fingerprint;
  return transaction(db, async () => {
    const previous = await db
      .prepare(
        "SELECT action FROM audit_events WHERE tenant_id=? AND entity_id=? AND action LIKE 'catalog.batch.created:%'",
      )
      .get(ctx.tenantId, input.request_id);
    if (previous) {
      if (previous.action !== action)
        throw new Error(
          "Esta lista já foi salva. Abra um novo cadastro de produtos.",
        );
      return { ok: true, count: input.items.length };
    }
    const skus = new Set<string>();
    for (const item of input.items) {
      const key = item.sku.toLocaleLowerCase("pt-BR");
      if (skus.has(key)) throw new Error("Há referências repetidas na lista.");
      skus.add(key);
      if (
        await db
          .prepare(
            "SELECT id FROM catalog WHERE tenant_id=? AND LOWER(sku)=LOWER(?)",
          )
          .get(ctx.tenantId, item.sku)
      )
        throw new Error(
          "A referência " +
            item.sku +
            " já está cadastrada. Use outra referência ou edite o produto existente.",
        );
    }
    const allocated = allocateFreight(
      input.items.map((i, index) => ({
        ...i,
        id: String(index).padStart(3, "0"),
      })),
      input.freight_total,
    );
    const policy = await getPartsPricing(db, ctx.tenantId);
    for (const [index, item] of input.items.entries()) {
      const category = await validProductCategory(db, ctx, item.category);
      const values = allocated[index];
      const record = id();
      await db
        .prepare(
          "INSERT INTO catalog(id,tenant_id,kind,name,sku,brand,manufacturer_code,application,category,cost,price,freight_unit,stock,minimum_stock,stock_verified,cost_known,category_confirmed,active) VALUES(?,?,'product',?,?,?,?,?,?,?,?,?,0,0,1,1,1,1)",
        )
        .run(
          record,
          ctx.tenantId,
          item.name,
          item.sku,
          item.brand,
          item.manufacturer_code,
          item.application,
          category,
          values.cost,
          salePrice(values.cost, policy),
          values.freight_unit,
        );
      await audit(db, ctx, "catalog.created", record);
    }
    await audit(db, ctx, action, input.request_id);
    return { ok: true, count: input.items.length };
  });
}
