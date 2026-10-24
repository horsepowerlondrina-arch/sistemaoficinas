import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { DB } from "../db/database.js";
import { hashPassword } from "../auth/session.js";
import { createWorkshopTransfer } from "./dataTransferExport.js";
import {
  openTransferPackage,
  TRANSFER_TABLES,
  TRANSFER_TENANT_FIELDS,
  transferFileSha256,
} from "../../shared/transferPackage.js";
import type { TransferPayload, TransferRow, TransferTable } from "../../shared/transferPackage.js";

export type WorkshopImportMode = "empty" | "merge" | "replace";
const insertOrder: TransferTable[] = [
  "product_categories", "professionals", "suppliers", "catalog", "workshop_services",
  "labor_rates", "labor_commercial_rates", "customers", "vehicles", "expense_templates",
  "payment_settings", "card_rates", "cash_accounts", "orders", "order_items",
  "stock_invoices", "stock_invoice_products", "stock_movements", "receivables",
  "payment_installments", "cash_entries", "payables", "cash_movements", "service_aliases",
  "service_merge_history", "external_catalog_links", "external_captures", "service_times", "checklists",
  "checklist_photos", "document_revisions", "data_transfer_archived_documents", "audit_events",
];
const immutableOrFinancial = new Set<TransferTable>([
  "orders", "order_items", "stock_movements", "stock_invoices", "stock_invoice_products",
  "receivables", "cash_entries", "payment_installments", "cash_movements", "payables",
  "service_merge_history", "external_captures", "document_revisions", "data_transfer_archived_documents", "audit_events", "checklists", "checklist_photos",
]);
const retainedHistory = new Set<TransferTable>(["document_revisions", "data_transfer_archived_documents", "audit_events"]);
const BACKUP_RETENTION_DAYS = 30;
const MAX_WORKSHOP_BACKUPS = 5;
const safelyUpdatable = new Set<TransferTable>([
  "customers", "vehicles", "professionals", "suppliers", "product_categories", "catalog",
  "workshop_services", "labor_rates", "labor_commercial_rates", "payment_settings", "card_rates",
]);
const uniqueKeys: Partial<Record<TransferTable, string[][]>> = {
  vehicles: [["plate"]], catalog: [["sku"]], orders: [["number"]], receivables: [["order_id"]],
  cash_entries: [["installment_id"], ["receivable_id"]], payment_installments: [["receivable_id", "sequence"]],
  product_categories: [["name_key"]], suppliers: [["document"]],
  cash_movements: [["origin", "source_id"]], service_times: [["capture_id"]],
  service_aliases: [["alias_key"]], external_catalog_links: [["source", "external_key"]],
  external_captures: [["capture_id"]], stock_invoices: [["invoice_key"]],
  stock_invoice_products: [["supplier_document", "supplier_code", "unit"]],
  payables: [["template_id", "due_on"]], document_revisions: [["kind", "entity_id", "revision"]],
};
const primaryFields: Partial<Record<TransferTable, string[]>> = {
  card_rates: ["method", "installments"], labor_rates: ["porte_id"],
  labor_commercial_rates: ["category_id"], payment_settings: [], service_aliases: ["alias_key"], data_transfer_archived_documents: ["revision_id"],
};
const forbiddenUpdate = immutableOrFinancial;

type Action = "new" | "equal" | "update" | "conflict";
interface PlannedRow { table: TransferTable; row: TransferRow; sourceId: string; sourceHash: string; action: Action; targetId?: string; target?: TransferRow; reason?: string; }
interface EntitySummary { existing: number; source: number; new: number; equal: number; updates: number; conflicts: number; removed: number; }
interface Totals { stockUnits: number; inventoryValueCents: number; receivablesCents: number; payablesCents: number; cashReceivedCents: number; }
export interface TransferInspection {
  mode: WorkshopImportMode; confirmationId: string; sourceWorkshop: string; targetWorkshop: string;
  counts: Record<string, number>; entities: Record<string, EntitySummary>; issues: string[]; warnings: string[];
  canImport: boolean; before: Totals; after: Totals; backupRequired: boolean; publicLinksToRevoke: number;
  historicalDocumentsToArchive: number; historicalDocumentsToRestore: number;
}

function stable(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Buffer.isBuffer(value)) return JSON.stringify(value.toString("base64"));
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stable(object[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
function hash(value: unknown) { return createHash("sha256").update(stable(value)).digest("hex"); }
function normalizeMode(mode: WorkshopImportMode | undefined): WorkshopImportMode { return mode || "empty"; }
function recordKey(table: TransferTable, row: TransferRow): string {
  if (row.id !== undefined && row.id !== null) return String(row.id);
  const fields = primaryFields[table];
  if (!fields) throw new Error(`A entidade ${table} não possui uma identidade estável compatível.`);
  return stable(fields.map((field) => row[field]));
}
function targetLookupFields(table: TransferTable, row: TransferRow): string[] {
  if (row.id !== undefined && row.id !== null) return ["id"];
  return primaryFields[table] || [];
}
async function columnsFor(db: DB, table: string): Promise<Set<string>> {
  const rows = await db.prepare("SELECT column_name FROM information_schema.columns WHERE table_schema='horse_power' AND table_name=?").all(table);
  return new Set(rows.map((row) => String(row.column_name)));
}
function remapRow(row: TransferRow, sourceTenantId: string, targetTenantId: string, userIds: Map<string, string>): TransferRow {
  const mapped: TransferRow = {};
  for (const [key, value] of Object.entries(row)) {
    if (key === "tenant_id" && value === sourceTenantId) mapped[key] = targetTenantId;
    else if ((key === "user_id" || key === "issued_by" || key === "created_by") && typeof value === "string") {
      const targetUserId = userIds.get(value);
      if (!targetUserId) throw new Error("O pacote referencia uma identidade histórica sem correspondência; a importação foi cancelada.");
      mapped[key] = targetUserId;
    } else mapped[key] = value;
  }
  return mapped;
}
async function selectByFields(db: DB, table: string, tenantId: string, fields: string[], row: TransferRow): Promise<TransferRow | undefined> {
  if (!fields.length) return db.prepare(`SELECT * FROM ${table} WHERE tenant_id=? LIMIT 1`).get(tenantId);
  const where = ["tenant_id=?", ...fields.map((field) => `${field} IS NOT DISTINCT FROM ?`)];
  return db.prepare(`SELECT * FROM ${table} WHERE ${where.join(" AND ")} LIMIT 1`).get(tenantId, ...fields.map((field) => row[field]));
}
async function getTracking(db: DB, tenantId: string, payload: TransferPayload, table: string, sourceId: string) {
  return db.prepare(`SELECT source_hash,target_hash,target_record_id FROM data_transfer_records
    WHERE tenant_id=? AND source_application=? AND source_tenant_id=? AND table_name=? AND source_record_id=?`)
    .get(tenantId, payload.source.application, payload.source.tenant.id, table, sourceId);
}
async function existingTenantRows(db: DB, table: TransferTable, tenantId: string): Promise<TransferRow[]> {
  if (!(await columnsFor(db, table)).has("tenant_id")) return [];
  return db.prepare(`SELECT * FROM ${table} WHERE tenant_id=?`).all(tenantId);
}
async function userMapping(db: DB, payload: TransferPayload): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const source of payload.records.users) {
    if (!source.id || !source.email || !source.name) continue;
    const byId = await db.prepare("SELECT id,email FROM users WHERE id=?").get(source.id);
    if (byId && String(byId.email).toLowerCase() !== String(source.email).toLowerCase()) continue;
    const byEmail = await db.prepare("SELECT id FROM users WHERE lower(email)=lower(?)").get(source.email);
    map.set(String(source.id), String(byId?.id || byEmail?.id || source.id));
  }
  return map;
}
function sumTotals(rows: Record<string, TransferRow[]>): Totals {
  const sum = (table: string, field: string, filter?: (row: TransferRow) => boolean) => (rows[table] || []).reduce((total, row) => {
    if (filter && !filter(row)) return total;
    const value = Number(row[field] || 0);
    return total + (Number.isSafeInteger(value) ? value : 0);
  }, 0);
  const inventoryValueCents = (rows.catalog || []).reduce((total, row) => total + Number(row.cost || 0) * Number(row.stock || 0), 0);
  return {
    stockUnits: sum("catalog", "stock", (row) => row.kind === "product"),
    inventoryValueCents: Number.isSafeInteger(inventoryValueCents) ? inventoryValueCents : 0,
    receivablesCents: sum("receivables", "amount", (row) => row.status === "open"),
    payablesCents: sum("payables", "amount", (row) => row.status === "open"),
    cashReceivedCents: sum("cash_entries", "amount"),
  };
}

async function buildPlan(db: DB, tenantId: string, payload: TransferPayload, mode: WorkshopImportMode) {
  const issues: string[] = [], warnings: string[] = [];
  const existingByTable: Record<string, TransferRow[]> = {};
  const plans: PlannedRow[] = [];
  const entitySummaries: Record<string, EntitySummary> = {};
  const counts: Record<string, number> = {};
  const target = await db.prepare("SELECT id,name FROM tenants WHERE id=?").get(tenantId);
  if (!target) issues.push("A oficina de destino não foi encontrada na sessão autenticada.");
  if (payload.records.tenant.id !== payload.source.tenant.id) issues.push("O identificador da oficina no manifesto não confere.");

  const userColumns = await columnsFor(db, "users"), membershipColumns = await columnsFor(db, "memberships");
  if (!userColumns.size || !membershipColumns.size) issues.push("O destino não possui as tabelas de identidade esperadas.");
  const userIds = await userMapping(db, payload);
  for (const row of payload.records.users) {
    if (!row.id || !row.email || !row.name) { issues.push("Uma identidade histórica está incompleta."); continue; }
    const byId = await db.prepare("SELECT email FROM users WHERE id=?").get(row.id);
    if (byId && String(byId.email).toLowerCase() !== String(row.email).toLowerCase()) issues.push(`Conflito de identidade para ${String(row.email || row.id)}.`);
  }
  const importedUsers = new Set(payload.records.users.map((row) => String(row.id)));
  for (const membership of payload.records.memberships) {
    if (membership.tenant_id !== payload.source.tenant.id || !importedUsers.has(String(membership.user_id)))
      issues.push("Há um vínculo de identidade fora da oficina de origem ou sem usuário correspondente.");
    const mappedUser = userIds.get(String(membership.user_id));
    if (!mappedUser) { issues.push("Um vínculo não possui identidade de destino segura."); continue; }
    const found = await db.prepare("SELECT role FROM memberships WHERE user_id=? AND tenant_id=?").get(mappedUser, tenantId);
    if (found && found.role !== membership.role) issues.push("Conflito de permissão de uma conta existente; o importador não altera papéis.");
  }

  for (const table of TRANSFER_TABLES) {
    const sourceRows = payload.records[table] || [];
    counts[table] = sourceRows.length;
    const columns = await columnsFor(db, table);
    if (!columns.size) { if (sourceRows.length) issues.push(`A entidade ${table} não existe no schema de destino.`); continue; }
    if (!columns.has("tenant_id")) { if (sourceRows.length) issues.push(`A entidade ${table} não está isolada por oficina no destino.`); continue; }
    const existingRows = await existingTenantRows(db, table, tenantId);
    existingByTable[table] = existingRows;
    const summary: EntitySummary = { existing: existingRows.length, source: sourceRows.length, new: 0, equal: 0, updates: 0, conflicts: 0, removed: mode === "replace" && !retainedHistory.has(table) ? existingRows.length : 0 };
    entitySummaries[table] = summary;
    if (mode === "empty" && existingRows.length) issues.push(`A oficina de destino já possui registros em ${table}; escolha Mesclar ou Substituir.`);

    const packageKeys = new Set<string>();
    for (const sourceRow of sourceRows) {
      const keys = [recordKey(table, sourceRow), ...(uniqueKeys[table] || []).map((fields) => stable(fields.map((field) => sourceRow[field])))];
      for (const key of keys) {
        if (packageKeys.has(key)) { issues.push(`O pacote contém registros duplicados ou ambíguos em ${table}.`); summary.conflicts++; }
        packageKeys.add(key);
      }
    }

    for (const row of sourceRows) {
      if (row.tenant_id !== payload.source.tenant.id) { issues.push(`A entidade ${table} contém registro de outra oficina.`); summary.conflicts++; continue; }
      for (const key of Object.keys(row)) if (!columns.has(key)) { issues.push(`O destino não possui o campo ${table}.${key}; nenhuma importação será feita para evitar perda de dados.`); summary.conflicts++; }
      const sourceId = recordKey(table, row), sourceHash = hash(row);
      const mapped = remapRow(row, payload.source.tenant.id, tenantId, userIds);
      if (mode === "replace" && !retainedHistory.has(table)) {
        summary.new++;
        plans.push({ table, row, sourceId, sourceHash, action: "new" });
        continue;
      }
      const tracking = await getTracking(db, tenantId, payload, table, sourceId);
      let prior: TransferRow | undefined;
      let priorId = String(tracking?.target_record_id || "");
      if (tracking) prior = await selectByFields(db, table, tenantId, targetLookupFields(table, row), mapped);
      else if (row.id !== undefined) prior = await selectByFields(db, table, tenantId, ["id"], row);
      if (!prior && !tracking) {
        const lookupKeys = [...(uniqueKeys[table] || []), ...(primaryFields[table] ? [primaryFields[table]!] : [])];
        const seen = new Set<string>();
        for (const keys of lookupKeys) {
          const signature = keys.join("|");
          if (seen.has(signature)) continue;
          seen.add(signature);
          if (keys.every((key) => columns.has(key) && mapped[key] !== undefined && mapped[key] !== null)) {
            prior = await selectByFields(db, table, tenantId, keys, mapped);
            if (prior) break;
          }
        }
      }
      if (tracking && prior && safelyUpdatable.has(table)) {
        for (const keys of uniqueKeys[table] || []) {
          if (!keys.every((key) => columns.has(key) && mapped[key] !== undefined && mapped[key] !== null)) continue;
          const collision = await selectByFields(db, table, tenantId, keys, mapped);
          if (collision && recordKey(table, collision) !== recordKey(table, prior)) {
            prior = undefined;
            issues.push(`Atualização de ${table}/${sourceId} colidiria com uma chave única de outro registro.`);
            summary.conflicts++;
            plans.push({ table, row, sourceId, sourceHash, action: "conflict", reason: "Colisão de chave única." });
            break;
          }
        }
        if (!prior) continue;
      }
      if (mode === "replace" && retainedHistory.has(table)) {
        if (!prior) {
          summary.new++;
          plans.push({ table, row, sourceId, sourceHash, action: "new" });
        } else if (hash(prior) === hash(mapped)) {
          summary.equal++;
          plans.push({ table, row, sourceId, sourceHash, action: "equal", targetId: recordKey(table, prior), target: prior });
        } else {
          summary.conflicts++;
          issues.push(`Conflito de histórico imutável em ${table}/${sourceId}; o documento ou evento existente será preservado e a substituição foi bloqueada.`);
          plans.push({ table, row, sourceId, sourceHash, action: "conflict", targetId: recordKey(table, prior), target: prior });
        }
        continue;
      }
      if (!prior) {
        summary.new++;
        plans.push({ table, row, sourceId, sourceHash, action: "new" });
        continue;
      }
      priorId = recordKey(table, prior);
      const currentHash = hash(prior);
      if (tracking) {
        if (sourceHash === String(tracking.source_hash) && currentHash === String(tracking.target_hash)) {
          summary.equal++;
          plans.push({ table, row, sourceId, sourceHash, action: "equal", targetId: priorId, target: prior });
        } else if (sourceHash !== String(tracking.source_hash) && currentHash === String(tracking.target_hash) && safelyUpdatable.has(table)) {
          summary.updates++;
          plans.push({ table, row, sourceId, sourceHash, action: "update", targetId: priorId, target: prior });
        } else {
          summary.conflicts++;
          const reason = forbiddenUpdate.has(table) ? "Registro histórico ou financeiro alterado na origem; atualização bloqueada." : "O registro foi alterado localmente desde a última importação.";
          issues.push(`Conflito em ${table}/${sourceId}: ${reason}`);
          plans.push({ table, row, sourceId, sourceHash, action: "conflict", targetId: priorId, target: prior, reason });
        }
      } else if (currentHash === hash(mapped)) {
        summary.equal++;
        plans.push({ table, row, sourceId, sourceHash, action: "equal", targetId: priorId, target: prior });
      } else {
        summary.conflicts++;
        issues.push(`Conflito de ID ou chave única em ${table}/${sourceId}; resolva a ambiguidade antes de importar.`);
        plans.push({ table, row, sourceId, sourceHash, action: "conflict", targetId: priorId, target: prior });
      }
    }
  }

  if (mode === "merge") warnings.push("Dados cadastrais e financeiros atuais da oficina serão preservados; configurações da origem não substituirão as configurações locais.");
  if (mode === "replace") warnings.push("A substituição mantém contas, senhas, vínculos atuais, sessões, administração central e catálogo técnico global. Links públicos atuais serão revogados.");
  const tenantColumns = await columnsFor(db, "tenants");
  for (const key of Object.keys(payload.records.tenant)) if (key !== "id" && !tenantColumns.has(key)) issues.push(`A configuração da oficina contém campo sem correspondência: ${key}.`);

  const beforeRows = existingByTable;
  const afterRows: Record<string, TransferRow[]> = {};
  for (const table of TRANSFER_TABLES) {
    const current = [...(existingByTable[table] || [])];
    if (mode === "replace" && !retainedHistory.has(table)) { afterRows[table] = [...(payload.records[table] || [])].map((row) => remapRow(row, payload.source.tenant.id, tenantId, userIds)); continue; }
    if (mode === "replace" && retainedHistory.has(table)) {
      const merged = [...current];
      for (const decision of plans.filter((item) => item.table === table && item.action === "new")) merged.push(remapRow(decision.row, payload.source.tenant.id, tenantId, userIds));
      afterRows[table] = merged;
      continue;
    }
    if (mode === "empty") { afterRows[table] = [...(payload.records[table] || [])].map((row) => remapRow(row, payload.source.tenant.id, tenantId, userIds)); continue; }
    for (const plan of plans.filter((item) => item.table === table)) {
      if (plan.action === "new") current.push(remapRow(plan.row, payload.source.tenant.id, tenantId, userIds));
      else if (plan.action === "update" && plan.target) {
        const index = current.findIndex((row) => recordKey(table, row) === recordKey(table, plan.target!));
        if (index >= 0) current[index] = remapRow(plan.row, payload.source.tenant.id, tenantId, userIds);
      }
    }
    afterRows[table] = current;
  }
  const before = sumTotals(beforeRows), after = sumTotals(afterRows);
  let links: TransferRow | undefined;
  try { links = await db.prepare("SELECT count(*) AS count FROM public_shares WHERE tenant_id=? AND revoked=0").get(tenantId); }
  catch { links = { count: 0 }; }
  return { target, userIds, plans, issues: [...new Set(issues)].slice(0, 150), warnings, counts, entities: entitySummaries, before, after, publicLinksToRevoke: Number(links?.count || 0), existingByTable, afterRows };
}

function stateFingerprint(target: TransferRow | undefined, existing: Record<string, TransferRow[]>, tracking: TransferRow[]) {
  const state: Record<string, unknown> = { workshop: target || null, tracking };
  for (const table of TRANSFER_TABLES) state[table] = [...(existing[table] || [])].map(hash).sort();
  return hash(state);
}

async function inspectPayload(db: DB, tenantId: string, payload: TransferPayload, digest: string, mode: WorkshopImportMode): Promise<{ preview: TransferInspection; plan: Awaited<ReturnType<typeof buildPlan>> }> {
  const plan = await buildPlan(db, tenantId, payload, mode);
  let tracking: TransferRow[] = [];
  try { tracking = await db.prepare("SELECT source_application,source_tenant_id,table_name,source_record_id,source_hash,target_hash,target_record_id FROM data_transfer_records WHERE tenant_id=? ORDER BY source_application,source_tenant_id,table_name,source_record_id").all(tenantId); }
  catch { tracking = []; }
  const fingerprint = stateFingerprint(plan.target, plan.existingByTable, tracking);
  let historicalDocumentsToArchive = 0;
  let historicalDocumentsToRestore = 0;
  if (mode === "replace") {
    historicalDocumentsToArchive = Number((await db.prepare("SELECT count(*) AS count FROM document_revisions d WHERE tenant_id=? AND NOT EXISTS (SELECT 1 FROM data_transfer_archived_documents a WHERE a.tenant_id=d.tenant_id AND a.revision_id=d.id)").get(tenantId))?.count || 0);
    const sourceArchived = new Set((payload.records.data_transfer_archived_documents || []).map((row) => String(row.revision_id)));
    for (const row of payload.records.document_revisions || []) {
      if (sourceArchived.has(String(row.id))) continue;
      if (await db.prepare("SELECT 1 FROM data_transfer_archived_documents WHERE tenant_id=? AND revision_id=?").get(tenantId, row.id)) historicalDocumentsToRestore++;
    }
  }
  const confirmationId = createHash("sha256").update([digest, tenantId, mode, fingerprint].join(":"), "utf8").digest("hex");
  return { plan, preview: {
    mode, confirmationId, sourceWorkshop: payload.source.tenant.name, targetWorkshop: String(plan.target?.name || "Oficina de destino"),
    counts: plan.counts, entities: plan.entities, issues: plan.issues, warnings: plan.warnings,
    canImport: plan.issues.length === 0, before: plan.before, after: plan.after, backupRequired: mode === "replace", publicLinksToRevoke: plan.publicLinksToRevoke, historicalDocumentsToArchive, historicalDocumentsToRestore,
  } };
}

export async function previewWorkshopImport(db: DB, tenantId: string, file: Buffer, passphrase: string, requestedMode?: WorkshopImportMode) {
  const payload = openTransferPackage(file, passphrase);
  return (await inspectPayload(db, tenantId, payload, transferFileSha256(file), normalizeMode(requestedMode))).preview;
}

async function writeTracking(db: DB, tenantId: string, payload: TransferPayload, table: TransferTable, sourceId: string, sourceHash: string, target: TransferRow) {
  const targetId = recordKey(table, target);
  await db.prepare(`INSERT INTO data_transfer_records(tenant_id,source_application,source_tenant_id,table_name,source_record_id,source_hash,target_record_id,target_hash,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(tenant_id,source_application,source_tenant_id,table_name,source_record_id)
    DO UPDATE SET source_hash=excluded.source_hash,target_record_id=excluded.target_record_id,target_hash=excluded.target_hash,updated_at=excluded.updated_at`)
    .run(tenantId, payload.source.application, payload.source.tenant.id, table, sourceId, sourceHash, targetId, hash(target), new Date().toISOString());
}

async function insertMappedRow(db: DB, table: TransferTable, mapped: TransferRow) {
  const columns = await columnsFor(db, table);
  const entries = Object.entries(mapped).filter(([key]) => columns.has(key));
  if (!entries.length) throw new Error(`A entidade ${table} não possui colunas importáveis.`);
  await db.prepare(`INSERT INTO ${table} (${entries.map(([key]) => key).join(",")}) VALUES (${entries.map(() => "?").join(",")})`)
    .run(...entries.map(([, value]) => value));
  const identity = targetLookupFields(table, mapped);
  const inserted = await selectByFields(db, table, String(mapped.tenant_id), identity, mapped);
  if (!inserted) throw new Error(`Não foi possível verificar o registro criado em ${table}.`);
  return inserted;
}

async function updateMappedRow(db: DB, table: TransferTable, mapped: TransferRow, old: TransferRow) {
  if (!safelyUpdatable.has(table)) throw new Error(`Atualização bloqueada para a entidade histórica ${table}.`);
  const columns = await columnsFor(db, table), fields = Object.entries(mapped).filter(([key]) => key !== "id" && key !== "tenant_id" && columns.has(key));
  const identity = targetLookupFields(table, old);
  if (!identity.length) throw new Error(`Não há chave estável para atualizar ${table}.`);
  const where = ["tenant_id=?", ...identity.map((field) => `${field} IS NOT DISTINCT FROM ?`)];
  const values = [...fields.map(([, value]) => value), mapped.tenant_id, ...identity.map((field) => old[field])];
  const result = await db.prepare(`UPDATE ${table} SET ${fields.map(([key]) => `${key}=?`).join(",")} WHERE ${where.join(" AND ")}`).run(...values);
  if (Number(result.changes) !== 1) throw new Error(`O registro ${table} foi alterado durante a importação; nenhuma alteração será mantida.`);
  const updated = await selectByFields(db, table, String(mapped.tenant_id), identity, old);
  if (!updated) throw new Error(`Não foi possível conferir a atualização de ${table}.`);
  return updated;
}

async function importUsersAndMemberships(db: DB, tenantId: string, payload: TransferPayload) {
  const userColumns = await columnsFor(db, "users"), membershipColumns = await columnsFor(db, "memberships");
  const userIds = new Map<string, string>();
  for (const row of payload.records.users) {
    const byId = await db.prepare("SELECT id,email FROM users WHERE id=?").get(row.id);
    if (byId && String(byId.email).toLowerCase() !== String(row.email).toLowerCase()) throw new Error("Conflito de identidade entre contas; nenhuma alteração foi aplicada.");
    const existing = byId || await db.prepare("SELECT id FROM users WHERE lower(email)=lower(?)").get(row.email);
    if (existing) { userIds.set(String(row.id), String(existing.id)); continue; }
    const data = { id: row.id, name: row.name, email: row.email, password_hash: hashPassword(randomBytes(32).toString("base64url")) };
    const entries = Object.entries(data).filter(([key]) => userColumns.has(key));
    await db.prepare(`INSERT INTO users (${entries.map(([key]) => key).join(",")}) VALUES (${entries.map(() => "?").join(",")})`).run(...entries.map(([, value]) => value));
    userIds.set(String(row.id), String(row.id));
  }
  for (const row of payload.records.memberships) {
    const mappedUser = userIds.get(String(row.user_id));
    if (!mappedUser) throw new Error("Um vínculo de usuário não pôde ser associado com segurança.");
    const alreadyMember = await db.prepare("SELECT role FROM memberships WHERE user_id=? AND tenant_id=?").get(mappedUser, tenantId);
    if (alreadyMember) {
      if (alreadyMember.role !== row.role) throw new Error("Conflito de permissão em conta existente; papéis não são substituídos.");
      continue;
    }
    const data = { ...row, user_id: mappedUser, tenant_id: tenantId };
    const entries = Object.entries(data).filter(([key]) => membershipColumns.has(key));
    await db.prepare(`INSERT INTO memberships (${entries.map(([key]) => key).join(",")}) VALUES (${entries.map(() => "?").join(",")})`).run(...entries.map(([, value]) => value));
  }
  return userIds;
}

export async function importWorkshopPackage(
  db: DB, tenantId: string, file: Buffer, passphrase: string, confirmationId: string, actorUserId: string,
  requestedMode?: WorkshopImportMode, workshopConfirmation?: string,
) {
  const payload = openTransferPackage(file, passphrase), digest = transferFileSha256(file), mode = normalizeMode(requestedMode);
  const run = async () => {
    await db.lockTenantMutations?.(tenantId);
    const { preview, plan } = await inspectPayload(db, tenantId, payload, digest, mode);
    if (!confirmationId || confirmationId !== preview.confirmationId) throw new Error("Os dados ou a prévia mudaram. Gere uma nova prévia antes de confirmar.");
    if (!preview.canImport) throw new Error(preview.issues[0] || "A prévia encontrou impedimentos.");
    if (mode === "replace" && workshopConfirmation !== preview.targetWorkshop)
      throw new Error("Para substituir, digite o nome exato da oficina de destino exibido na prévia.");

    let backupId: string | undefined;
    if (mode === "replace") {
      const backup = await createWorkshopTransfer(db, tenantId, passphrase);
      const checked = openTransferPackage(backup, passphrase);
      if (transferFileSha256(backup).length !== 64 || checked.source.tenant.id !== tenantId || checked.records.tenant.id !== tenantId)
        throw new Error("A cópia de segurança não passou na validação; a substituição foi bloqueada.");
      for (const table of TRANSFER_TABLES) {
        const actual = (await db.prepare(`SELECT count(*) AS count FROM ${table} WHERE tenant_id=?`).get(tenantId))?.count;
        if (Number(actual || 0) !== (checked.records[table]?.length || 0)) throw new Error(`A cópia de segurança não confere na entidade ${table}; a substituição foi bloqueada.`);
      }
      backupId = randomUUID();
      const createdAt = new Date();
      const expiresAt = new Date(createdAt.getTime() + BACKUP_RETENTION_DAYS * 86400000).toISOString();
      await db.prepare("INSERT INTO data_transfer_backups(id,tenant_id,created_by,package_sha256,package,expires_at) VALUES(?,?,?,?,?,?)")
        .run(backupId, tenantId, actorUserId, transferFileSha256(backup), backup, expiresAt);
      const stored = await db.prepare("SELECT package_sha256,package FROM data_transfer_backups WHERE id=? AND tenant_id=?").get(backupId, tenantId);
      if (!stored || String(stored.package_sha256) !== transferFileSha256(backup) || transferFileSha256(Buffer.from(stored.package)) !== transferFileSha256(backup))
        throw new Error("A cópia de segurança persistida não foi validada; a substituição foi bloqueada.");
      await pruneWorkshopTransferBackups(db, tenantId, createdAt.toISOString());
    }

    if (mode === "replace") {
      const oldDocuments = await db.prepare("SELECT id,kind,entity_id,revision FROM document_revisions WHERE tenant_id=?").all(tenantId);
      for (const document of oldDocuments) {
        await db.prepare("INSERT OR IGNORE INTO data_transfer_archived_documents(tenant_id,revision_id,backup_id,kind,entity_id,revision,archived_at) VALUES(?,?,?,?,?,?,?)")
          .run(tenantId, document.id, backupId, document.kind, document.entity_id, document.revision, new Date().toISOString());
      }
      const sourceArchived = new Set((payload.records.data_transfer_archived_documents || []).map((row) => String(row.revision_id)));
      for (const document of payload.records.document_revisions || []) {
        if (!sourceArchived.has(String(document.id)))
          await db.prepare("DELETE FROM data_transfer_archived_documents WHERE tenant_id=? AND revision_id=?").run(tenantId, document.id);
      }
      await db.prepare("UPDATE public_shares SET revoked=1 WHERE tenant_id=? AND revoked=0").run(tenantId);
      for (const table of [...TRANSFER_TABLES].reverse()) {
        if (retainedHistory.has(table)) continue;
        await db.prepare(`DELETE FROM ${table} WHERE tenant_id=?`).run(tenantId);
      }
      await db.prepare("DELETE FROM data_transfer_records WHERE tenant_id=?").run(tenantId);
    }

    if (mode !== "merge") {
      const tenant = payload.records.tenant, columns = await columnsFor(db, "tenants");
      const values = Object.entries(tenant).filter(([key]) => key !== "id" && TRANSFER_TENANT_FIELDS.includes(key as (typeof TRANSFER_TENANT_FIELDS)[number]) && columns.has(key));
      if (values.length) await db.prepare(`UPDATE tenants SET ${values.map(([key]) => `${key}=?`).join(",")} WHERE id=?`).run(...values.map(([, value]) => value), tenantId);
    }

    const userIds = await importUsersAndMemberships(db, tenantId, payload);
    const verified: Record<string, number> = {};
    for (const table of insertOrder) {
      const rows = payload.records[table] || [];
      for (const decision of plan.plans.filter((item) => item.table === table)) {
        if (decision.action === "conflict") throw new Error(`Conflito em ${table}/${decision.sourceId}; nenhuma alteração foi mantida.`);
        const mapped = remapRow(decision.row, payload.source.tenant.id, tenantId, userIds);
        if (decision.action === "new") {
          const inserted = await insertMappedRow(db, table, mapped);
          await writeTracking(db, tenantId, payload, table, decision.sourceId, decision.sourceHash, inserted);
        } else if (decision.action === "equal") {
          await writeTracking(db, tenantId, payload, table, decision.sourceId, decision.sourceHash, decision.target!);
        } else if (decision.action === "update") {
          const updated = await updateMappedRow(db, table, mapped, decision.target!);
          await writeTracking(db, tenantId, payload, table, decision.sourceId, decision.sourceHash, updated);
        }
      }
      const expectedRows = Number(plan.entities[table]?.existing || 0) - Number(plan.entities[table]?.removed || 0)
        + Number(plan.entities[table]?.new || 0);
      const actual = await db.prepare(`SELECT count(*) AS count FROM ${table} WHERE tenant_id=?`).get(tenantId);
      verified[table] = Number(actual?.count || 0);
      if (verified[table] < expectedRows) throw new Error(`A conferência de ${table} falhou; a transação será revertida.`);
    }
    const auditColumns = await columnsFor(db, "audit_events");
    const action = mode === "replace" ? "data_transfer.replaced" : mode === "merge" ? "data_transfer.merged" : "data_transfer.imported";
    if (!["id", "tenant_id", "user_id", "action", "entity_id"].every((column) => auditColumns.has(column))) throw new Error("O destino não pode registrar a auditoria; nenhuma alteração será mantida.");
    const audit: TransferRow = { id: randomUUID(), tenant_id: tenantId, user_id: actorUserId, action, entity_id: digest };
    if (auditColumns.has("created_at")) audit.created_at = new Date().toISOString();
    const entries = Object.entries(audit);
    await db.prepare(`INSERT INTO audit_events (${entries.map(([key]) => key).join(",")}) VALUES (${entries.map(() => "?").join(",")})`).run(...entries.map(([, value]) => value));
    return { sourceWorkshop: payload.source.tenant.name, targetWorkshop: preview.targetWorkshop, mode, counts: verified, backupId };
  };
  return "transaction" in db && typeof db.transaction === "function" ? db.transaction(run) : run();
}

export async function pruneWorkshopTransferBackups(db: DB, tenantId: string, now = new Date().toISOString()) {
  await db.prepare("DELETE FROM data_transfer_backups WHERE tenant_id=? AND expires_at<?").run(tenantId, now);
  await db.prepare("DELETE FROM data_transfer_backups WHERE tenant_id=? AND id IN (SELECT id FROM (SELECT id,row_number() OVER(ORDER BY created_at DESC,id) AS backup_rank FROM data_transfer_backups WHERE tenant_id=?) ranked WHERE backup_rank>?)")
    .run(tenantId, tenantId, MAX_WORKSHOP_BACKUPS);
}
export async function listWorkshopTransferBackups(db: DB, tenantId: string) {
  await pruneWorkshopTransferBackups(db, tenantId);
  return db.prepare("SELECT id,package_sha256,created_at,expires_at FROM data_transfer_backups WHERE tenant_id=? ORDER BY created_at DESC").all(tenantId);
}
export async function getWorkshopTransferBackup(db: DB, tenantId: string, id: string) {
  await pruneWorkshopTransferBackups(db, tenantId);
  const backup = await db.prepare("SELECT package_sha256,package FROM data_transfer_backups WHERE tenant_id=? AND id=?").get(tenantId, id);
  if (!backup) return undefined;
  const packageBuffer = Buffer.from(backup.package);
  if (transferFileSha256(packageBuffer) !== backup.package_sha256) throw new Error("A cópia de segurança armazenada falhou na validação de integridade.");
  return packageBuffer;
}
