import type { DB } from "../db/database.js";
import {
  createTransferPayload,
  sealTransferPackage,
  TRANSFER_TABLES,
  TRANSFER_TENANT_FIELDS,
} from "../../shared/transferPackage.js";
import type { TransferPayload, TransferRow } from "../../shared/transferPackage.js";

const privateField = /(?:password|secret|token|session|credential|api[_-]?key|authorization)/i;
function safeRecord(row: TransferRow) {
  return Object.fromEntries(Object.entries(row)
    .filter(([key]) => !privateField.test(key))
    .map(([key, value]) => [key, value instanceof Date ? value.toISOString() : value]));
}

/** Reads the authenticated tenant only. It performs no writes or audit mutations. */
export async function createWorkshopTransfer(db: DB, tenantId: string, passphrase: string, now = new Date()): Promise<Buffer> {
  const tenant = await db.prepare("SELECT * FROM tenants WHERE id=?").get(tenantId);
  if (!tenant) throw new Error("Oficina autenticada não encontrada.");
  const allowedTenant = new Set<string>(TRANSFER_TENANT_FIELDS);
  const tenantRow = Object.fromEntries(Object.entries(tenant).filter(([key]) => allowedTenant.has(key)));
  tenantRow.id = tenantId;
  const records: TransferPayload["records"] = {
    tenant: tenantRow,
    users: (await db.prepare("SELECT u.id,u.name,u.email FROM users u JOIN memberships m ON m.user_id=u.id WHERE m.tenant_id=? ORDER BY u.id").all(tenantId)).map(safeRecord),
    memberships: (await db.prepare("SELECT user_id,tenant_id,role FROM memberships WHERE tenant_id=? ORDER BY user_id").all(tenantId)).map(safeRecord),
  };
  for (const table of TRANSFER_TABLES) {
    const columns = await db.prepare("SELECT column_name FROM information_schema.columns WHERE table_schema='horse_power' AND table_name=?").all(table);
    if (!columns.length || !columns.some((column) => column.column_name === "tenant_id")) continue;
    const rows = await db.prepare(`SELECT * FROM ${table} WHERE tenant_id=?`).all(tenantId);
    records[table] = rows.map(safeRecord).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  }
  return sealTransferPackage(createTransferPayload("sistemaoficinas", { id: tenantId, name: String(tenantRow.name || "Oficina") }, records, now.toISOString()), passphrase);
}
