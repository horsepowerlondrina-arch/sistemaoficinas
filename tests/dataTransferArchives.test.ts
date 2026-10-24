import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createDatabase } from "../server/db/database.js";
import { documentHistory, listArchivedDocuments, readArchivedDocument, readDocument } from "../server/services/documents.js";
import { pruneWorkshopTransferBackups } from "../server/services/dataTransferImport.js";

test("revisões arquivadas continuam rastreáveis e nunca reaparecem ligadas a uma OS reutilizada", async () => {
  const db = createDatabase(":memory:");
  const tenant = "archive-tenant", user = "archive-owner", order = "reused-order-id";
  const payload = JSON.stringify({ schema_version: 1, kind: "order", entity_id: order, revision: 1, issued_at: "2026-01-02T10:00:00.000Z", shop: { name: "Oficina Fictícia Original" }, order: { number: 7, status: "completed", total: 12000, discount: 0, items: [], guest_name: "Cliente Fictício", entered_on: "2026-01-01" }, customer: null, vehicle: null });
  const digest = createHash("sha256").update(payload).digest("hex");
  try {
    db.prepare("INSERT INTO tenants(id,name) VALUES(?,?)").run(tenant, "Oficina Fictícia Destino");
    db.prepare("INSERT INTO users(id,name,email,password_hash) VALUES(?,?,?,?)").run(user, "Proprietário Fictício", "archive-owner@example.invalid", "fixture");
    db.prepare("INSERT INTO memberships(user_id,tenant_id,role) VALUES(?,?,?)").run(user, tenant, "owner");
    db.prepare("INSERT INTO customers(id,tenant_id,name) VALUES(?,?,?)").run("archive-customer", tenant, "Cliente Atual Fictício");
    db.prepare("INSERT INTO vehicles(id,tenant_id,customer_id,plate,brand,model,year) VALUES(?,?,?,?,?,?,?)").run("archive-vehicle", tenant, "archive-customer", "ABC1D23", "Marca Fictícia", "Modelo Atual", 2024);
    db.prepare("INSERT INTO orders(id,tenant_id,number,customer_id,vehicle_id,status,entered_on,due_on,km) VALUES(?,?,?,?,?,?,?,?,?)").run(order, tenant, 99, "archive-customer", "archive-vehicle", "open", "2026-10-01", "2026-10-02", 1000);
    db.prepare("INSERT INTO document_revisions(id,tenant_id,kind,entity_id,revision,issued_at,issued_by,payload,digest) VALUES(?,?,?,?,?,?,?,?,?)").run("archive-revision", tenant, "order", order, 1, "2026-01-02T10:00:00.000Z", user, payload, digest);
    db.prepare("INSERT INTO data_transfer_archived_documents(tenant_id,revision_id,backup_id,kind,entity_id,revision,archived_at) VALUES(?,?,?,?,?,?,?)").run(tenant, "archive-revision", "expired-backup-reference", "order", order, 1, "2026-10-24T00:00:00.000Z");
    db.prepare("INSERT INTO tenants(id,name) VALUES(?,?)").run("foreign-tenant", "Oficina Fictícia Estrangeira");
    db.prepare("INSERT INTO document_revisions(id,tenant_id,kind,entity_id,revision,issued_at,issued_by,payload,digest) VALUES(?,?,?,?,?,?,?,?,?)").run("foreign-revision", "foreign-tenant", "order", "foreign-order", 1, "2026-01-03T10:00:00.000Z", user, payload, digest);
    assert.throws(() => db.prepare("INSERT INTO data_transfer_archived_documents(tenant_id,revision_id,backup_id,kind,entity_id,revision,archived_at) VALUES(?,?,?,?,?,?,?)").run(tenant, "foreign-revision", "fake-backup", "order", "foreign-order", 1, "2026-10-24T00:00:00.000Z"), /FOREIGN KEY/i);
    const ctx = { tenantId: tenant, userId: user, role: "owner" } as const;

    assert.deepEqual((await documentHistory(db, ctx, "order", order)).revisions, []);
    await assert.rejects(readDocument(db, ctx, "order", order, 1), /Revisão não encontrada/);
    const listed = await listArchivedDocuments(db, ctx);
    assert.equal(listed.length, 1);
    assert.equal(listed[0].entity_id, order);
    const archived = await readArchivedDocument(db, ctx, "archive-revision");
    assert.equal(archived.archive.archived_at, "2026-10-24T00:00:00.000Z");
    assert.equal(archived.document.shop.name, "Oficina Fictícia Original");
    await assert.rejects(listArchivedDocuments(db, { ...ctx, role: "operator" }), /permissão|permissões|administrador/i);
  } finally { db.close(); }
});

test("backups expirados e excedentes são removidos apenas da oficina solicitante", async () => {
  const db = createDatabase(":memory:");
  try {
    for (const [tenant, user] of [["backup-a", "backup-owner-a"], ["backup-b", "backup-owner-b"]]) {
      db.prepare("INSERT INTO tenants(id,name) VALUES(?,?)").run(tenant, "Oficina Fictícia " + tenant);
      db.prepare("INSERT INTO users(id,name,email,password_hash) VALUES(?,?,?,?)").run(user, user, user + "@example.invalid", "fixture");
      db.prepare("INSERT INTO memberships(user_id,tenant_id,role) VALUES(?,?,?)").run(user, tenant, "owner");
    }
    const now = new Date("2026-10-24T12:00:00.000Z");
    const add = (id: string, tenant: string, user: string, days: number, offset: number) => {
      const created = new Date(now.getTime() + offset * 1000).toISOString();
      const expiry = new Date(now.getTime() + days * 86400000).toISOString();
      db.prepare("INSERT INTO data_transfer_backups(id,tenant_id,created_by,package_sha256,package,created_at,expires_at) VALUES(?,?,?,?,?,?,?)").run(id, tenant, user, "a".repeat(64), Buffer.from("fictitious encrypted package"), created, expiry);
    };
    add("backup-expired", "backup-a", "backup-owner-a", -1, -100);
    for (let index = 0; index < 7; index++) add("backup-a-" + index, "backup-a", "backup-owner-a", 10, index);
    add("backup-b-keep", "backup-b", "backup-owner-b", 10, 0);

    await pruneWorkshopTransferBackups(db, "backup-a", now.toISOString());
    const keptA = db.prepare("SELECT id FROM data_transfer_backups WHERE tenant_id=? ORDER BY created_at DESC").all("backup-a");
    const keptB = db.prepare("SELECT id FROM data_transfer_backups WHERE tenant_id=?").all("backup-b");
    assert.equal(keptA.length, 5);
    assert.ok(keptA.every((row) => row.id !== "backup-expired"));
    assert.deepEqual(keptB.map((row) => row.id), ["backup-b-keep"]);
  } finally { db.close(); }
});
