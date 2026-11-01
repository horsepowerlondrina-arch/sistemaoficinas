import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import type { DB, Row, TransactionalDB } from "../server/db/database.js";
import { getWorkshopTransferBackup, importWorkshopPackage, previewWorkshopImport } from "../server/services/dataTransferImport.js";
import { createTransferPayload, sealTransferPackage, TRANSFER_TABLES, transferFileSha256 } from "../shared/transferPackage.js";
import { classifyPlatformAdminImportFailure } from "../server/platformAdminDataTransferRoutes.js";

const phrase = "frase-ficticia-importacao-2026";
const sourceTenant = "source-fake", targetTenant = "target-fake";
const customer = (name = "Cliente Fictício") => ({ id: "customer-fake", tenant_id: sourceTenant, name, phone: "", email: "", document: "", birthday: "", address: "", notes: "", active: 1, created_at: "2026-10-24T00:00:00.000Z" });
function makePackage(options: { customerTenant?: string; customerName?: string; application?: string; records?: Record<string, Row[]> } = {}) {
  return sealTransferPackage(createTransferPayload(options.application || "fixture", { id: sourceTenant, name: "Oficina Fictícia Origem" }, {
    tenant: { id: sourceTenant, name: "Oficina Fictícia Origem" },
    users: [{ id: "source-owner", name: "Proprietário Fictício", email: "source-owner@example.invalid" }],
    memberships: [{ user_id: "source-owner", tenant_id: sourceTenant, role: "owner" }],
    customers: [{ ...customer(options.customerName), tenant_id: options.customerTenant || sourceTenant }],
    ...(options.records || {}),
  }, "2026-10-24T12:00:00.000Z"), phrase);
}

class MemoryDb {
  tenant: Row = { id: targetTenant, name: "Oficina Fictícia Destino", document: "", phone: "", address: "" };
  users: Row[] = [{ id: "target-owner", name: "Proprietário Destino", email: "destination-owner@example.invalid", password_hash: "preserved-hash" }];
  memberships: Row[] = [{ user_id: "target-owner", tenant_id: targetTenant, role: "owner" }];
  tables: Record<string, Row[]> = Object.fromEntries([...TRANSFER_TABLES, "public_shares", "data_transfer_archived_documents"].map((table) => [table, []]));
  tracking: Row[] = [];
  backups: Row[] = [];
  columns: Record<string, string[]> = {
    tenants: ["id", "name", "document", "phone", "address"],
    users: ["id", "name", "email", "password_hash"], memberships: ["user_id", "tenant_id", "role"],
    customers: ["id", "tenant_id", "name", "phone", "email", "document", "birthday", "address", "notes", "active", "created_at"],
    stock_movements: ["id", "tenant_id", "catalog_id", "quantity", "reason", "user_id", "created_at"],
    vehicles: ["id", "tenant_id", "customer_id", "plate", "brand", "model", "year", "color", "km", "chassis", "active"],
    external_catalog_links: ["tenant_id", "source", "external_key", "catalog_id"],
    cash_entries: ["id", "tenant_id", "receivable_id", "installment_id", "amount", "gross_amount", "fee_amount", "method", "created_at"],
    payment_installments: ["id", "tenant_id", "receivable_id", "sequence", "due_on", "principal", "interest", "gross", "fee", "net", "status", "paid_at", "method"],
    service_aliases: ["tenant_id", "alias_key", "alias", "catalog_id"],
    orders: ["id", "tenant_id", "number", "kind", "status", "customer_id", "vehicle_id", "entered_on", "due_on", "completed_on", "km", "problem", "notes", "discount", "total", "created_at"],
    audit_events: ["id", "tenant_id", "user_id", "action", "entity_id", "created_at"],
    document_revisions: ["id", "tenant_id", "kind", "entity_id", "revision", "issued_at", "issued_by", "payload", "digest"],
    data_transfer_records: ["tenant_id", "source_application", "source_tenant_id", "table_name", "source_record_id", "source_hash", "target_record_id", "target_hash", "updated_at"],
    data_transfer_backups: ["id", "tenant_id", "created_by", "package_sha256", "package", "created_at", "expires_at"],
    data_transfer_archived_documents: ["tenant_id", "revision_id", "backup_id", "kind", "entity_id", "revision", "archived_at"],
  };
  prepare(sql: string) {
    return {
      all: async (...values: unknown[]) => {
        if (sql.includes("information_schema.columns")) return (this.columns[String(values[0])] || []).map((column_name) => ({ column_name }));
        if (sql.includes("FROM data_transfer_records")) return this.tracking.filter((row) => row.tenant_id === values[0]);
        if (sql.includes("FROM users u JOIN memberships")) return this.users.filter((u) => this.memberships.some((m) => m.user_id === u.id && m.tenant_id === values[0])).map(({ id, name, email }) => ({ id, name, email }));
        if (sql.includes("FROM memberships WHERE tenant_id=?")) return this.memberships.filter((row) => row.tenant_id === values[0]).map(({ user_id, tenant_id, role }) => ({ user_id, tenant_id, role }));
        const table = sql.match(/FROM ([a-z_]+)/i)?.[1];
        if (table && this.tables[table] && sql.includes("WHERE tenant_id=?")) return this.tables[table].filter((row) => row.tenant_id === values[0]);
        throw new Error(`Consulta all inesperada: ${sql}`);
      },
      get: async (...values: unknown[]) => {
        if (sql.startsWith("SELECT id,name FROM tenants")) return this.tenant.id === values[0] ? { id: this.tenant.id, name: this.tenant.name } : undefined;
        if (sql.startsWith("SELECT * FROM tenants WHERE id=")) return this.tenant.id === values[0] ? this.tenant : undefined;
        if (/SELECT (?:email|id,email) FROM users WHERE id=/.test(sql)) return this.users.find((row) => row.id === values[0]);
        if (sql.startsWith("SELECT id FROM users WHERE lower(email)")) return this.users.find((row) => String(row.email).toLowerCase() === String(values[0]).toLowerCase());
        if (sql.startsWith("SELECT role FROM memberships")) return this.memberships.find((row) => row.user_id === values[0] && row.tenant_id === values[1]);
        if (sql.startsWith("SELECT 1 FROM memberships")) return this.memberships.some((row) => row.user_id === values[0] && row.tenant_id === values[1]) ? { ok: 1 } : undefined;
        if (sql.includes("FROM data_transfer_records")) return this.tracking.find((row) => ["tenant_id", "source_application", "source_tenant_id", "table_name", "source_record_id"].every((key, index) => row[key] === values[index]));
        if (sql.startsWith("SELECT 1 FROM data_transfer_archived_documents")) return this.tables.data_transfer_archived_documents.find((row) => row.tenant_id === values[0] && row.revision_id === values[1]) ? { ok: 1 } : undefined;
        if (sql.includes("FROM data_transfer_backups") && sql.includes("package_sha256,package")) {
          const tenantFirst = sql.indexOf("tenant_id=?") < sql.indexOf("id=?");
          return this.backups.find((row) => tenantFirst ? row.tenant_id === values[0] && row.id === values[1] : row.id === values[0] && row.tenant_id === values[1]);
        }
        if (sql.includes("FROM public_shares")) return { count: this.tables.public_shares.filter((row) => row.tenant_id === values[0] && row.revoked === 0).length };
        const table = sql.match(/FROM ([a-z_]+)/i)?.[1];
        if (table && /SELECT count\(\*\) AS count/i.test(sql)) return { count: (this.tables[table] || []).filter((row) => row.tenant_id === values[0]).length };
        if (table && this.tables[table] && sql.includes("SELECT * FROM")) {
          const fields = [...sql.matchAll(/([a-z_]+) IS NOT DISTINCT FROM \?/g)].map((match) => match[1]);
          const tenant = values[0];
          return this.tables[table].find((row) => row.tenant_id === tenant && fields.every((field, index) => row[field] === values[index + 1]));
        }
        throw new Error(`Consulta get inesperada: ${sql}`);
      },
      run: async (...values: unknown[]) => {
        if (sql.startsWith("UPDATE tenants SET")) {
          const keys = [...sql.slice(sql.indexOf("SET") + 3, sql.indexOf("WHERE")).matchAll(/([a-z_]+)=\?/g)].map((match) => match[1]);
          keys.forEach((key, index) => { this.tenant[key] = values[index]; }); return { changes: 1 };
        }
        if (sql.startsWith("UPDATE public_shares")) { this.tables.public_shares.forEach((row) => { if (row.tenant_id === values[0]) row.revoked = 1; }); return { changes: 1 }; }
        if (sql.startsWith("DELETE FROM data_transfer_records")) { this.tracking = this.tracking.filter((row) => row.tenant_id !== values[0]); return { changes: 1 }; }
        if (sql.startsWith("DELETE FROM data_transfer_archived_documents")) { const before = this.tables.data_transfer_archived_documents.length; this.tables.data_transfer_archived_documents = this.tables.data_transfer_archived_documents.filter((row) => row.tenant_id !== values[0] || row.revision_id !== values[1]); return { changes: before - this.tables.data_transfer_archived_documents.length }; }
        if (sql.startsWith("DELETE FROM data_transfer_backups")) return { changes: 0 };
        if (sql.startsWith("DELETE FROM")) { const table = sql.match(/DELETE FROM ([a-z_]+)/i)![1]; const before = this.tables[table].length; this.tables[table] = this.tables[table].filter((row) => row.tenant_id !== values[0]); return { changes: before - this.tables[table].length }; }
        if (sql.startsWith("UPDATE customers SET")) {
          const keys = [...sql.slice(sql.indexOf("SET") + 3, sql.indexOf("WHERE")).matchAll(/([a-z_]+)=\?/g)].map((match) => match[1]);
          const tenantIndex = keys.length, tenant = values[tenantIndex], id = values[tenantIndex + 1];
          const row = this.tables.customers.find((item) => item.tenant_id === tenant && item.id === id);
          if (!row) return { changes: 0 }; keys.forEach((key, index) => { row[key] = values[index]; }); return { changes: 1 };
        }
        const match = sql.match(/^INSERT(?: OR IGNORE)? INTO ([a-z_]+)\s*\(([^)]+)\)/i);
        if (!match) throw new Error(`Comando run inesperado: ${sql}`);
        const table = match[1], keys = match[2].split(","), row = Object.fromEntries(keys.map((key, index) => [key, values[index]]));
        if (table === "users" || table === "memberships") throw new Error("A transferência não pode criar contas nem vínculos.");
        else if (table === "data_transfer_records") {
          const existing = this.tracking.find((item) => item.tenant_id === row.tenant_id && item.source_application === row.source_application && item.source_tenant_id === row.source_tenant_id && item.table_name === row.table_name && item.source_record_id === row.source_record_id);
          if (existing) Object.assign(existing, row); else this.tracking.push(row);
        } else if (table === "data_transfer_backups") this.backups.push(row);
        else if (table === "data_transfer_archived_documents") {
          const existing = this.tables.data_transfer_archived_documents.find((item) => item.tenant_id === row.tenant_id && item.revision_id === row.revision_id);
          if (!existing) this.tables.data_transfer_archived_documents.push(row);
        }
        else this.tables[table].push(row);
        return { changes: 1 };
      },
    };
  }
  async transaction<T>(callback: () => Promise<T>) {
    const before = structuredClone({ tenant: this.tenant, users: this.users, memberships: this.memberships, tables: this.tables, tracking: this.tracking, backups: this.backups });
    try { return await callback(); }
    catch (error) { Object.assign(this, before); throw error; }
  }
}

test("cash_entries identifica recebimentos por parcela, não pela receita inteira", async () => {
  const validDb = new MemoryDb();
  const validFile = makePackage({ records: {
    cash_entries: [
      { id: "entry-1", tenant_id: sourceTenant, receivable_id: "receivable-fake", installment_id: "installment-1", amount: 4000, gross_amount: 4000, fee_amount: 0, method: "Pix", created_at: "2026-10-24T10:00:00.000Z" },
      { id: "entry-2", tenant_id: sourceTenant, receivable_id: "receivable-fake", installment_id: "installment-2", amount: 4000, gross_amount: 4000, fee_amount: 0, method: "Pix", created_at: "2026-10-25T10:00:00.000Z" },
    ],
  } });
  const preview = await previewWorkshopImport(validDb as unknown as DB, targetTenant, validFile, phrase, "target-owner", "merge");
  assert.equal(preview.canImport, true, preview.issues.join("; "));
  assert.equal(preview.entities.cash_entries.new, 2);

  const duplicateDb = new MemoryDb();
  const duplicateFile = makePackage({ records: {
    cash_entries: [
      { id: "entry-1", tenant_id: sourceTenant, receivable_id: "receivable-fake", installment_id: "installment-1", amount: 4000, gross_amount: 4000, fee_amount: 0, method: "Pix", created_at: "2026-10-24T10:00:00.000Z" },
      { id: "entry-2", tenant_id: sourceTenant, receivable_id: "receivable-fake", installment_id: "installment-1", amount: 4000, gross_amount: 4000, fee_amount: 0, method: "Pix", created_at: "2026-10-25T10:00:00.000Z" },
    ],
  } });
  const duplicatePreview = await previewWorkshopImport(duplicateDb as unknown as DB, targetTenant, duplicateFile, phrase, "target-owner", "merge");
  assert.equal(duplicatePreview.canImport, false);
  assert.ok(duplicatePreview.issues.some((issue) => issue.includes("cash_entries") && issue.includes("duplicados")));
});

test("vínculos técnicos sem ID usam identidade composta estável sem conflito duplicado interno", async () => {
  const db = new MemoryDb();
  const file = makePackage({ records: {
    external_catalog_links: [{ tenant_id: sourceTenant, source: "fixture", external_key: "external-key-1", catalog_id: "catalog-fake" }],
    service_aliases: [{ tenant_id: sourceTenant, alias_key: "legacy-service-name", alias: "Serviço legado fictício", catalog_id: "catalog-fake" }],
  } });
  const preview = await previewWorkshopImport(db as unknown as DB, targetTenant, file, phrase, "target-owner", "merge");
  assert.equal(preview.canImport, true, preview.issues.join("; "));
  assert.equal(preview.entities.external_catalog_links.new, 1);
  assert.equal(preview.entities.service_aliases.new, 1);

  await importWorkshopPackage(db as unknown as DB, targetTenant, file, phrase, preview.confirmationId, "target-owner", "merge");
  assert.deepEqual(db.tables.external_catalog_links[0], {
    tenant_id: targetTenant, source: "fixture", external_key: "external-key-1", catalog_id: "catalog-fake",
  });
  assert.deepEqual(db.tables.service_aliases[0], {
    tenant_id: targetTenant, alias_key: "legacy-service-name", alias: "Serviço legado fictício", catalog_id: "catalog-fake",
  });
  assert.ok(db.tracking.some((row) => row.table_name === "external_catalog_links" && row.source_record_id === '["fixture","external-key-1"]'));
  assert.ok(db.tracking.some((row) => row.table_name === "service_aliases" && row.source_record_id === '["legacy-service-name"]'));
});

test("importação preserva contas e vínculos e associa a autoria ao proprietário de destino", async () => {
  const db = new MemoryDb();
  const file = makePackage({ records: {
    stock_movements: [{ id: "movement-fake", tenant_id: sourceTenant, catalog_id: "catalog-fake", quantity: -1, reason: "OS fictícia", user_id: "source-owner", created_at: "2026-10-24T12:00:00.000Z" }],
    document_revisions: [{ id: "revision-fake", tenant_id: sourceTenant, kind: "order", entity_id: "order-fake", revision: 1, issued_at: "2026-10-24T12:00:00.000Z", issued_by: "source-owner", payload: "{\"oficina\":\"Origem fictícia\"}", digest: "fixture-digest" }],
    audit_events: [{ id: "source-audit-fake", tenant_id: sourceTenant, user_id: "source-owner", action: "old.action", entity_id: "old-fake", created_at: "2026-10-24T12:00:00.000Z" }],
  } });
  const usersBefore = structuredClone(db.users), membershipsBefore = structuredClone(db.memberships);
  const preview = await previewWorkshopImport(db as unknown as DB, targetTenant, file, phrase, "target-owner");
  assert.equal(preview.canImport, true, preview.issues.join("; "));
  assert.ok(preview.warnings.some((warning) => warning.includes("proprietário que executa")));
  await importWorkshopPackage(db as unknown as DB, targetTenant, file, phrase, preview.confirmationId, "target-owner");
  assert.equal(db.tables.stock_movements[0].user_id, "target-owner");
  assert.equal(db.tables.document_revisions[0].issued_by, "target-owner");
  assert.equal(db.tables.audit_events.some((row) => row.id === "source-audit-fake"), false);
  assert.ok(db.tables.audit_events.some((row) => row.action === "data_transfer.imported" && row.user_id === "target-owner"));
  assert.deepEqual(db.users, usersBefore);
  assert.deepEqual(db.memberships, membershipsBefore);
});

test("prévia não grava, importação inicial remapeia oficina e repetição em modo vazio é bloqueada", async () => {
  const db = new MemoryDb(), file = makePackage();
  const preview = await previewWorkshopImport(db as unknown as DB, targetTenant, file, phrase, "target-owner");
  assert.equal(preview.canImport, true); assert.equal(db.tables.customers.length, 0);
  const result = await importWorkshopPackage(db as unknown as DB & TransactionalDB, targetTenant, file, phrase, preview.confirmationId, "target-owner");
  assert.equal(db.tables.customers[0].id, "customer-fake"); assert.equal(db.tables.customers[0].tenant_id, targetTenant);
  assert.equal(result.counts.customers, 1); assert.equal(db.users[0].password_hash, "preserved-hash");
  assert.equal(db.tables.audit_events[0].action, "data_transfer.imported");
  const repeated = await previewWorkshopImport(db as unknown as DB, targetTenant, file, phrase, "target-owner");
  assert.equal(repeated.canImport, false); assert.match(repeated.issues.join(" "), /já possui registros/);
});

test("mesclagem repetida é idempotente e atualiza somente cadastros ainda iguais à versão importada", async () => {
  const db = new MemoryDb(), first = makePackage();
  const p1 = await previewWorkshopImport(db as unknown as DB, targetTenant, first, phrase, "target-owner");
  await importWorkshopPackage(db as unknown as DB, targetTenant, first, phrase, p1.confirmationId, "target-owner");
  const same = await previewWorkshopImport(db as unknown as DB, targetTenant, first, phrase, "target-owner", "merge");
  assert.equal(same.canImport, true); assert.equal(same.entities.customers.equal, 1); assert.equal(same.entities.customers.new, 0);
  await importWorkshopPackage(db as unknown as DB, targetTenant, first, phrase, same.confirmationId, "target-owner", "merge");
  assert.equal(db.tables.customers.length, 1);
  const updatedFile = makePackage({ customerName: "Cliente Fictício Atualizado" });
  const update = await previewWorkshopImport(db as unknown as DB, targetTenant, updatedFile, phrase, "target-owner", "merge");
  assert.equal(update.entities.customers.updates, 1); assert.equal(update.canImport, true);
  await importWorkshopPackage(db as unknown as DB, targetTenant, updatedFile, phrase, update.confirmationId, "target-owner", "merge");
  assert.equal(db.tables.customers[0].name, "Cliente Fictício Atualizado");
});

test("mesclagem bloqueia conflito local e não vaza para outra oficina", async () => {
  const db = new MemoryDb(), original = makePackage();
  const first = await previewWorkshopImport(db as unknown as DB, targetTenant, original, phrase, "target-owner");
  await importWorkshopPackage(db as unknown as DB, targetTenant, original, phrase, first.confirmationId, "target-owner");
  db.tables.customers[0].name = "Alteração local fictícia";
  const changed = makePackage({ customerName: "Versão de origem alterada" });
  const conflict = await previewWorkshopImport(db as unknown as DB, targetTenant, changed, phrase, "target-owner", "merge");
  assert.equal(conflict.canImport, false); assert.equal(conflict.entities.customers.conflicts, 1);
  const foreign = makePackage({ customerTenant: "other-fake" });
  const foreignPreview = await previewWorkshopImport(new MemoryDb() as unknown as DB, targetTenant, foreign, phrase, "target-owner", "merge");
  assert.equal(foreignPreview.canImport, false); assert.match(foreignPreview.issues.join(" "), /outra oficina/);
});

test("mesclagem identifica conflitos de placa e número de OS sem duplicar registros", async () => {
  const db = new MemoryDb();
  db.tables.vehicles.push({ id: "vehicle-existing", tenant_id: targetTenant, customer_id: "customer-existing", plate: "ABC1D23", brand: "Marca", model: "Modelo", year: 2020, color: "", km: 10, chassis: "", active: 1 });
  db.tables.orders.push({ id: "order-existing", tenant_id: targetTenant, number: 204, kind: "order", status: "completed", customer_id: "customer-existing", vehicle_id: "vehicle-existing", entered_on: "2026-10-20", due_on: "2026-10-21", completed_on: "2026-10-21", km: 10, problem: "Histórico fictício", notes: "", discount: 0, total: 5000, created_at: "2026-10-20T00:00:00.000Z" });
  const file = makePackage({ records: {
    vehicles: [{ id: "vehicle-imported", tenant_id: sourceTenant, customer_id: "customer-fake", plate: "ABC1D23", brand: "Marca", model: "Modelo", year: 2020, color: "", km: 10, chassis: "", active: 1 }],
    orders: [{ id: "order-imported", tenant_id: sourceTenant, number: 204, kind: "order", status: "completed", customer_id: "customer-fake", vehicle_id: "vehicle-imported", entered_on: "2026-10-20", due_on: "2026-10-21", completed_on: "2026-10-21", km: 10, problem: "Histórico fictício", notes: "", discount: 0, total: 5000, created_at: "2026-10-20T00:00:00.000Z" }],
  } });
  const preview = await previewWorkshopImport(db as unknown as DB, targetTenant, file, phrase, "target-owner", "merge");
  assert.equal(preview.canImport, false);
  assert.ok(preview.issues.some((issue) => issue.includes("vehicles") && issue.includes("chave única")));
  assert.ok(preview.issues.some((issue) => issue.includes("orders") && issue.includes("chave única")));
  assert.equal(db.tables.vehicles.length, 1); assert.equal(db.tables.orders.length, 1);
});

test("substituição exige confirmação do nome, mantém documentos/auditoria e guarda backup recuperável", async () => {
  const db = new MemoryDb();
  db.tables.customers.push({ id: "old-customer", tenant_id: targetTenant, name: "Cliente antigo fictício", phone: "", email: "", document: "", birthday: "", address: "", notes: "", active: 1, created_at: "2026-10-20T00:00:00.000Z" });
  db.tables.customers.push({ id: "other-customer", tenant_id: "other-fake", name: "Cliente de outra oficina", phone: "", email: "", document: "", birthday: "", address: "", notes: "", active: 1, created_at: "2026-10-20T00:00:00.000Z" });
  db.tables.document_revisions.push({ id: "revision-old", tenant_id: targetTenant, kind: "order", entity_id: "old-order", revision: 1, issued_at: "2026-10-20T00:00:00.000Z", issued_by: "target-owner", payload: "{\"workshop\":\"Oficina Fictícia Destino\"}", digest: "digest-old" });
  db.tables.audit_events.push({ id: "audit-old", tenant_id: targetTenant, user_id: "target-owner", action: "historical.fake", entity_id: "old-order", created_at: "2026-10-20T00:00:00.000Z" });
  const file = makePackage(), preview = await previewWorkshopImport(db as unknown as DB, targetTenant, file, phrase, "target-owner", "replace");
  assert.equal(preview.canImport, true); assert.equal(preview.entities.customers.removed, 1); assert.equal(preview.entities.document_revisions.removed, 0);
  await assert.rejects(importWorkshopPackage(db as unknown as DB, targetTenant, file, phrase, preview.confirmationId, "target-owner", "replace", "Nome errado"), /nome exato/);
  assert.equal(db.tables.customers[0].id, "old-customer"); assert.equal(db.backups.length, 0);
  const result = await importWorkshopPackage(db as unknown as DB, targetTenant, file, phrase, preview.confirmationId, "target-owner", "replace", "Oficina Fictícia Destino");
  assert.ok(result.backupId); assert.equal(db.tables.customers.filter((row) => row.tenant_id === targetTenant).length, 1);
  assert.equal(db.tables.customers.find((row) => row.tenant_id === targetTenant)?.id, "customer-fake");
  assert.equal(db.tables.document_revisions[0].id, "revision-old"); assert.equal(db.tables.audit_events[0].id, "audit-old");
  assert.ok(db.tables.customers.some((row) => row.id === "other-customer" && row.tenant_id === "other-fake"));
  assert.equal(db.users[0].password_hash, "preserved-hash"); assert.equal(db.memberships[0].user_id, "target-owner");
  const backup = await getWorkshopTransferBackup(db as unknown as DB, targetTenant, String(result.backupId));
  assert.ok(backup); assert.equal(transferFileSha256(backup!), db.backups[0].package_sha256);
  assert.equal(createHash("sha256").update(backup!).digest("hex"), db.backups[0].package_sha256);
});

test("substituição bloqueia colisão com revisão imutável diferente", async () => {
  const db = new MemoryDb();
  db.tables.document_revisions.push({ id: "revision-conflict", tenant_id: targetTenant, kind: "order", entity_id: "same-order", revision: 1, issued_at: "2026-10-20T00:00:00.000Z", issued_by: "target-owner", payload: "old", digest: "old" });
  const records = { document_revisions: [{ id: "revision-other", tenant_id: sourceTenant, kind: "order", entity_id: "same-order", revision: 1, issued_at: "2026-10-21T00:00:00.000Z", issued_by: "source-owner", payload: "new", digest: "new" }] };
  const file = makePackage({ records }), preview = await previewWorkshopImport(db as unknown as DB, targetTenant, file, phrase, "target-owner", "replace");
  assert.equal(preview.canImport, false); assert.ok(preview.issues.some((issue) => issue.includes("histórico imutável")));
  assert.equal(db.tables.document_revisions.length, 1);
});

test("pacote novo transporta o vínculo de arquivamento e pacotes antigos sem essa entidade continuam compatíveis", async () => {
  const db = new MemoryDb();
  const revision = { id: "archived-transfer-revision", tenant_id: sourceTenant, kind: "order", entity_id: "old-order", revision: 1, issued_at: "2026-10-20T00:00:00.000Z", issued_by: "source-owner", payload: '{"shop":"Oficina Fictícia Origem"}', digest: "fictitious-digest" };
  const archive = { tenant_id: sourceTenant, revision_id: revision.id, backup_id: "origin-backup-reference", kind: "order", entity_id: "old-order", revision: 1, archived_at: "2026-10-21T00:00:00.000Z" };
  const file = makePackage({ records: { document_revisions: [revision], data_transfer_archived_documents: [archive] } });
  const preview = await previewWorkshopImport(db as unknown as DB, targetTenant, file, phrase, "target-owner");
  assert.equal(preview.canImport, true, preview.issues.join("; "));
  await importWorkshopPackage(db as unknown as DB, targetTenant, file, phrase, preview.confirmationId, "target-owner");
  assert.equal(db.tables.document_revisions.length, 1);
  assert.equal(db.tables.data_transfer_archived_documents.length, 1);
  assert.equal(db.tables.data_transfer_archived_documents[0].tenant_id, targetTenant);
  assert.equal(db.tables.data_transfer_archived_documents[0].revision_id, revision.id);
});

test("ADM: falhas de importação são classificadas sem expor detalhes do banco", () => {
  const unique = Object.assign(new Error("duplicate key value violates unique constraint product_categories_pkey"), {
    code: "23505", constraint: "product_categories_pkey",
  });
  assert.deepEqual(classifyPlatformAdminImportFailure(unique), {
    status: 409, code: "unique_conflict",
    message: "Há um registro com identificador ou chave única conflitante. Nenhuma alteração foi mantida; revise a prévia e os conflitos.",
  });
  const relationship = Object.assign(new Error("foreign key value violates constraint"), { code: "23503" });
  assert.equal(classifyPlatformAdminImportFailure(relationship).code, "relationship_conflict");
  const stale = new Error("Os dados ou a prévia mudaram. Gere uma nova prévia antes de confirmar.");
  assert.equal(classifyPlatformAdminImportFailure(stale).code, "stale_preview");
  assert.doesNotMatch(classifyPlatformAdminImportFailure(unique).message, /product_categories|constraint|23505/);
});


test('OPS-002 transfer carries machines and rates and rejects conflicting defaults before writes',async()=>{
 const db=new MemoryDb();
 db.columns.card_machines=['id','tenant_id','name','name_key','operator','active','is_default','max_installments'];
 db.columns.card_machine_rates=['tenant_id','machine_id','method','installments','fee_bps'];
 const machine={id:'machine-source',tenant_id:sourceTenant,name:'Máquina fictícia',name_key:'máquina fictícia',operator:'Fictícia',active:1,is_default:1,max_installments:3};
 const file=makePackage({records:{card_machines:[machine],card_machine_rates:[{tenant_id:sourceTenant,machine_id:machine.id,method:'Cartão de crédito',installments:3,fee_bps:350}]}});
 const preview=await previewWorkshopImport(db as unknown as DB,targetTenant,file,phrase,'target-owner','empty');
 assert.equal(preview.canImport,true,preview.issues.join(';'));
 await importWorkshopPackage(db as unknown as DB,targetTenant,file,phrase,preview.confirmationId,'target-owner','empty');
 assert.equal(db.tables.card_machines[0].tenant_id,targetTenant);
 assert.equal(db.tables.card_machine_rates[0].machine_id,db.tables.card_machines[0].id);
 assert.equal(db.tables.card_machine_rates[0].fee_bps,350);
 const other=makePackage({records:{card_machines:[{...machine,id:'another',name:'Outra',name_key:'outra'}]}});
 const conflict=await previewWorkshopImport(db as unknown as DB,targetTenant,other,phrase,'target-owner','merge');assert.equal(conflict.canImport,false);assert.ok(conflict.issues.some(i=>i.includes('máquina padrão')));
});
