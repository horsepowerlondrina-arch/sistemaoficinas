// OPS-004: identity fixtures keep their last Master until the disposable CI database is destroyed.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import test from "node:test";
import { adminClient } from "../scripts/local-admin.js";
import { createLocalDatabase } from "../server/db/local.js";
import { createTransferPayload, openTransferPackage, sealTransferPackage, transferFileSha256 } from "../shared/transferPackage.js";
import { getWorkshopTransferBackup, importWorkshopPackage, previewWorkshopImport } from "../server/services/dataTransferImport.js";
import { documentHistory, readArchivedDocument, readDocument } from "../server/services/documents.js";
import { createWorkshopTransfer } from "../server/services/dataTransferExport.js";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
if (existsSync(".env.platform-admin.local")) process.loadEnvFile(".env.platform-admin.local");

test("PostgreSQL local: runtime replace privileges are narrow and preserve immutable history", async () => {
  const admin = adminClient();
  await admin.connect();
  try {
    const result = await admin.query<{ table_name: string; can_delete: boolean }>(`
      SELECT table_name, has_table_privilege('hp_local_app', format('horse_power.%I', table_name), 'DELETE') AS can_delete
      FROM (VALUES ('stock_movements'), ('cash_entries'), ('service_merge_history'), ('audit_events'), ('document_revisions')) AS tables(table_name)
    `);
    const privileges = Object.fromEntries(result.rows.map(({ table_name, can_delete }) => [table_name, can_delete]));
    assert.deepEqual(privileges, {
      stock_movements: true,
      cash_entries: true,
      service_merge_history: true,
      audit_events: false,
      document_revisions: false,
    });
  } finally {
    await admin.end();
  }
});

test("PostgreSQL local: transferência fictícia completa preserva IDs, relações e snapshot e reverte a transação", async (t) => {
  const admin = adminClient();
  await admin.connect();
  const db = await createLocalDatabase();
  const tenantId = randomUUID(), userId = randomUUID();
  const sourceTenantId = randomUUID(), sourceUserId = randomUUID();
  const customerId = randomUUID(), vehicleId = randomUUID(), professionalId = randomUUID();
  const catalogId = randomUUID(), serviceCategoryId = randomUUID(), workshopServiceId = randomUUID(), orderId = randomUUID(), itemId = randomUUID(), movementId = randomUUID(), receivableId = randomUUID(), installmentId = randomUUID(), installmentId2 = randomUUID(), cashEntryId = randomUUID(), cashEntryId2 = randomUUID(), externalCaptureId = randomUUID(), revisionId = randomUUID();
  const documentPayload = JSON.stringify({ workshop: "Oficina Fictícia Origem", order_id: orderId, total: 8000 });
  const documentDigest = createHash("sha256").update(documentPayload).digest("hex");
  const phrase = "frase-ficticia-postgres-mig002";
  let fixtureCreated = false;
  try {
    await admin.query("INSERT INTO horse_power.tenants(id,name,document,phone,address) VALUES($1,$2,'','','')", [tenantId, "Oficina Fictícia MIG002"]);
    await admin.query("INSERT INTO horse_power.users(id,name,email,password_hash) VALUES($1,$2,$3,'fixture-hash')", [userId, "Proprietário Fictício", `mig002-${userId}@example.invalid`]);
    await admin.query("INSERT INTO horse_power.memberships(user_id,tenant_id,role) VALUES($1,$2,'owner')", [userId, tenantId]);
    const preservedSessionHash = randomUUID().replaceAll("-", "");
    await admin.query("INSERT INTO horse_power.sessions(token_hash,user_id,tenant_id,expires_at) VALUES($1,$2,$3,$4)", [preservedSessionHash, userId, tenantId, Date.now() + 3600000]);
    fixtureCreated = true;
    const payload = createTransferPayload("fixture", { id: sourceTenantId, name: "Oficina Fictícia Origem" }, {
      tenant: { id: sourceTenantId, name: "Oficina Fictícia Origem", document: "", phone: "", address: "" },
      users: [{ id: sourceUserId, name: "Proprietário Fictício", email: `source-${sourceUserId}@example.invalid` }],
      memberships: [{ user_id: sourceUserId, tenant_id: sourceTenantId, role: "owner" }],
      customers: [{ id: customerId, tenant_id: sourceTenantId, name: "Cliente Fictício", phone: "", email: "", document: "", birthday: "", address: "", notes: "", active: 1, created_at: "2026-10-24T00:00:00.000Z" }],
      vehicles: [{ id: vehicleId, tenant_id: sourceTenantId, customer_id: customerId, plate: "ABC1D23", brand: "Marca Fictícia", model: "Modelo Fictício", year: 2024, color: "", km: 1000, chassis: "", active: 1, service_model_id: "", service_porte_id: "" }],
      professionals: [{ id: professionalId, tenant_id: sourceTenantId, name: "Mecânico Fictício", role: "Mecânico", phone: "", email: "", active: 1 }],
      catalog: [{ id: catalogId, tenant_id: sourceTenantId, kind: "product", name: "Peça Fictícia", sku: "FAKE-MIG004", category: "Teste", cost: 5000, price: 8000, stock: 3, minimum_stock: 0, active: 1 }],
      workshop_service_categories: [{ id: serviceCategoryId, tenant_id: sourceTenantId, name: "Categoria de serviço fictícia", name_key: "categoria-servico-ficticia", active: 1 }],
      workshop_services: [{ id: workshopServiceId, tenant_id: sourceTenantId, name: "Serviço fictício", name_key: "servico-ficticio", execution: "internal", reference: "SVC-FICTICIO", category_id: serviceCategoryId }],
      external_captures: [{ id: externalCaptureId, tenant_id: sourceTenantId, capture_id: "capture-fake-001", order_id: orderId, item_id: itemId, catalog_id: catalogId, source: "fixture", external_key: "external-capture-fake", payload_hash: createHash("sha256").update("fixture-only").digest("hex"), duration_seconds: 3600, source_cost: 5000, source_price: 8000, vehicle_label: "Veículo Fictício", created_at: "2026-10-21T10:00:00.000Z", batch_id: "batch-fake-001", source_quantity: 2, freight_total: 350 }],
      external_catalog_links: [{ tenant_id: sourceTenantId, source: "fixture", external_key: "external-key-fake", catalog_id: catalogId }],
      orders: [{ id: orderId, tenant_id: sourceTenantId, number: 1, customer_id: customerId, vehicle_id: vehicleId, status: "completed", entered_on: "2026-10-20", due_on: "2026-10-21", completed_on: "2026-10-21", km: 1000, problem: "Dado fictício", notes: "", discount: 0, total: 8000, created_at: "2026-10-20T10:00:00.000Z" }],
      order_items: [{ id: itemId, tenant_id: sourceTenantId, order_id: orderId, catalog_id: catalogId, professional_id: professionalId, kind: "product", name: "Peça Fictícia", quantity: 1, price: 8000, cost: 5000 }],
      stock_movements: [{ id: movementId, tenant_id: sourceTenantId, catalog_id: catalogId, order_id: orderId, quantity: -1, reason: "OS fictícia", user_id: sourceUserId, created_at: "2026-10-21T10:00:00.000Z" }],
      receivables: [{ id: receivableId, tenant_id: sourceTenantId, order_id: orderId, customer_id: customerId, description: "OS fictícia", amount: 8000, due_on: "2026-10-21", status: "paid", method: "Pix", paid_at: "2026-10-21T10:00:00.000Z", plan_configured: 1, installment_count: 2, card_fee_bps: 0, interest_bps: 0, gross_total: 8000, fee_total: 0, net_total: 8000 }],
      payment_installments: [
        { id: installmentId, tenant_id: sourceTenantId, receivable_id: receivableId, sequence: 1, due_on: "2026-10-21", principal: 4000, interest: 0, gross: 4000, fee: 0, net: 4000, status: "paid", paid_at: "2026-10-21T10:00:00.000Z", method: "Pix" },
        { id: installmentId2, tenant_id: sourceTenantId, receivable_id: receivableId, sequence: 2, due_on: "2026-11-21", principal: 4000, interest: 0, gross: 4000, fee: 0, net: 4000, status: "paid", paid_at: "2026-11-21T10:00:00.000Z", method: "Pix" },
      ],
      cash_entries: [
        { id: cashEntryId, tenant_id: sourceTenantId, receivable_id: receivableId, installment_id: installmentId, amount: 4000, gross_amount: 4000, fee_amount: 0, method: "Pix", created_at: "2026-10-21T10:00:00.000Z" },
        { id: cashEntryId2, tenant_id: sourceTenantId, receivable_id: receivableId, installment_id: installmentId2, amount: 4000, gross_amount: 4000, fee_amount: 0, method: "Pix", created_at: "2026-11-21T10:00:00.000Z" },
      ],
      document_revisions: [{ id: revisionId, tenant_id: sourceTenantId, kind: "order", entity_id: orderId, revision: 1, issued_at: "2026-10-21T10:00:00.000Z", issued_by: sourceUserId, payload: documentPayload, digest: documentDigest }],
    }, "2026-10-24T12:00:00.000Z");
    const file = sealTransferPackage(payload, phrase);
    const settings = { "app.tenant_id": tenantId, "app.user_id": userId, "app.session_hash": "", "app.login_email": "", "app.login_key": "", "app.setup_hash": "", "app.public_share_hash": "", "app.extension_hash": "" };
    await db.withRequestContext(settings, async () => {
      await db.setRequestIdentity(tenantId, userId);
      const preview = await previewWorkshopImport(db, tenantId, file, phrase, userId);
      assert.equal(preview.canImport, true, preview.issues.join("; "));
      const result = await importWorkshopPackage(db, tenantId, file, phrase, preview.confirmationId, userId);
      assert.equal(result.counts.external_catalog_links, 1);
      const externalLink = await db.prepare("SELECT source,external_key,catalog_id FROM external_catalog_links WHERE tenant_id=?").get(tenantId);
      assert.deepEqual(externalLink, { source: "fixture", external_key: "external-key-fake", catalog_id: catalogId });
      assert.equal(result.counts.external_captures, 1);
      const capture = await db.prepare("SELECT batch_id,source_quantity,freight_total FROM external_captures WHERE tenant_id=? AND id=?").get(tenantId, externalCaptureId);
      assert.deepEqual(capture, { batch_id: "batch-fake-001", source_quantity: 2, freight_total: 350 });
      assert.equal(result.counts.workshop_service_categories, 1);
      assert.equal(result.counts.workshop_services, 1);
      assert.deepEqual(await db.prepare("SELECT s.category_id,c.id AS category_id_check FROM workshop_services s JOIN workshop_service_categories c ON c.id=s.category_id AND c.tenant_id=s.tenant_id WHERE s.tenant_id=? AND s.id=?").get(tenantId,workshopServiceId), { category_id: serviceCategoryId, category_id_check: serviceCategoryId });
      assert.equal(result.counts.customers, 1);
      assert.equal(result.counts.vehicles, 1);
      assert.equal(result.counts.orders, 1);
      assert.equal(result.counts.stock_movements, 1);
      assert.equal(result.counts.payment_installments, 2);
      assert.equal(result.counts.cash_entries, 2);
      await admin.query("INSERT INTO horse_power.customers(id,tenant_id,name,email) VALUES($1,$2,$3,$4)", ["unrelated-customer-" + tenantId, tenantId, "Cliente Fictício Não Importado", "unrelated@example.invalid"]);
      const rows = await db.prepare(`SELECT c.id AS customer_id,v.customer_id AS vehicle_customer,o.vehicle_id,i.price,r.issued_by,r.payload
        FROM customers c JOIN vehicles v ON v.tenant_id=c.tenant_id AND v.customer_id=c.id
        JOIN orders o ON o.tenant_id=v.tenant_id AND o.vehicle_id=v.id
        JOIN order_items i ON i.tenant_id=o.tenant_id AND i.order_id=o.id
        JOIN document_revisions r ON r.tenant_id=o.tenant_id AND r.entity_id=o.id WHERE c.tenant_id=?`).get(tenantId);
      assert.equal(rows?.customer_id, customerId);
      assert.equal(rows?.vehicle_customer, customerId);
      assert.equal(rows?.vehicle_id, vehicleId);
      assert.equal(rows?.price, 8000);
      assert.equal(rows?.issued_by, userId);
      assert.equal((await db.prepare("SELECT user_id FROM stock_movements WHERE tenant_id=? AND id=?").get(tenantId,movementId))?.user_id, userId);
      assert.equal((await admin.query("SELECT count(*)::int AS count FROM horse_power.users WHERE id=$1", [userId])).rows[0].count, 1);
      assert.equal((await admin.query("SELECT count(*)::int AS count FROM horse_power.memberships WHERE tenant_id=$1 AND user_id=$2", [tenantId,userId])).rows[0].count, 1);
      assert.equal((await admin.query("SELECT password_hash FROM horse_power.users WHERE id=$1", [userId])).rows[0].password_hash, "fixture-hash");
      assert.match(String(rows?.payload), /Oficina Fictícia Origem/);
      assert.equal((await db.prepare("SELECT action FROM audit_events WHERE tenant_id=? AND user_id=?").get(tenantId,userId))?.action, "data_transfer.imported");
      const idCollisionPayload = createTransferPayload("fixture-id-conflict", payload.source.tenant, {
        ...payload.records,
        customers: payload.records.customers!.map((row, index) => index === 0 ? { ...row, name: "Nome Fictício em Conflito" } : row),
      }, payload.generatedAt);
      const idCollision = await previewWorkshopImport(db, tenantId, sealTransferPackage(idCollisionPayload, phrase), phrase, userId, "merge");
      assert.equal(idCollision.canImport, false);
      assert.ok(idCollision.entities.customers.conflicts > 0);
      const numberCollisionPayload = createTransferPayload("fixture-os-number-conflict", payload.source.tenant, {
        ...payload.records,
        orders: payload.records.orders!.map((row, index) => index === 0 ? { ...row, id: randomUUID() } : row),
      }, payload.generatedAt);
      const numberCollision = await previewWorkshopImport(db, tenantId, sealTransferPackage(numberCollisionPayload, phrase), phrase, userId, "merge");
      assert.equal(numberCollision.canImport, false);
      assert.ok(numberCollision.entities.orders.conflicts > 0);
      const repeated = await previewWorkshopImport(db, tenantId, file, phrase, userId, "merge");
      assert.equal(repeated.canImport, true, repeated.issues.join("; "));
      assert.equal(repeated.entities.customers.equal, 1);
      await importWorkshopPackage(db, tenantId, file, phrase, repeated.confirmationId, userId, "merge");
      assert.equal((await db.prepare("SELECT count(*) AS count FROM customers WHERE tenant_id=?").get(tenantId))?.count, 2);
      assert.equal((await db.prepare("SELECT count(*) AS count FROM stock_movements WHERE tenant_id=?").get(tenantId))?.count, 1);
      assert.equal((await db.prepare("SELECT count(*) AS count FROM cash_entries WHERE tenant_id=?").get(tenantId))?.count, 2);
      assert.equal((await db.prepare("SELECT sum(amount) AS total FROM cash_entries WHERE tenant_id=?").get(tenantId))?.total, 8000);

      const replacementFile = sealTransferPackage(createTransferPayload("fixture", payload.source.tenant, {
        ...payload.records,
        document_revisions: [],
      }, payload.generatedAt), phrase);
      const replacement = await previewWorkshopImport(db, tenantId, replacementFile, phrase, userId, "replace");
      assert.equal(replacement.canImport, true, replacement.issues.join("; "));
      assert.equal(replacement.historicalDocumentsToArchive, 1);
      assert.equal(replacement.entities.customers.removed, 2);
      const replaced = await importWorkshopPackage(db, tenantId, replacementFile, phrase, replacement.confirmationId, userId, "replace", replacement.targetWorkshop);
      assert.ok(replaced.backupId);
      assert.equal((await db.prepare("SELECT count(*) AS count FROM customers WHERE tenant_id=?").get(tenantId))?.count, 1);
      const backup = await getWorkshopTransferBackup(db, tenantId, replaced.backupId!);
      assert.ok(backup);
      assert.equal(transferFileSha256(backup!), String((await db.prepare("SELECT package_sha256 FROM data_transfer_backups WHERE tenant_id=? AND id=?").get(tenantId,replaced.backupId))?.package_sha256));
      assert.equal(openTransferPackage(backup!, phrase).records.customers?.length, replacement.entities.customers.existing);
      assert.equal(openTransferPackage(backup!, phrase).records.stock_movements?.length, 1);
      assert.equal(openTransferPackage(backup!, phrase).records.cash_entries?.length, 2);
      assert.equal(openTransferPackage(backup!, phrase).records.external_captures?.length, 1);
      assert.equal(openTransferPackage(backup!, phrase).records.workshop_service_categories?.length, 1);
      assert.deepEqual(openTransferPackage(backup!, phrase).records.users, []);
      assert.deepEqual(openTransferPackage(backup!, phrase).records.memberships, []);
      assert.equal((await db.prepare("SELECT token_hash FROM sessions WHERE tenant_id=? AND token_hash=?").get(tenantId,preservedSessionHash))?.token_hash, preservedSessionHash);
      assert.equal((await db.prepare("SELECT payload FROM document_revisions WHERE tenant_id=? AND id=?").get(tenantId,revisionId))?.payload, documentPayload);
      const context = { tenantId, userId, role: "owner" } as const;
      assert.deepEqual((await documentHistory(db, context, "order", orderId)).revisions, []);
      await assert.rejects(readDocument(db, context, "order", orderId, 1), /Revisão não encontrada/);
      const archived = await readArchivedDocument(db, context, revisionId);
      assert.equal(archived.document.workshop, "Oficina Fictícia Origem");
      assert.equal((await db.prepare("SELECT count(*) AS count FROM data_transfer_archived_documents WHERE tenant_id=?").get(tenantId))?.count, 1);
      const reexported = openTransferPackage(await createWorkshopTransfer(db, tenantId, phrase), phrase);
      assert.equal(reexported.records.data_transfer_archived_documents?.length, 1);
      assert.equal(reexported.records.workshop_service_categories?.length, 1);
    }, () => false);

    await admin.query("INSERT INTO horse_power.customers(id,tenant_id,name,email) VALUES($1,$2,$3,$4)", ["rollback-customer-" + tenantId, tenantId, "Cliente Fictício Preservado", "rollback@example.invalid"]);
    const invalidPayload = createTransferPayload(payload.source.application, payload.source.tenant, {
      ...payload.records,
      catalog: payload.records.catalog!.map((row, index) => index === 0 ? { ...row, cost: -1 } : row),
    }, payload.generatedAt);
    const invalidFile = sealTransferPackage(invalidPayload, phrase);
    await assert.rejects(db.withRequestContext(settings, async () => {
      await db.setRequestIdentity(tenantId, userId);
      const invalidPreview = await previewWorkshopImport(db, tenantId, invalidFile, phrase, userId, "replace");
      assert.equal(invalidPreview.canImport, true, invalidPreview.issues.join("; "));
      return importWorkshopPackage(db, tenantId, invalidFile, phrase, invalidPreview.confirmationId, userId, "replace", "Oficina Fictícia MIG002");
    }));
    assert.equal((await admin.query("SELECT id FROM horse_power.customers WHERE id=$1 AND tenant_id=$2", ["rollback-customer-" + tenantId, tenantId])).rowCount, 1);
    assert.equal((await admin.query("SELECT id FROM horse_power.data_transfer_backups WHERE tenant_id=$1", [tenantId])).rowCount, 0);
  } finally {
    await db.close();
    if (fixtureCreated) {
      await admin.query("DELETE FROM horse_power.sessions WHERE tenant_id=$1", [tenantId]);
      await admin.query("DELETE FROM horse_power.data_transfer_backups WHERE tenant_id=$1", [tenantId]).catch(() => {});
      await admin.query("DELETE FROM horse_power.data_transfer_records WHERE tenant_id=$1", [tenantId]).catch(() => {});
      await admin.query("DELETE FROM horse_power.workshop_services WHERE tenant_id=$1", [tenantId]);
      await admin.query("DELETE FROM horse_power.workshop_service_categories WHERE tenant_id=$1", [tenantId]);
      await admin.query("DELETE FROM horse_power.customers WHERE tenant_id=$1", [tenantId]);
    }
    await admin.end();
  }
  t.diagnostic("Fixture names, IDs and document values are fictitious; transaction was rolled back.");
});

test("PostgreSQL local: importações concorrentes revalidam sob bloqueio e não duplicam registros", async () => {
  const admin = adminClient();
  await admin.connect();
  const firstDb = await createLocalDatabase(), secondDb = await createLocalDatabase();
  const tenantId = randomUUID(), userId = randomUUID(), sourceTenantId = randomUUID(), sourceUserId = randomUUID(), customerId = randomUUID();
  const phrase = "frase-ficticia-concorrencia-mig004";
  let fixtureCreated = false;
  try {
    await admin.query("INSERT INTO horse_power.tenants(id,name) VALUES($1,$2)", [tenantId, "Oficina Fictícia Concorrência"]);
    await admin.query("INSERT INTO horse_power.users(id,name,email,password_hash) VALUES($1,$2,$3,'fixture-hash')", [userId, "Proprietário Fictício Concorrência", `mig004-${userId}@example.invalid`]);
    await admin.query("INSERT INTO horse_power.memberships(user_id,tenant_id,role) VALUES($1,$2,'owner')", [userId, tenantId]);
    fixtureCreated = true;
    const file = sealTransferPackage(createTransferPayload("fixture-concurrency", { id: sourceTenantId, name: "Oficina Fictícia Origem Concorrência" }, {
      tenant: { id: sourceTenantId, name: "Oficina Fictícia Origem Concorrência" },
      users: [{ id: sourceUserId, name: "Proprietário Fictício", email: `mig004-source-${sourceUserId}@example.invalid` }],
      memberships: [{ user_id: sourceUserId, tenant_id: sourceTenantId, role: "owner" }],
      customers: [{ id: customerId, tenant_id: sourceTenantId, name: "Cliente Fictício Concorrente", phone: "", email: "", document: "", birthday: "", address: "", notes: "", active: 1, created_at: "2026-10-24T00:00:00.000Z" }],
    }, "2026-10-24T12:00:00.000Z"), phrase);
    const settings = { "app.tenant_id": tenantId, "app.user_id": userId, "app.session_hash": "", "app.login_email": "", "app.login_key": "", "app.setup_hash": "", "app.public_share_hash": "", "app.extension_hash": "" };
    const inContext = <T>(db: Awaited<ReturnType<typeof createLocalDatabase>>, fn: () => Promise<T>) => db.withRequestContext(settings, async () => { await db.setRequestIdentity(tenantId, userId); return fn(); });
    const previews = await Promise.all([inContext(firstDb, () => previewWorkshopImport(firstDb, tenantId, file, phrase, userId, "merge")), inContext(secondDb, () => previewWorkshopImport(secondDb, tenantId, file, phrase, userId, "merge"))]);
    assert.equal(previews[0].confirmationId, previews[1].confirmationId);
    const results = await Promise.allSettled([
      inContext(firstDb, () => importWorkshopPackage(firstDb, tenantId, file, phrase, previews[0].confirmationId, userId, "merge")),
      inContext(secondDb, () => importWorkshopPackage(secondDb, tenantId, file, phrase, previews[1].confirmationId, userId, "merge")),
    ]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(results.filter((result) => result.status === "rejected").length, 1);
    assert.equal((await admin.query("SELECT count(*)::int AS count FROM horse_power.customers WHERE tenant_id=$1", [tenantId])).rows[0].count, 1);
    assert.equal((await admin.query("SELECT count(*)::int AS count FROM horse_power.audit_events WHERE tenant_id=$1 AND action='data_transfer.merged'", [tenantId])).rows[0].count, 1);
  } finally {
    await firstDb.close(); await secondDb.close();
    if (fixtureCreated) {
      await admin.query("DELETE FROM horse_power.audit_events WHERE tenant_id=$1", [tenantId]);
      await admin.query("DELETE FROM horse_power.data_transfer_records WHERE tenant_id=$1", [tenantId]).catch(() => {});
      await admin.query("DELETE FROM horse_power.customers WHERE tenant_id=$1", [tenantId]);
    }
    await admin.end();
  }
});
test("PostgreSQL local: import repetido em outra oficina remapeia IDs globais sem quebrar vínculos", async (t) => {
  const admin = adminClient();
  await admin.connect();
  const db = await createLocalDatabase();
  const targetOne = randomUUID(), userOne = randomUUID(), targetTwo = randomUUID(), userTwo = randomUUID();
  const sourceTenantId = randomUUID(), sourceUserId = randomUUID();
  const categoryId = randomUUID(), customerId = randomUUID(), vehicleId = randomUUID(), professionalId = randomUUID();
  const catalogId = randomUUID(), orderId = randomUUID(), itemId = randomUUID(), receivableId = randomUUID(), serviceTimeId = randomUUID();
  const installmentId = randomUUID(), cashEntryId = randomUUID(), revisionId = randomUUID();
  const sessionHash = randomUUID().replaceAll("-", "");
  const phrase = "frase-ficticia-colisao-ids-globais";
  const snapshot = JSON.stringify({ workshop: "Oficina Fictícia Origem", order_id: orderId, total: 8000 });
  const digest = createHash("sha256").update(snapshot).digest("hex");
  let fixtureCreated = false;
  const settings = (tenantId: string, userId: string) => ({
    "app.tenant_id": tenantId, "app.user_id": userId, "app.session_hash": "",
    "app.login_email": "", "app.login_key": "", "app.setup_hash": "",
    "app.public_share_hash": "", "app.extension_hash": "",
  });
  try {
    fixtureCreated = true;
    for (const [tenantId,userId,label] of [[targetOne,userOne,"A"],[targetTwo,userTwo,"B"]] as const) {
      await admin.query("INSERT INTO horse_power.tenants(id,name) VALUES($1,$2)", [tenantId, "Oficina Fictícia Colisão " + label]);
      await admin.query("INSERT INTO horse_power.users(id,name,email,password_hash) VALUES($1,$2,$3,'fixture-preserved-hash')", [userId, "Proprietário Fictício " + label, `collision-${label}-${userId}@example.invalid`]);
      await admin.query("INSERT INTO horse_power.memberships(user_id,tenant_id,role) VALUES($1,$2,'owner')", [userId,tenantId]);
    }
    await admin.query("INSERT INTO horse_power.sessions(token_hash,user_id,tenant_id,expires_at) VALUES($1,$2,$3,$4)", [sessionHash,userTwo,targetTwo,Date.now()+3600000]);
    const file = sealTransferPackage(createTransferPayload("fixture-global-id-collision",
      { id: sourceTenantId, name: "Oficina Fictícia Origem" },
      {
        tenant: { id: sourceTenantId, name: "Oficina Fictícia Origem" },
        users: [{ id: sourceUserId, name: "Proprietário de origem fictício", email: "source-fake@example.invalid" }],
        memberships: [{ user_id: sourceUserId, tenant_id: sourceTenantId, role: "owner" }],
        product_categories: [{ id: categoryId, tenant_id: sourceTenantId, name: "Categoria Fictícia", name_key: "categoria-ficticia", active: 1 }],
        customers: [{ id: customerId, tenant_id: sourceTenantId, name: "Cliente Fictício", phone: "", email: "", document: "", birthday: "", address: "", notes: "", active: 1, created_at: "2026-10-24T00:00:00.000Z" }],
        vehicles: [{ id: vehicleId, tenant_id: sourceTenantId, customer_id: customerId, plate: "FIC1T23", brand: "Marca Fictícia", model: "Modelo Fictício", year: 2024, color: "", km: 1000, chassis: "", active: 1, service_model_id: "", service_porte_id: "" }],
        professionals: [{ id: professionalId, tenant_id: sourceTenantId, name: "Profissional Fictício", role: "Mecânico", phone: "", email: "", active: 1 }],
        catalog: [{ id: catalogId, tenant_id: sourceTenantId, kind: "product", name: "Produto Fictício", sku: "FICT-COLLISION-01", category: "Categoria Fictícia", cost: 5000, price: 8000, stock: 2, minimum_stock: 0, active: 1 }],
        service_times: [{ id: serviceTimeId, tenant_id: sourceTenantId, catalog_id: catalogId, capture_id: "capture-time-fake-001", source: "fixture", service_name: "Serviço fictício", make: "Marca fictícia", model: "Modelo fictício", vehicle_year: "2024", engine: "1.0", duration_seconds: 3600, source_price: 8000, captured_at: "2026-10-21T10:00:00.000Z" }],
        orders: [{ id: orderId, tenant_id: sourceTenantId, number: 77, customer_id: customerId, vehicle_id: vehicleId, status: "completed", entered_on: "2026-10-20", due_on: "2026-10-21", completed_on: "2026-10-21", km: 1000, problem: "Serviço fictício", notes: "", discount: 0, total: 8000, created_at: "2026-10-20T10:00:00.000Z" }],
        order_items: [{ id: itemId, tenant_id: sourceTenantId, order_id: orderId, catalog_id: catalogId, professional_id: professionalId, kind: "product", name: "Produto Fictício", quantity: 1, price: 8000, cost: 5000 }],
        receivables: [{ id: receivableId, tenant_id: sourceTenantId, order_id: orderId, customer_id: customerId, description: "OS fictícia 77", amount: 8000, due_on: "2026-10-21", status: "paid", method: "Pix", paid_at: "2026-10-21T10:00:00.000Z", plan_configured: 1, installment_count: 1, card_fee_bps: 0, interest_bps: 0, gross_total: 8000, fee_total: 0, net_total: 8000 }],
        payment_installments: [{ id: installmentId, tenant_id: sourceTenantId, receivable_id: receivableId, sequence: 1, due_on: "2026-10-21", principal: 8000, interest: 0, gross: 8000, fee: 0, net: 8000, status: "paid", paid_at: "2026-10-21T10:00:00.000Z", method: "Pix" }],
        cash_entries: [{ id: cashEntryId, tenant_id: sourceTenantId, receivable_id: receivableId, installment_id: installmentId, amount: 8000, gross_amount: 8000, fee_amount: 0, method: "Pix", created_at: "2026-10-21T10:00:00.000Z" }],
        document_revisions: [{ id: revisionId, tenant_id: sourceTenantId, kind: "order", entity_id: orderId, revision: 1, issued_at: "2026-10-21T10:00:00.000Z", issued_by: sourceUserId, payload: snapshot, digest }],
      }, "2026-10-24T12:00:00.000Z"), phrase);

    const importInto = async (tenantId: string, userId: string, mode: "empty" | "merge" = "empty") =>
      db.withRequestContext(settings(tenantId,userId), async () => {
        await db.setRequestIdentity(tenantId,userId);
        const preview = await previewWorkshopImport(db,tenantId,file,phrase,userId,mode);
        assert.equal(preview.canImport,true,preview.issues.join("; "));
        return { preview, result: await importWorkshopPackage(db,tenantId,file,phrase,preview.confirmationId,userId,mode) };
      });

    await importInto(targetOne,userOne);
    const second = await importInto(targetTwo,userTwo);
    assert.equal(second.result.counts.customers,1);
    const actual = await db.withRequestContext(settings(targetTwo,userTwo), async () => {
      await db.setRequestIdentity(targetTwo,userTwo);
      return {
        category: await db.prepare("SELECT id FROM product_categories WHERE tenant_id=? AND name_key=?").get(targetTwo,"categoria-ficticia"),
        catalog: await db.prepare("SELECT id FROM catalog WHERE tenant_id=?").get(targetTwo),
        serviceTime: await db.prepare("SELECT id,catalog_id FROM service_times WHERE tenant_id=? AND capture_id=?").get(targetTwo,"capture-time-fake-001"),
        professional: await db.prepare("SELECT id FROM professionals WHERE tenant_id=?").get(targetTwo),
        customer: await db.prepare("SELECT id FROM customers WHERE tenant_id=? AND name=?").get(targetTwo,"Cliente Fictício"),
        vehicle: await db.prepare("SELECT id,customer_id FROM vehicles WHERE tenant_id=?").get(targetTwo),
        order: await db.prepare("SELECT id,customer_id,vehicle_id FROM orders WHERE tenant_id=?").get(targetTwo),
        item: await db.prepare("SELECT id,order_id,catalog_id,professional_id,price FROM order_items WHERE tenant_id=?").get(targetTwo),
        receivable: await db.prepare("SELECT id,order_id,customer_id,amount FROM receivables WHERE tenant_id=?").get(targetTwo),
        installment: await db.prepare("SELECT id,receivable_id FROM payment_installments WHERE tenant_id=?").get(targetTwo),
        entry: await db.prepare("SELECT id,receivable_id,installment_id,amount FROM cash_entries WHERE tenant_id=?").get(targetTwo),
        document: await db.prepare("SELECT id,entity_id,issued_by,payload FROM document_revisions WHERE tenant_id=?").get(targetTwo),
        tracking: await db.prepare("SELECT target_record_id FROM data_transfer_records WHERE tenant_id=? AND source_application=? AND source_tenant_id=? AND table_name='customers' AND source_record_id=?").get(targetTwo,"fixture-global-id-collision",sourceTenantId,customerId),
      };
    });
    assert.notEqual(actual.category?.id,categoryId);
    assert.notEqual(actual.customer?.id,customerId);
    assert.notEqual(actual.vehicle?.id,vehicleId);
    assert.notEqual(actual.order?.id,orderId);
    assert.notEqual(actual.item?.id,itemId);
    assert.notEqual(actual.receivable?.id,receivableId);
    assert.notEqual(actual.installment?.id,installmentId);
    assert.notEqual(actual.entry?.id,cashEntryId);
    assert.notEqual(actual.document?.id,revisionId);
    assert.notEqual(actual.serviceTime?.id,serviceTimeId);
    assert.equal(actual.vehicle?.customer_id,actual.customer?.id);
    assert.equal(actual.order?.customer_id,actual.customer?.id);
    assert.equal(actual.order?.vehicle_id,actual.vehicle?.id);
    assert.equal(actual.item?.order_id,actual.order?.id);
    assert.equal(actual.item?.catalog_id,actual.catalog?.id);
    assert.equal(actual.serviceTime?.catalog_id,actual.catalog?.id);
    assert.equal((await admin.query("SELECT catalog_id FROM horse_power.service_times WHERE tenant_id=$1 AND id=$2",[targetOne,serviceTimeId])).rows[0].catalog_id,catalogId);
    assert.equal(actual.item?.professional_id,actual.professional?.id);
    assert.equal(actual.receivable?.order_id,actual.order?.id);
    assert.equal(actual.receivable?.customer_id,actual.customer?.id);
    assert.equal(actual.installment?.receivable_id,actual.receivable?.id);
    assert.equal(actual.entry?.receivable_id,actual.receivable?.id);
    assert.equal(actual.entry?.installment_id,actual.installment?.id);
    assert.equal(actual.entry?.amount,8000);
    assert.equal(actual.document?.entity_id,actual.order?.id);
    assert.equal(actual.document?.issued_by,userTwo);
    assert.equal(actual.document?.payload,snapshot);
    assert.equal(actual.tracking?.target_record_id,actual.customer?.id);
    assert.equal((await admin.query("SELECT password_hash FROM horse_power.users WHERE id=$1",[userTwo])).rows[0].password_hash,"fixture-preserved-hash");
    assert.equal((await admin.query("SELECT token_hash FROM horse_power.sessions WHERE token_hash=$1 AND tenant_id=$2",[sessionHash,targetTwo])).rows[0].token_hash,sessionHash);

    const repeated=await importInto(targetTwo,userTwo,"merge");
    assert.equal(repeated.preview.entities.customers.equal,1);
    assert.equal(repeated.preview.entities.orders.equal,1);
    assert.equal(repeated.preview.entities.cash_entries.equal,1);
    assert.equal(repeated.result.counts.customers,1);
    assert.equal((await admin.query("SELECT count(*)::int AS count FROM horse_power.customers WHERE tenant_id=$1",[targetTwo])).rows[0].count,1);
    assert.equal((await admin.query("SELECT sum(amount)::int AS total FROM horse_power.cash_entries WHERE tenant_id=$1",[targetTwo])).rows[0].total,8000);
  } finally {
    await db.close();
    if (fixtureCreated) {
      const tenantIds=[targetOne,targetTwo];
      for (const table of ["data_transfer_archived_documents","document_revisions","checklist_photos","checklists","service_times","external_captures","external_catalog_links","service_merge_history","service_aliases","cash_movements","payables","cash_entries","payment_installments","receivables","stock_movements","stock_invoice_products","stock_invoices","order_items","orders","cash_accounts","payment_settings","card_rates","labor_commercial_rates","labor_rates","expense_templates","catalog","product_categories","suppliers","professionals","workshop_services","customers","data_transfer_records","data_transfer_backups","audit_events"]) {
        for (const id of tenantIds) await admin.query(`DELETE FROM horse_power.${table} WHERE tenant_id=$1`,[id]).catch(()=>{});
      }
      for (const id of tenantIds) {
        await admin.query("DELETE FROM horse_power.sessions WHERE tenant_id=$1",[id]).catch(()=>{});
      }
    }
    await admin.end();
  }
  t.diagnostic("Collision fixture uses fictitious tenants and values; target rows retain no real-world data.");
});
