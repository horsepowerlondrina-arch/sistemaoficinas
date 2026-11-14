import { z } from "zod";
import { transaction, type DB } from "../db/transactions.js";
import type { Context } from "../auth/session.js";
import { requireAdmin } from "./payments.js";
import { id, scoped, audit } from "./workshop.js";
import type { StockInvoice } from "../domain/stockInvoice.js";

const field = (max: number) => z.string().trim().max(max).default("");
export const supplierSchema = z.object({
  name: z.string().trim().min(1, "Informe o nome do fornecedor.").max(200),
  trade_name: field(200),
  document: field(30).refine(v => /^[\d.\s/\-]*$/.test(v), "Informe apenas o CPF ou CNPJ.")
    .transform(v => v.replace(/\D/g, ""))
    .refine(v => !v || ((v.length === 11 || v.length === 14) && !/^(\d)\1+$/.test(v)), "Informe um CPF de 11 dígitos ou CNPJ de 14 dígitos."),
  phone: field(40), email: field(200).refine(v => !v || z.string().email().safeParse(v).success, "Informe um e-mail válido."),
  address: field(200), number: field(30), complement: field(100), district: field(100),
  city: field(100), state: field(2).transform(v => v.toUpperCase()).refine(v => !v || /^[A-Z]{2}$/.test(v), "Informe a UF com duas letras."),
  postal_code: field(12), seller: field(150), notes: field(2000),
  active: z.number().int().min(0).max(1).default(1),
});
const columns = ["name","trade_name","document","phone","email","address","number","complement","district","city","state","postal_code","seller","notes","active"] as const;
const values = (v: z.infer<typeof supplierSchema>) => columns.map(k => k === "document" ? v[k] || null : v[k]);

export async function listSuppliers(db: DB, ctx: Context) {
  requireAdmin(ctx);
  return db.prepare("SELECT s.*,(SELECT count(DISTINCT p.catalog_id) FROM stock_invoice_products p WHERE p.tenant_id=s.tenant_id AND p.supplier_id=s.id) product_count,(SELECT count(*) FROM stock_invoices i WHERE i.tenant_id=s.tenant_id AND i.supplier_id=s.id) invoice_count FROM suppliers s WHERE s.tenant_id=? ORDER BY s.active DESC,s.name").all(ctx.tenantId);
}
export async function supplierDetails(db: DB, ctx: Context, record: string) {
  requireAdmin(ctx);
  const supplier = await scoped(db,"suppliers",ctx.tenantId,record);
  const products = await db.prepare("SELECT p.*,c.name,c.brand,c.manufacturer_code,c.application FROM stock_invoice_products p JOIN catalog c ON c.tenant_id=p.tenant_id AND c.id=p.catalog_id WHERE p.tenant_id=? AND p.supplier_id=? ORDER BY c.name,p.supplier_code").all(ctx.tenantId,record);
  return { supplier, products };
}
export async function saveSupplier(db: DB, ctx: Context, input: unknown, record?: string) {
  requireAdmin(ctx);
  const v = supplierSchema.parse(input);
  return transaction(db,async () => {
    if (record) await scoped(db,"suppliers",ctx.tenantId,record);
    if (v.document) {
      const existing = await db.prepare("SELECT id FROM suppliers WHERE tenant_id=? AND document=?").get(ctx.tenantId,v.document);
      if (existing && existing.id !== record) throw new Error("Já existe um fornecedor com este CPF/CNPJ.");
    }
    const recordId = record || id();
    if (record) await db.prepare("UPDATE suppliers SET " + columns.map(k=>k+"=?").join(",") + ",updated_at=CURRENT_TIMESTAMP WHERE tenant_id=? AND id=?").run(...values(v),ctx.tenantId,record);
    else await db.prepare("INSERT INTO suppliers(id,tenant_id,"+columns.join(",")+") VALUES("+Array(columns.length+2).fill("?").join(",")+")").run(recordId,ctx.tenantId,...values(v));
    await audit(db,ctx,record ? "supplier.updated" : "supplier.created",recordId);
    return recordId;
  });
}
export async function invoiceSupplierPreview(db: DB, ctx: Context, invoice: StockInvoice): Promise<{ existing: boolean; draft: Record<string, any> }> {
  const existing = await db.prepare("SELECT * FROM suppliers WHERE tenant_id=? AND document=?").get(ctx.tenantId,invoice.document);
  const draft: Record<string, any> = { ...invoice.supplierData, active: 1, ...existing };
  for (const [key,value] of Object.entries(invoice.supplierData)) if (!draft[key]) draft[key]=value;
  return { existing: !!existing, draft };
}
// Called inside the stock transaction: creating/editing the supplier rolls back with a failed import.
export async function ensureInvoiceSupplier(db: DB, ctx: Context, invoice: StockInvoice, input?: unknown) {
  requireAdmin(ctx);
  const preview = await invoiceSupplierPreview(db,ctx,invoice);
  const v = supplierSchema.parse(input === undefined ? preview.draft : input);
  if (v.document !== invoice.document) throw new Error("O CNPJ do fornecedor deve ser o informado no XML.");
  if (preview.existing) {
    await saveSupplier(db,ctx,v,preview.draft.id);
    return String(preview.draft.id);
  }
  await db.prepare("INSERT INTO suppliers(id,tenant_id,"+columns.join(",")+") VALUES("+Array(columns.length+2).fill("?").join(",")+") ON CONFLICT(tenant_id,document) DO NOTHING").run(id(),ctx.tenantId,...values(v));
  const saved = await db.prepare("SELECT id FROM suppliers WHERE tenant_id=? AND document=?").get(ctx.tenantId,v.document);
  if (!saved) throw new Error("Não foi possível cadastrar o fornecedor.");
  await audit(db,ctx,"supplier.invoice_registered",saved.id);
  return String(saved.id);
}
