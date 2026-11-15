import { transaction, type DB } from "../db/transactions.js";
import type { Context } from "../auth/session.js";
import { requireAdmin } from "./payments.js";
import { id, scoped, audit } from "./workshop.js";
const clean = (value: string) => value.trim().replace(/\s+/g, " ");
const key = (value: string) => clean(value).toLocaleLowerCase("pt-BR");
export async function listProductCategories(db: DB, ctx: Context) {
  requireAdmin(ctx);
  return db.prepare("SELECT c.*,(SELECT count(*) FROM catalog p WHERE p.tenant_id=c.tenant_id AND p.kind='product' AND p.category=c.name) product_count FROM product_categories c WHERE c.tenant_id=? ORDER BY c.active DESC,c.name").all(ctx.tenantId);
}
export async function validProductCategory(db: DB, ctx: Context, value: string, previous?: string) {
  const name = clean(value);
  if (!name) return "";
  const category = await db.prepare("SELECT * FROM product_categories WHERE tenant_id=? AND name_key=? AND active=1").get(ctx.tenantId,key(name));
  if (category) return category.name as string;
  // Preserve existing labels when an unrelated product field is edited.
  if (previous && name === previous) return previous;
  throw new Error("Escolha uma categoria cadastrada e ativa na lista.");
}
export async function saveProductCategory(db: DB, ctx: Context, value: { name: string; request_id?: string }, record?: string) {
  requireAdmin(ctx);
  const name=clean(value.name),nameKey=key(name);
  if (!name || name.length>100) throw new Error("Informe uma categoria de até 100 caracteres.");
  return transaction(db, async () => {
    const old = record ? await scoped(db,"product_categories",ctx.tenantId,record) : null;
    const existing = await db.prepare("SELECT * FROM product_categories WHERE tenant_id=? AND name_key=?").get(ctx.tenantId,nameKey);
    if (existing && existing.id!==record) {
      if (!record && value.request_id===existing.id && existing.active) return String(existing.id);
      if (!record && !existing.active) {
        await db.prepare("UPDATE product_categories SET active=1 WHERE tenant_id=? AND id=?").run(ctx.tenantId,existing.id);
        await audit(db,ctx,"product_category.restored",existing.id);
        return String(existing.id);
      }
      throw new Error("Já existe uma categoria com esse nome.");
    }
    const recordId=record||value.request_id||id();
    if (record) {
      await db.prepare("UPDATE product_categories SET name=?,name_key=? WHERE tenant_id=? AND id=?").run(name,nameKey,ctx.tenantId,record);
      await db.prepare("UPDATE catalog SET category=? WHERE tenant_id=? AND kind='product' AND category=?").run(name,ctx.tenantId,old!.name);
    } else {
      await db.prepare("INSERT INTO product_categories(id,tenant_id,name,name_key) VALUES(?,?,?,?)").run(recordId,ctx.tenantId,name,nameKey);
    }
    await audit(db,ctx,"product_category.saved",recordId);
    return recordId;
  });
}
export async function removeProductCategory(db: DB, ctx: Context, record: string) {
  requireAdmin(ctx);
  return transaction(db,async () => {
    await scoped(db,"product_categories",ctx.tenantId,record);
    await db.prepare("UPDATE product_categories SET active=0 WHERE tenant_id=? AND id=?").run(ctx.tenantId,record);
    await audit(db,ctx,"product_category.removed",record);
  });
}
