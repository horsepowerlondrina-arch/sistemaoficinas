import { randomBytes, randomUUID } from "node:crypto";
import type { DB } from "../db/database.js";
import { hashPassword } from "../auth/session.js";
import {
  openTransferPackage,
  TRANSFER_TABLES,
  TRANSFER_TENANT_FIELDS,
  transferFileSha256,
  validateTransferPayload,
} from "../../shared/transferPackage.js";
import type { TransferPayload, TransferRow, TransferTable } from "../../shared/transferPackage.js";

const tableName = new Set<string>(TRANSFER_TABLES);
const insertOrder: TransferTable[] = [
  "product_categories", "professionals", "suppliers", "catalog", "workshop_services",
  "labor_rates", "labor_commercial_rates", "customers", "vehicles", "expense_templates",
  "payment_settings", "card_rates", "cash_accounts", "orders", "order_items",
  "stock_invoices", "stock_invoice_products", "stock_movements", "receivables",
  "payment_installments", "cash_entries", "payables", "cash_movements", "service_aliases",
  "service_merge_history", "external_catalog_links", "external_captures", "service_times", "checklists",
  "checklist_photos", "document_revisions", "audit_events",
];

export interface TransferInspection {
  confirmationId: string;
  sourceWorkshop: string;
  targetWorkshop: string;
  counts: Record<string, number>;
  issues: string[];
  warnings: string[];
  canImport: boolean;
}

async function columnsFor(db: DB, table: string): Promise<Set<string>> {
  const rows = await db.prepare("SELECT column_name FROM information_schema.columns WHERE table_schema='horse_power' AND table_name=?").all(table);
  return new Set(rows.map((row) => String(row.column_name)));
}

function valuesForInsert(row: TransferRow, columns: Set<string>, sourceTenantId: string, targetTenantId: string, userIds: Map<string, string>) {
  const mapped: TransferRow = {};
  for (const [key, value] of Object.entries(row)) {
    if (!columns.has(key)) throw new Error(`O campo ${key} não existe no destino.`);
    if (key === "tenant_id" && value === sourceTenantId) mapped[key] = targetTenantId;
    else if ((key === "user_id" || key === "issued_by") && typeof value === "string") {
      const targetUserId = userIds.get(value);
      if (!targetUserId) throw new Error("O pacote referencia uma identidade histórica sem correspondência; a importação foi cancelada.");
      mapped[key] = targetUserId;
    } else mapped[key] = value;
  }
  return mapped;
}

async function targetRecordExists(db: DB, table: string, row: TransferRow, columns: Set<string>) {
  if (columns.has("id") && row.id !== undefined) {
    return !!(await db.prepare(`SELECT 1 FROM ${table} WHERE id=?`).get(row.id));
  }
  if (table === "users" && row.email !== undefined) {
    return !!(await db.prepare("SELECT 1 FROM users WHERE lower(email)=lower(?)").get(row.email));
  }
  return false;
}

async function inspectPayload(db: DB, targetTenantId: string, payload: TransferPayload, digest: string): Promise<TransferInspection> {
  const issues: string[] = [], warnings: string[] = [];
  const counts: Record<string, number> = {};
  const target = await db.prepare("SELECT id,name FROM tenants WHERE id=?").get(targetTenantId);
  if (!target) issues.push("A oficina de destino não foi encontrada na sessão autenticada.");
  if (payload.records.tenant.id !== payload.source.tenant.id) issues.push("O identificador da oficina no manifesto não confere.");

  const tenantColumns = await columnsFor(db, "tenants");
  for (const key of Object.keys(payload.records.tenant)) {
    if (key !== "id" && !tenantColumns.has(key)) issues.push(`A configuração da oficina contém campo sem correspondência: ${key}.`);
  }

  const userColumns = await columnsFor(db, "users");
  const membershipColumns = await columnsFor(db, "memberships");
  if (!userColumns.size || !membershipColumns.size) issues.push("O destino não possui as tabelas de identidade esperadas.");
  for (const row of payload.records.users) {
    if (!row.id || !row.email || !row.name) issues.push("Uma identidade histórica está incompleta.");
    const byId = await db.prepare("SELECT email FROM users WHERE id=?").get(row.id);
    if (byId && String(byId.email).toLowerCase() !== String(row.email).toLowerCase()) issues.push(`Conflito de identidade para ${String(row.email || row.id)}.`);
  }
  const importedUserIds = new Set(payload.records.users.map((row) => String(row.id)));
  for (const membership of payload.records.memberships) {
    if (membership.tenant_id !== payload.source.tenant.id || !importedUserIds.has(String(membership.user_id)))
      issues.push("Há um vínculo de identidade fora da oficina de origem ou sem usuário correspondente.");
  }

  for (const table of TRANSFER_TABLES) {
    const rows = payload.records[table] || [];
    if (!tableName.has(table)) { issues.push(`Entidade não permitida: ${table}.`); continue; }
    counts[table] = rows.length;
    const columns = await columnsFor(db, table);
    if (!columns.size) { if (rows.length) issues.push(`A entidade ${table} não existe no schema de destino.`); continue; }
    if (!columns.has("tenant_id")) { issues.push(`A entidade ${table} não está isolada por oficina no destino.`); continue; }
    for (const row of rows) {
      if (row.tenant_id !== payload.source.tenant.id) issues.push(`A entidade ${table} contém registro de outra oficina.`);
      for (const key of Object.keys(row)) if (!columns.has(key)) issues.push(`O destino não possui o campo ${table}.${key}; importação cancelada para não perder dados.`);
      if (rows.length && await targetRecordExists(db, table, row, columns)) issues.push(`Conflito de ID na entidade ${table}.`);
    }
    const existing = await db.prepare(`SELECT count(*) AS count FROM ${table} WHERE tenant_id=?`).get(targetTenantId);
    if (Number(existing?.count || 0) > 0) issues.push(`A oficina de destino já possui dados em ${table}; use uma oficina vazia para impedir duplicações.`);
  }

  const tenant = payload.records.tenant;
  for (const key of ["name", "document", "phone", "address"]) {
    if (tenant[key] === undefined) warnings.push(`O pacote não contém ${key} da oficina; o valor atual do destino será mantido.`);
  }
  return {
    confirmationId: digest,
    sourceWorkshop: payload.source.tenant.name,
    targetWorkshop: String(target?.name || "Oficina de destino"),
    counts,
    issues: [...new Set(issues)].slice(0, 100),
    warnings: [...new Set(warnings)],
    canImport: issues.length === 0,
  };
}

export async function previewWorkshopImport(db: DB, tenantId: string, file: Buffer, passphrase: string) {
  const payload = openTransferPackage(file, passphrase);
  return inspectPayload(db, tenantId, payload, transferFileSha256(file));
}

export async function importWorkshopPackage(
  db: DB,
  tenantId: string,
  file: Buffer,
  passphrase: string,
  confirmationId: string,
  actorUserId: string,
) {
  const payload = openTransferPackage(file, passphrase);
  const digest = transferFileSha256(file);
  if (!confirmationId || confirmationId !== digest) throw new Error("O pacote mudou desde a prévia. Gere uma nova prévia antes de confirmar.");
  const preview = await inspectPayload(db, tenantId, payload, digest);
  if (!preview.canImport) throw new Error(preview.issues[0] || "A prévia encontrou impedimentos.");

  const run = async () => {
    // Recheck emptiness inside the transaction immediately before inserting.
    for (const table of TRANSFER_TABLES) {
      if (!(await columnsFor(db, table)).has("tenant_id")) continue;
      const exists = await db.prepare(`SELECT 1 FROM ${table} WHERE tenant_id=? LIMIT 1`).get(tenantId);
      if (exists) throw new Error(`A oficina recebeu novos dados em ${table} após a prévia. Gere uma nova prévia.`);
    }
    const tenant = payload.records.tenant;
    const tenantColumns = await columnsFor(db, "tenants");
    const transferableTenantFields = new Set<string>(TRANSFER_TENANT_FIELDS);
    const tenantValues = Object.fromEntries(Object.entries(tenant).filter(([key]) => key !== "id" && transferableTenantFields.has(key) && tenantColumns.has(key)));
    const tenantEntries = Object.entries(tenantValues);
    if (tenantEntries.length) {
      await db.prepare(`UPDATE tenants SET ${tenantEntries.map(([key]) => `${key}=?`).join(",")} WHERE id=?`)
        .run(...tenantEntries.map(([, value]) => value), tenantId);
    }

    const userIds = new Map<string, string>();
    for (const row of payload.records.users) {
      const columns = await columnsFor(db, "users");
      const existing = await db.prepare("SELECT id FROM users WHERE lower(email)=lower(?)").get(row.email);
      if (existing) { userIds.set(String(row.id), String(existing.id)); continue; }
      const data = { id: row.id, name: row.name, email: row.email, password_hash: hashPassword(randomBytes(32).toString("base64url")) };
      const entries = Object.entries(data).filter(([key]) => columns.has(key));
      await db.prepare(`INSERT INTO users (${entries.map(([key]) => key).join(",")}) VALUES (${entries.map(() => "?").join(",")})`)
        .run(...entries.map(([, value]) => value));
      userIds.set(String(row.id), String(row.id));
    }
    for (const row of payload.records.memberships) {
      const columns = await columnsFor(db, "memberships");
      const mappedUserId = userIds.get(String(row.user_id));
      if (!mappedUserId) throw new Error("Um vínculo de usuário não pôde ser associado com segurança.");
      const alreadyMember = await db.prepare("SELECT 1 FROM memberships WHERE user_id=? AND tenant_id=?").get(mappedUserId, tenantId);
      if (alreadyMember) continue;
      const data = { ...row, user_id: mappedUserId, tenant_id: tenantId };
      const entries = Object.entries(data).filter(([key]) => columns.has(key));
      await db.prepare(`INSERT INTO memberships (${entries.map(([key]) => key).join(",")}) VALUES (${entries.map(() => "?").join(",")})`)
        .run(...entries.map(([, value]) => value));
    }
    for (const table of insertOrder) {
      const rows = payload.records[table] || [];
      if (!rows.length) continue;
      const columns = await columnsFor(db, table);
      for (const row of rows) {
        const mapped = valuesForInsert(row, columns, payload.source.tenant.id, tenantId, userIds);
        const entries = Object.entries(mapped);
        await db.prepare(`INSERT INTO ${table} (${entries.map(([key]) => key).join(",")}) VALUES (${entries.map(() => "?").join(",")})`)
          .run(...entries.map(([, value]) => value));
      }
    }
    const auditColumns = await columnsFor(db, "audit_events");
    if (!["id", "tenant_id", "user_id", "action", "entity_id"].every((column) => auditColumns.has(column)))
      throw new Error("O destino não pode registrar a auditoria de importação; nada foi gravado.");
    const auditRecord: TransferRow = { id: randomUUID(), tenant_id: tenantId, user_id: actorUserId, action: "data_transfer.imported", entity_id: digest };
    if (auditColumns.has("created_at")) auditRecord.created_at = new Date().toISOString();
    const auditEntries = Object.entries(auditRecord);
    await db.prepare(`INSERT INTO audit_events (${auditEntries.map(([key]) => key).join(",")}) VALUES (${auditEntries.map(() => "?").join(",")})`)
      .run(...auditEntries.map(([, value]) => value));
    const verified: Record<string, number> = {};
    for (const table of TRANSFER_TABLES) {
      const expected = payload.records[table]?.length || 0;
      if (!expected) continue;
      const row = await db.prepare(`SELECT count(*) AS count FROM ${table} WHERE tenant_id=?`).get(tenantId);
      verified[table] = Number(row?.count || 0);
      const expectedAfterAudit = expected + (table === "audit_events" ? 1 : 0);
      if (verified[table] !== expectedAfterAudit) throw new Error(`A verificação da entidade ${table} não confere; a transação será revertida.`);
    }
    return { sourceWorkshop: payload.source.tenant.name, targetWorkshop: preview.targetWorkshop, counts: verified };
  };

  return "transaction" in db && typeof db.transaction === "function" ? db.transaction(run) : run();
}
