import { createHash } from "node:crypto";
import type { DB } from "../db/database.js";
import {
  openTransferPackage,
  TRANSFER_TABLES,
  TRANSFER_TENANT_FIELDS,
  transferFileSha256,
} from "../../shared/transferPackage.js";
import type { TransferPayload, TransferRow, TransferTable } from "../../shared/transferPackage.js";

export type TransferVerificationMode = "empty" | "merge" | "replace";
export type TransferVerificationStatus = "corresponding" | "transformed" | "divergent" | "not-verifiable";

const AUTHOR_FIELDS = new Set(["user_id", "issued_by", "created_by"]);
const IDENTITY_FIELDS: Partial<Record<TransferTable, string[]>> = {
  card_rates: ["method", "installments"],
  labor_rates: ["porte_id"],
  labor_commercial_rates: ["category_id"],
  payment_settings: [],
  service_aliases: ["alias_key"],
  external_catalog_links: ["source", "external_key"],
  data_transfer_archived_documents: ["revision_id"],
};
const UNIQUE_FIELDS: Partial<Record<TransferTable, string[][]>> = {
  vehicles: [["plate"]],
  catalog: [["sku"]],
  orders: [["number"]],
  receivables: [["order_id"]],
  cash_entries: [["installment_id"]],
  payment_installments: [["receivable_id", "sequence"]],
  product_categories: [["name_key"]],
  suppliers: [["document"]],
  cash_movements: [["origin", "source_id"]],
  service_times: [["capture_id"]],
  service_aliases: [["alias_key"]],
  external_catalog_links: [["source", "external_key"]],
  external_captures: [["capture_id"]],
  stock_invoices: [["invoice_key"]],
  stock_invoice_products: [["supplier_document", "supplier_code", "unit"]],
  payables: [["template_id", "due_on"]],
  document_revisions: [["kind", "entity_id", "revision"]],
};
const MONEY_FIELDS: Partial<Record<TransferTable, string[]>> = {
  catalog: ["cost", "price"],
  orders: ["discount", "total"],
  order_items: ["price", "cost"],
  stock_invoices: ["subtotal", "freight_total", "total"],
  stock_invoice_products: ["unit_cost", "total_cost", "freight_total"],
  receivables: ["amount", "gross_total", "fee_total", "net_total"],
  payment_installments: ["principal", "interest", "gross", "fee", "net"],
  cash_entries: ["amount", "gross_amount", "fee_amount"],
  payables: ["amount"],
  cash_movements: ["amount"],
};
const MAX_DETAIL_ROWS = 100;
const MAX_VERIFY_ROWS = 250_000;

type EntityVerification = {
  sourceCount: number;
  destinationRows: number | null;
  destinationMatched: number;
  corresponding: number;
  transformed: number;
  divergent: number;
  missing: number;
  additionalDestination: number;
  notVerifiable: number;
  unrelatedExistingIgnored: number;
  changedSinceImport: number;
  records: Array<{ recordId?: string; status: TransferVerificationStatus; differingFields?: string[]; transformedFields?: string[]; reason?: string; changedSinceImport?: boolean }>;
  omittedDetails: number;
  financialCents: Record<string, { source: string; destination: string; difference: string }>;
};

export interface TransferVerificationReport {
  mode: TransferVerificationMode;
  sourceWorkshop: string;
  targetWorkshop: string;
  packageSha256: string;
  generatedAt: string;
  overall: TransferVerificationStatus;
  entities: Record<string, EntityVerification>;
  workshopConfiguration: { status: TransferVerificationStatus; differingFields: string[]; transformedFields: string[]; notVerifiableFields: string[] };
  stock: { sourceProductUnits: string; destinationProductUnits: string; differenceUnits: string; sourceMovementUnits: string; destinationMovementUnits: string; differenceMovementUnits: string; sourceInventoryValueCents: string; destinationInventoryValueCents: string; differenceInventoryValueCents: string };
  financial: Record<string, { sourceCents: string; destinationCents: string; differenceCents: string }>;
  referentialIntegrity: { checked: number; divergent: number; notVerifiable: number };
  historicalDocuments: { sourceActive: number; sourceArchived: number; destinationActive: number; destinationArchived: number; missing: number; preservedDestinationArchives: number };
  backups: { existing: number; integrityValid: number; integrityInvalid: number };
  policy: { usersExcluded: number; membershipsExcluded: number; auditEventsExcluded: number; authorsRemapped: number; tenantIdRemapped: true };
  notes: string[];
}

function decimalCanonical(value: string): string {
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const [wholeRaw, fractionRaw = ""] = unsigned.split(".");
  const whole = wholeRaw.replace(/^0+(?=\d)/, "") || "0";
  const fraction = fractionRaw.replace(/0+$/, "");
  const normalized = fraction ? `${whole}.${fraction}` : whole;
  return normalized === "0" ? "0" : negative ? `-${normalized}` : normalized;
}
function canonical(value: unknown): string {
  if (value instanceof Date) return "date:" + value.toISOString();
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2}))$/.test(value)) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return "date:" + parsed.toISOString();
  }
  if (Buffer.isBuffer(value)) return "buffer:" + value.toString("base64");
  if (typeof value === "number" && Number.isFinite(value)) return "numeric:" + decimalCanonical(String(value));
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return "{" + Object.keys(object).sort().map((key) => JSON.stringify(key) + ":" + canonical(object[key])).join(",") + "}";
  }
  return JSON.stringify(value) ?? "null";
}
function equivalent(left: unknown, right: unknown): boolean {
  const numericText = /^-?\d+(?:\.\d+)?$/;
  if (typeof left === "number" && typeof right === "string" && numericText.test(right)) return decimalCanonical(String(left)) === decimalCanonical(right);
  if (typeof right === "number" && typeof left === "string" && numericText.test(left)) return decimalCanonical(left) === decimalCanonical(String(right));
  return canonical(left) === canonical(right);
}
function recordId(table: TransferTable, row: TransferRow): string | undefined {
  if (row.id !== undefined && row.id !== null) return String(row.id);
  const fields = IDENTITY_FIELDS[table];
  if (!fields) return undefined;
  return createHash("sha256").update(canonical(fields.map((field) => row[field]))).digest("hex").slice(0, 16);
}
function identityValue(table: TransferTable, row: TransferRow): string | undefined {
  if (row.id !== undefined && row.id !== null) return String(row.id);
  const fields = IDENTITY_FIELDS[table];
  if (!fields) return undefined;
  return stable(fields.map((field) => row[field]));
}
async function columnsFor(db: DB, table: string): Promise<Set<string>> {
  if (!/^[a-z][a-z0-9_]*$/.test(table)) return new Set();
  const rows = await db.prepare("SELECT column_name FROM information_schema.columns WHERE table_schema='horse_power' AND table_name=?").all(table);
  return new Set(rows.map((row) => String(row.column_name)));
}
async function rowsFor(db: DB, table: TransferTable, tenantId: string, columns: Set<string>): Promise<TransferRow[]> {
  if (!columns.has("tenant_id")) return [];
  return db.prepare(`SELECT * FROM ${table} WHERE tenant_id=?`).all(tenantId);
}
function findByUniqueKeys(table: TransferTable, source: TransferRow, candidates: TransferRow[]): TransferRow[] {
  const keys = UNIQUE_FIELDS[table] || [];
  const matches = new Map<string, TransferRow>();
  for (const fields of keys) {
    if (!fields.every((field) => source[field] !== null && source[field] !== undefined)) continue;
    for (const candidate of candidates) {
      if (fields.every((field) => equivalent(candidate[field], source[field]))) {
        matches.set(identityValue(table, candidate) || canonical(candidate), candidate);
      }
    }
  }
  return [...matches.values()];
}
export function compareTransferRecord(table: TransferTable, source: TransferRow, target: TransferRow, sourceTenantId: string, targetTenantId: string, targetColumns: Set<string>) {
  const differingFields: string[] = [];
  const transformedFields: string[] = [];
  const notVerifiableFields: string[] = [];
  if (String(source.tenant_id || "") !== sourceTenantId || String(target.tenant_id || "") !== targetTenantId) differingFields.push("tenant_id");
  const ignored = new Set(["tenant_id", ...AUTHOR_FIELDS]);
  if (table === "data_transfer_archived_documents") ignored.add("backup_id");
  for (const field of Object.keys(source).sort()) {
    if (ignored.has(field)) {
      if (AUTHOR_FIELDS.has(field) && source[field] !== null && source[field] !== undefined && source[field] !== "") transformedFields.push(field);
      if (table === "data_transfer_archived_documents" && field === "backup_id" && source[field] !== null && source[field] !== undefined && source[field] !== "") transformedFields.push(field);
      continue;
    }
    if (!targetColumns.has(field)) { notVerifiableFields.push(field); continue; }
    if (!(field in target)) { notVerifiableFields.push(field); continue; }
    if (!equivalent(source[field], target[field])) differingFields.push(field);
  }
  const comparableTargetOnly = Object.keys(target).filter((field) => !ignored.has(field) && !(field in source)).sort();
  notVerifiableFields.push(...comparableTargetOnly);
  return { differingFields: [...new Set(differingFields)], transformedFields: [...new Set(transformedFields)], notVerifiableFields: [...new Set(notVerifiableFields)] };
}
function cents(value: unknown): bigint | undefined {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isSafeInteger(value)) return BigInt(value);
  if (typeof value === "string" && /^-?\d+$/.test(value)) return BigInt(value);
  return undefined;
}
function getSummary(): EntityVerification {
  return { sourceCount: 0, destinationRows: 0, destinationMatched: 0, corresponding: 0, transformed: 0, divergent: 0, missing: 0, additionalDestination: 0, notVerifiable: 0, unrelatedExistingIgnored: 0, changedSinceImport: 0, records: [], omittedDetails: 0, financialCents: {} };
}
function addDetail(summary: EntityVerification, detail: EntityVerification["records"][number]) {
  if (summary.records.length < MAX_DETAIL_ROWS) summary.records.push(detail);
  else summary.omittedDetails++;
}
function applyStatus(summary: EntityVerification, status: TransferVerificationStatus) {
  if (status === "corresponding") summary.corresponding++;
  else if (status === "transformed") summary.transformed++;
  else if (status === "divergent") summary.divergent++;
  else summary.notVerifiable++;
}
function moneyDifference(sourceRows: TransferRow[], targetRows: TransferRow[], table: TransferTable, targetColumns: Set<string>) {
  const result: EntityVerification["financialCents"] = {};
  for (const field of MONEY_FIELDS[table] || []) {
    if (!targetColumns.has(field)) continue;
    let source = 0n, target = 0n, valid = true;
    for (const row of sourceRows) { const value = cents(row[field]); if (value === undefined) { valid = false; break; } source += value; }
    if (!valid) continue;
    for (const row of targetRows) { const value = cents(row[field]); if (value === undefined) { valid = false; break; } target += value; }
    if (!valid) continue;
    result[field] = { source: source.toString(), destination: target.toString(), difference: (target - source).toString() };
  }
  return result;
}
function tableTotal(rows: TransferRow[], field: string, predicate?: (row: TransferRow) => boolean): bigint {
  return rows.reduce((total, row) => {
    if (predicate && !predicate(row)) return total;
    const value = cents(row[field]);
    return value === undefined ? total : total + value;
  }, 0n);
}
function sumMoneyByField(entities: Record<string, EntityVerification>) {
  const totals: Record<string, { sourceCents: string; destinationCents: string; differenceCents: string }> = {};
  for (const [table, entity] of Object.entries(entities)) {
    for (const [field, item] of Object.entries(entity.financialCents)) {
      const key = `${table}.${field}`;
      totals[key] = { sourceCents: item.source, destinationCents: item.destination, differenceCents: item.difference };
    }
  }
  return totals;
}
function pickOverall(states: TransferVerificationStatus[]): TransferVerificationStatus {
  if (states.includes("divergent")) return "divergent";
  if (states.includes("not-verifiable")) return "not-verifiable";
  if (states.includes("transformed")) return "transformed";
  return "corresponding";
}
type ForeignKeyPair = { table_name: string; column_name: string; foreign_table_name: string; foreign_column_name: string; constraint_name: string };
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
function recordHash(value: unknown) {
  return createHash("sha256").update(stable(value)).digest("hex");
}

export async function verifyWorkshopImport(
  db: DB,
  tenantId: string,
  file: Buffer,
  passphrase: string,
  actorUserId: string,
  mode: TransferVerificationMode,
  now = new Date().toISOString(),
): Promise<TransferVerificationReport> {
  const payload = openTransferPackage(file, passphrase);
  const target = await db.prepare("SELECT id,name FROM tenants WHERE id=?").get(tenantId);
  if (!target) throw new Error("A oficina autenticada não foi encontrada.");
  const membership = await db.prepare("SELECT role FROM memberships WHERE tenant_id=? AND user_id=?").get(tenantId, actorUserId);
  if (!membership || membership.role !== "owner") throw new Error("Somente o proprietário pode conferir dados importados.");

  const rowCount = Object.values(payload.records).reduce((total, rows) => total + (Array.isArray(rows) ? rows.length : 0), 1);
  if (rowCount > MAX_VERIFY_ROWS) throw new Error("O pacote excede o limite de registros para conferência online.");
  if (payload.records.tenant.id !== payload.source.tenant.id) throw new Error("O identificador da oficina no manifesto não confere.");

  const sourceTenantId = payload.source.tenant.id;
  const sourceRowsByTable: Record<string, TransferRow[]> = {};
  const destinationRowsByTable: Record<string, TransferRow[]> = {};
  const destinationColumns: Record<string, Set<string>> = {};
  const trackingByTable: Record<string, TransferRow[]> = {};
  const entities: Record<string, EntityVerification> = {};
  for (const table of TRANSFER_TABLES) {
    const sourceRows = payload.records[table] || [];
    sourceRowsByTable[table] = sourceRows;
    const columns = await columnsFor(db, table);
    destinationColumns[table] = columns;
    if (columns.size && columns.has("tenant_id")) destinationRowsByTable[table] = await rowsFor(db, table, tenantId, columns);
    else destinationRowsByTable[table] = [];
    const summary = getSummary();
    summary.sourceCount = sourceRows.length;
    summary.destinationRows = table === "audit_events" ? null : destinationRowsByTable[table].length;
    entities[table] = summary;
    if (table === "audit_events") continue;
    try {
      trackingByTable[table] = await db.prepare(`SELECT source_record_id,target_record_id,source_hash,target_hash FROM data_transfer_records
        WHERE tenant_id=? AND source_application=? AND source_tenant_id=? AND table_name=?`)
        .all(tenantId, payload.source.application, sourceTenantId, table);
    } catch {
      trackingByTable[table] = [];
    }
  }

  const matchedRows = new Map<string, Array<{ source: TransferRow; target: TransferRow }>>();
  let authorMappings = 0;
  for (const table of TRANSFER_TABLES) {
    const summary = entities[table], sourceRows = sourceRowsByTable[table] || [];
    if (table === "audit_events") {
      summary.notVerifiable = 0;
      continue;
    }
    const columns = destinationColumns[table];
    const existingRows = destinationRowsByTable[table] || [];
    if (!columns.size || !columns.has("tenant_id")) {
      summary.notVerifiable = sourceRows.length;
      for (const row of sourceRows) addDetail(summary, { recordId: recordId(table, row), status: "not-verifiable", reason: "A tabela não existe no destino ou não está isolada por oficina." });
      continue;
    }
    const trackings = trackingByTable[table] || [];
    const trackingMap = new Map(trackings.map((row) => [String(row.source_record_id), row]));
    const packageKeys = new Set<string>();
    const matchedTargets = new Set<string>();
    const matchedForIntegrity: Array<{ source: TransferRow; target: TransferRow }> = [];
    for (const source of sourceRows) {
      const key = identityValue(table, source);
      const id = recordId(table, source);
      if (key === undefined) {
        summary.notVerifiable++;
        addDetail(summary, { recordId: id, status: "not-verifiable", reason: "O registro não possui chave de identidade estável." });
        continue;
      }
      if (packageKeys.has(key)) {
        summary.divergent++;
        addDetail(summary, { recordId: id, status: "divergent", reason: "O pacote contém identidade duplicada para esta entidade." });
        continue;
      }
      packageKeys.add(key);
      if (String(source.tenant_id || "") !== sourceTenantId) {
        summary.divergent++;
        addDetail(summary, { recordId: id, status: "divergent", differingFields: ["tenant_id"], reason: "O pacote contém registro associado a outra oficina." });
        continue;
      }
      const tracking = trackingMap.get(key);
      let candidates: TransferRow[] = [];
      if (tracking) {
        candidates = existingRows.filter((row) => identityValue(table, row) === String(tracking.target_record_id));
      } else {
        candidates = existingRows.filter((row) => identityValue(table, row) === key);
        if (!candidates.length) candidates = findByUniqueKeys(table, source, existingRows);
      }
      const uniqueCandidates = [...new Map(candidates.map((row) => [identityValue(table, row) || canonical(row), row])).values()];
      if (!uniqueCandidates.length) {
        summary.missing++;
        addDetail(summary, { recordId: id, status: "divergent", reason: tracking ? "O registro rastreado não existe mais nesta oficina." : "Não foi encontrado registro correspondente no destino." });
        continue;
      }
      if (uniqueCandidates.length > 1) {
        summary.notVerifiable++;
        addDetail(summary, { recordId: id, status: "not-verifiable", reason: "Mais de um registro pode corresponder; a associação é ambígua." });
        continue;
      }
      const destination = uniqueCandidates[0];
      const destinationKey = identityValue(table, destination) || canonical(destination);
      matchedTargets.add(destinationKey);
      summary.destinationMatched++;
      matchedForIntegrity.push({ source, target: destination });
      const comparison = compareTransferRecord(table, source, destination, sourceTenantId, tenantId, columns);
      authorMappings += comparison.transformedFields.filter((field) => AUTHOR_FIELDS.has(field)).length;
      const storedSourceHash = String(tracking?.source_hash || "");
      const storedTargetHash = String(tracking?.target_hash || "");
      const sourceVersionChanged = Boolean(tracking && storedSourceHash && storedSourceHash !== recordHash(source));
      const changedSinceImport = Boolean(tracking && storedTargetHash && storedTargetHash !== recordHash(destination));
      let status: TransferVerificationStatus;
      let reason: string | undefined;
      if (comparison.differingFields.length) {
        status = "divergent";
        reason = "Os valores atuais diferem do pacote nos campos indicados.";
      } else if (comparison.notVerifiableFields.length || !tracking) {
        status = "not-verifiable";
        reason = !tracking ? "Não há rastreamento de origem suficiente para provar que este registro veio deste pacote." : "O pacote e o destino não oferecem os mesmos campos para comparação.";
      } else if (sourceVersionChanged) {
        status = "not-verifiable";
        reason = "O pacote tem uma versão diferente da importação rastreada; os dados atuais coincidem, mas não é possível provar qual importação aplicou essa versão.";
      } else if (comparison.transformedFields.length) {
        status = "transformed";
        reason = "A política de transferência remapeia a oficina/autoria ou a referência do backup.";
      } else {
        status = "corresponding";
      }
      applyStatus(summary, status);
      if (changedSinceImport) summary.changedSinceImport++;
      if (status !== "corresponding" || changedSinceImport || sourceVersionChanged) addDetail(summary, {
        recordId: id, status, differingFields: comparison.differingFields.length ? comparison.differingFields : undefined,
        transformedFields: comparison.transformedFields.length ? comparison.transformedFields : undefined,
        reason: reason || (changedSinceImport ? "O hash do destino difere do último estado rastreado; os campos comparáveis coincidem com o pacote." : undefined),
        changedSinceImport,
      });
    }
    matchedRows.set(table, matchedForIntegrity);
      const packageSourceIds = new Set(packageKeys);
    const previouslyTrackedExtra = trackings.filter((row) => !packageSourceIds.has(String(row.source_record_id)));
    const trackedTargets = new Set(previouslyTrackedExtra.map((row) => String(row.target_record_id)));
    for (const row of existingRows) {
      const key = identityValue(table, row) || canonical(row);
      if (matchedTargets.has(key)) continue;
      if (trackedTargets.has(key) || trackedTargets.has(String(identityValue(table, row)))) {
        summary.additionalDestination++;
        continue;
      }
      if (mode === "merge") summary.unrelatedExistingIgnored++;
      else if (table === "document_revisions" || table === "data_transfer_archived_documents") {
        summary.unrelatedExistingIgnored++;
      } else summary.additionalDestination++;
    }
    summary.financialCents = moneyDifference(sourceRows, matchedForIntegrity.map((item) => item.target), table, columns);
  }

  const tenantColumns = await columnsFor(db, "tenants");
  const targetTenant = await db.prepare("SELECT * FROM tenants WHERE id=?").get(tenantId) || {};
  const configurationDiffering: string[] = [], configurationTransformed: string[] = [], configurationUnknown: string[] = [];
  for (const field of TRANSFER_TENANT_FIELDS) {
    if (!(field in payload.records.tenant)) continue;
    if (!tenantColumns.has(field) || !(field in targetTenant)) { configurationUnknown.push(field); continue; }
    if (canonical(payload.records.tenant[field]) === canonical(targetTenant[field])) continue;
    if (mode === "merge") configurationTransformed.push(field);
    else configurationDiffering.push(field);
  }
  const workshopConfigurationStatus: TransferVerificationStatus = configurationDiffering.length ? "divergent"
    : configurationUnknown.length ? "not-verifiable" : configurationTransformed.length ? "transformed" : "corresponding";

  const sourceCatalog = sourceRowsByTable.catalog || [], destinationCatalog = (matchedRows.get("catalog") || []).map((item) => item.target);
  const sourceProducts = sourceCatalog.filter((row) => row.kind === "product"), destinationProducts = destinationCatalog.filter((row) => row.kind === "product");
  const sourceProductUnits = tableTotal(sourceProducts, "stock"), destinationProductUnits = tableTotal(destinationProducts, "stock");
  const sourceMovementUnits = tableTotal(sourceRowsByTable.stock_movements || [], "quantity");
  const destinationMovementUnits = tableTotal((matchedRows.get("stock_movements") || []).map((item) => item.target), "quantity");
  const sourceInventoryValueCents = sourceProducts.reduce((sum, row) => sum + (cents(row.cost) || 0n) * (cents(row.stock) || 0n), 0n);
  const destinationInventoryValueCents = destinationProducts.reduce((sum, row) => sum + (cents(row.cost) || 0n) * (cents(row.stock) || 0n), 0n);

  let foreignKeys: ForeignKeyPair[] = [];
  try {
    foreignKeys = await db.prepare(`SELECT kcu.table_name,kcu.column_name,ccu.table_name AS foreign_table_name,ccu.column_name AS foreign_column_name,kcu.constraint_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu ON kcu.constraint_catalog=tc.constraint_catalog AND kcu.constraint_schema=tc.constraint_schema AND kcu.constraint_name=tc.constraint_name
      JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_catalog=tc.constraint_catalog AND ccu.constraint_schema=tc.constraint_schema AND ccu.constraint_name=tc.constraint_name
      WHERE tc.constraint_type='FOREIGN KEY' AND tc.table_schema='horse_power' AND ccu.table_schema='horse_power'`).all();
  } catch { foreignKeys = []; }
  const referential = { checked: 0, divergent: 0, notVerifiable: 0 };
  for (const relation of foreignKeys) {
    if (![relation.table_name, relation.column_name, relation.foreign_table_name, relation.foreign_column_name].every((value) => /^[a-z][a-z0-9_]*$/.test(value))) { referential.notVerifiable++; continue; }
    const table = relation.table_name as TransferTable;
    if (!TRANSFER_TABLES.includes(table) || table === "audit_events" || AUTHOR_FIELDS.has(relation.column_name) || relation.column_name === "tenant_id") continue;
    const parentRows = sourceRowsByTable[relation.foreign_table_name];
    const targetParentRows = destinationRowsByTable[relation.foreign_table_name];
    for (const pair of matchedRows.get(table) || []) {
      const sourceValue = pair.source[relation.column_name], targetValue = pair.target[relation.column_name];
      if (sourceValue === null || sourceValue === undefined) continue;
      referential.checked++;
      if (parentRows) {
        if (!parentRows.some((row) => canonical(row[relation.foreign_column_name]) === canonical(sourceValue)
          && (row.tenant_id === undefined || String(row.tenant_id) === sourceTenantId))) referential.divergent++;
      } else if (relation.foreign_table_name === "tenants") {
        if (String(sourceValue) !== sourceTenantId) referential.divergent++;
      } else referential.notVerifiable++;
      if (targetValue === null || targetValue === undefined) continue;
      if (targetParentRows) {
        if (!targetParentRows.some((row) => canonical(row[relation.foreign_column_name]) === canonical(targetValue)
          && (row.tenant_id === undefined || String(row.tenant_id) === tenantId))) referential.divergent++;
      } else if (relation.foreign_table_name === "tenants") {
        if (String(targetValue) !== tenantId) referential.divergent++;
      } else {
        const parentColumns = await columnsFor(db, relation.foreign_table_name);
        if (!parentColumns.size) referential.notVerifiable++;
        else if (parentColumns.has("tenant_id")) {
          const parent = await db.prepare(`SELECT 1 AS found FROM ${relation.foreign_table_name} WHERE tenant_id=? AND ${relation.foreign_column_name} IS NOT DISTINCT FROM ? LIMIT 1`).get(tenantId, targetValue);
          if (!parent) referential.divergent++;
        } else if (relation.foreign_table_name === "users" || relation.foreign_table_name === "tenants") {
          const parent = await db.prepare(`SELECT 1 AS found FROM ${relation.foreign_table_name} WHERE ${relation.foreign_column_name} IS NOT DISTINCT FROM ? LIMIT 1`).get(targetValue);
          if (!parent) referential.divergent++;
        } else referential.notVerifiable++;
      }
    }
  }

  let archivedRows: TransferRow[] = [];
  try { archivedRows = await db.prepare("SELECT revision_id FROM data_transfer_archived_documents WHERE tenant_id=?").all(tenantId); } catch { archivedRows = []; }
  const sourceArchivedIds = new Set((payload.records.data_transfer_archived_documents || []).map((row) => String(row.revision_id)));
  const sourceRevisionRows = sourceRowsByTable.document_revisions || [];
  const destinationRevisionRows = destinationRowsByTable.document_revisions || [];
  let missingHistorical = 0;
  for (const revision of sourceRevisionRows) {
    const isArchivedInSource = sourceArchivedIds.has(String(revision.id));
    const destinationExists = destinationRevisionRows.some((row) => canonical(row.id) === canonical(revision.id));
    const archiveExists = archivedRows.some((row) => canonical(row.revision_id) === canonical(revision.id));
    if (!destinationExists || (isArchivedInSource && !archiveExists) || (!isArchivedInSource && archiveExists)) missingHistorical++;
  }
  const preservedDestinationArchives = mode === "replace"
    ? archivedRows.filter((row) => !sourceArchivedIds.has(String(row.revision_id))).length
    : 0;
  const historicalDocuments = {
    sourceActive: sourceRevisionRows.filter((row) => !sourceArchivedIds.has(String(row.id))).length,
    sourceArchived: sourceArchivedIds.size,
    destinationActive: destinationRevisionRows.filter((row) => !archivedRows.some((archived) => canonical(archived.revision_id) === canonical(row.id))).length,
    destinationArchived: archivedRows.length,
    missing: missingHistorical,
    preservedDestinationArchives,
  };

  let backupRows: TransferRow[] = [];
  try { backupRows = await db.prepare("SELECT package_sha256,package FROM data_transfer_backups WHERE tenant_id=? ORDER BY created_at DESC").all(tenantId); } catch { backupRows = []; }
  const backups = { existing: backupRows.length, integrityValid: 0, integrityInvalid: 0 };
  for (const backup of backupRows) {
    const bytes = Buffer.from(backup.package as Uint8Array);
    if (transferFileSha256(bytes) === String(backup.package_sha256)) backups.integrityValid++;
    else backups.integrityInvalid++;
  }

  const policyCounts = {
    usersExcluded: payload.records.users.length,
    membershipsExcluded: payload.records.memberships.length,
    auditEventsExcluded: payload.records.audit_events?.length || 0,
    authorsRemapped: authorMappings,
    tenantIdRemapped: true as const,
  };
  const states: TransferVerificationStatus[] = [workshopConfigurationStatus];
  for (const [table, summary] of Object.entries(entities)) {
    if (table === "audit_events" && summary.sourceCount) states.push("transformed");
    else if (summary.divergent || summary.missing || summary.additionalDestination) states.push("divergent");
    else if (summary.notVerifiable) states.push("not-verifiable");
    else if (summary.transformed || summary.unrelatedExistingIgnored || summary.changedSinceImport) states.push("transformed");
    else states.push("corresponding");
  }
  if (referential.divergent || historicalDocuments.missing || backups.integrityInvalid) states.push("divergent");
  if (referential.notVerifiable) states.push("not-verifiable");
  if (preservedDestinationArchives || policyCounts.usersExcluded || policyCounts.membershipsExcluded || policyCounts.auditEventsExcluded) states.push("transformed");
  const notes = [
    "A conferência é somente leitura; a frase secreta é usada apenas durante esta requisição e não é armazenada.",
    "tenant_id é remapeado intencionalmente e não é contado como divergência. Campos de autoria user_id, issued_by e created_by seguem a política atual de remapeamento.",
    "Usuários, vínculos e eventos de auditoria da origem não são importados. A autoria histórica pode ter sido remapeada; não se afirma preservação da identidade original.",
    mode === "merge" ? "No modo Mesclar, registros de destino sem rastreamento deste pacote são tratados como preexistentes/não relacionados e não como falhas." : "Registros adicionais no destino são listados separadamente do conteúdo do pacote.",
    "Revisões históricas são associadas somente por tenant_id e revision_id; não se vinculam a OS/checklists por coincidência de entity_id.",
    "Detalhes de registros mostram apenas IDs e nomes de campos, nunca valores pessoais ou financeiros. A resposta é limitada a 100 detalhes por entidade.",
  ];
  return {
    mode, sourceWorkshop: payload.source.tenant.name, targetWorkshop: String(target.name || "Oficina"), packageSha256: transferFileSha256(file), generatedAt: now,
    overall: pickOverall(states), entities, workshopConfiguration: { status: workshopConfigurationStatus, differingFields: configurationDiffering, transformedFields: configurationTransformed, notVerifiableFields: configurationUnknown },
    stock: {
      sourceProductUnits: sourceProductUnits.toString(), destinationProductUnits: destinationProductUnits.toString(), differenceUnits: (destinationProductUnits - sourceProductUnits).toString(),
      sourceMovementUnits: sourceMovementUnits.toString(), destinationMovementUnits: destinationMovementUnits.toString(), differenceMovementUnits: (destinationMovementUnits - sourceMovementUnits).toString(),
      sourceInventoryValueCents: sourceInventoryValueCents.toString(), destinationInventoryValueCents: destinationInventoryValueCents.toString(), differenceInventoryValueCents: (destinationInventoryValueCents - sourceInventoryValueCents).toString(),
    },
    financial: sumMoneyByField(entities), referentialIntegrity: referential, historicalDocuments, backups, policy: policyCounts, notes,
  };
}
