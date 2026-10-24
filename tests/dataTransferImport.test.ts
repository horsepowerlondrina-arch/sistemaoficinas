import assert from "node:assert/strict";
import { test } from "node:test";
import type { DB, Row, TransactionalDB } from "../server/db/database.js";
import { importWorkshopPackage, previewWorkshopImport } from "../server/services/dataTransferImport.js";
import { createTransferPayload, sealTransferPackage, TRANSFER_TABLES } from "../shared/transferPackage.js";

const phrase = "frase-ficticia-importacao-2026";
const sourceTenant = "source-fake";
const targetTenant = "target-fake";
function makePackage(customerTenant = sourceTenant) {
  return sealTransferPackage(createTransferPayload("fixture", { id: sourceTenant, name: "Oficina Fictícia Origem" }, {
    tenant: { id: sourceTenant, name: "Oficina Fictícia Origem" },
    users: [{ id: "source-owner", name: "Proprietário Fictício", email: "owner@example.invalid" }],
    memberships: [{ user_id: "source-owner", tenant_id: sourceTenant, role: "owner" }],
    customers: [{ id: "customer-fake", tenant_id: customerTenant, name: "Cliente Fictício", phone: "", email: "", document: "", birthday: "", address: "", notes: "", active: 1, created_at: "2026-10-24T00:00:00.000Z" }],
  }, "2026-10-24T12:00:00.000Z"), phrase);
}

class MemoryDb {
  tenant: Row = { id: targetTenant, name: "Oficina Fictícia Destino" };
  users: Row[] = [{ id: "target-owner", name: "Proprietário Destino", email: "owner@example.invalid", password_hash: "preserved-hash" }];
  memberships: Row[] = [{ user_id: "target-owner", tenant_id: targetTenant, role: "owner" }];
  tables: Record<string, Row[]> = Object.fromEntries(TRANSFER_TABLES.map((table) => [table, []]));
  columns: Record<string, string[]> = {
    tenants: ["id", "name", "document", "phone", "address"],
    users: ["id", "name", "email", "password_hash"],
    memberships: ["user_id", "tenant_id", "role"],
    customers: ["id", "tenant_id", "name", "phone", "email", "document", "birthday", "address", "notes", "active", "created_at"],
    audit_events: ["id", "tenant_id", "user_id", "action", "entity_id", "created_at"],
  };

  prepare(sql: string) {
    return {
      all: async (...values: unknown[]) => {
        if (sql.includes("information_schema.columns")) return (this.columns[String(values[0])] || []).map((column_name) => ({ column_name }));
        throw new Error(`Consulta all inesperada: ${sql}`);
      },
      get: async (...values: unknown[]) => {
        if (sql.startsWith("SELECT id,name FROM tenants")) return this.tenant.id === values[0] ? { id: this.tenant.id, name: this.tenant.name } : undefined;
        if (sql.startsWith("SELECT email FROM users WHERE id=")) return this.users.find((row) => row.id === values[0]);
        if (sql.startsWith("SELECT id FROM users WHERE lower(email)")) return this.users.find((row) => String(row.email).toLowerCase() === String(values[0]).toLowerCase());
        if (sql.startsWith("SELECT 1 FROM memberships")) return this.memberships.some((row) => row.user_id === values[0] && row.tenant_id === values[1]) ? { ok: 1 } : undefined;
        const table = sql.match(/(?:FROM|UPDATE|INTO) ([a-z_]+)/i)?.[1];
        if (table === "customers" && /WHERE id=\?/i.test(sql)) return this.tables.customers.some((row) => row.id === values[0]) ? { ok: 1 } : undefined;
        if (table && /SELECT count\(\*\) AS count/i.test(sql)) return { count: this.tables[table].filter((row) => row.tenant_id === values[0]).length };
        if (table && /WHERE tenant_id=\? LIMIT 1/i.test(sql)) return this.tables[table].some((row) => row.tenant_id === values[0]) ? { ok: 1 } : undefined;
        throw new Error(`Consulta get inesperada: ${sql}`);
      },
      run: async (...values: unknown[]) => {
        if (sql.startsWith("UPDATE tenants SET")) {
          const keys = [...sql.matchAll(/([a-z_]+)=\?/g)].map((match) => match[1]).filter((key) => key !== "id");
          keys.forEach((key, index) => { this.tenant[key] = values[index]; });
          return { changes: 1 };
        }
        const match = sql.match(/^INSERT INTO ([a-z_]+) \(([^)]+)\)/i);
        if (!match) throw new Error(`Comando run inesperado: ${sql}`);
        const table = match[1], keys = match[2].split(",");
        const row = Object.fromEntries(keys.map((key, index) => [key, values[index]]));
        if (table === "users") this.users.push(row);
        else if (table === "memberships") this.memberships.push(row);
        else this.tables[table].push(row);
        return { changes: 1 };
      },
    };
  }
  async transaction<T>(callback: () => Promise<T>) { return callback(); }
}

test("prévia não grava e importação mantém IDs, remapeia oficina e bloqueia repetição", async () => {
  const db = new MemoryDb();
  const file = makePackage();
  const preview = await previewWorkshopImport(db as unknown as DB, targetTenant, file, phrase);
  assert.equal(preview.canImport, true);
  assert.equal(db.tables.customers.length, 0);
  const result = await importWorkshopPackage(db as unknown as DB & TransactionalDB, targetTenant, file, phrase, preview.confirmationId, "target-owner");
  assert.equal(db.tables.customers[0].id, "customer-fake");
  assert.equal(db.tables.customers[0].tenant_id, targetTenant);
  assert.equal(result.counts.customers, 1);
  assert.equal(db.users[0].password_hash, "preserved-hash");
  assert.equal(db.tables.audit_events[0].action, "data_transfer.imported");
  const repeated = await previewWorkshopImport(db as unknown as DB, targetTenant, file, phrase);
  assert.equal(repeated.canImport, false);
  assert.match(repeated.issues.join(" "), /já possui dados/);
});

test("prévia rejeita qualquer registro pertencente a outra oficina", async () => {
  const preview = await previewWorkshopImport(new MemoryDb() as unknown as DB, targetTenant, makePackage("foreign-fake"), phrase);
  assert.equal(preview.canImport, false);
  assert.ok(preview.issues.some((issue) => issue.includes("outra oficina")));
});
