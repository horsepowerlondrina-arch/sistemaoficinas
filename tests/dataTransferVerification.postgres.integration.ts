import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import test from "node:test";
import { adminClient } from "../scripts/local-admin.js";
import { createLocalDatabase } from "../server/db/local.js";
import { createTransferPayload, openTransferPackage, sealTransferPackage, transferFileSha256 } from "../shared/transferPackage.js";
import { getWorkshopTransferBackup, importWorkshopPackage, previewWorkshopImport } from "../server/services/dataTransferImport.js";
import { documentHistory, readArchivedDocument, readDocument } from "../server/services/documents.js";
import { createWorkshopTransfer } from "../server/services/dataTransferExport.js";
import { TransferVerificationError, verifyWorkshopImport } from "../server/services/dataTransferVerification.js";
import { createPlatformAdminDataTransfer } from "../server/services/platformAdminDataTransfer.js";

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
  const otherTenantId = randomUUID(), otherCustomerId = randomUUID();
  const customerId = randomUUID(), vehicleId = randomUUID(), professionalId = randomUUID();
  const catalogId = randomUUID(), orderId = randomUUID(), itemId = randomUUID(), movementId = randomUUID(), receivableId = randomUUID(), installmentId = randomUUID(), installmentId2 = randomUUID(), cashEntryId = randomUUID(), cashEntryId2 = randomUUID(), externalCaptureId = randomUUID(), revisionId = randomUUID();
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
    await admin.query("INSERT INTO horse_power.tenants(id,name,document,phone,address) VALUES($1,$2,'','','')", [otherTenantId, "Oficina Fictícia Isolamento"]);
    await admin.query("INSERT INTO horse_power.customers(id,tenant_id,name,email) VALUES($1,$2,$3,$4)", [otherCustomerId, otherTenantId, "Cliente Fictício Isolamento", "isolamento@example.invalid"]);
    const payload = createTransferPayload("fixture", { id: sourceTenantId, name: "Oficina Fictícia Origem" }, {
      tenant: { id: sourceTenantId, name: "Oficina Fictícia Origem", document: "", phone: "", address: "" },
      users: [{ id: sourceUserId, name: "Proprietário Fictício", email: `source-${sourceUserId}@example.invalid` }],
      memberships: [{ user_id: sourceUserId, tenant_id: sourceTenantId, role: "owner" }],
      customers: [{ id: customerId, tenant_id: sourceTenantId, name: "Cliente Fictício", phone: "", email: "", document: "", birthday: "", address: "", notes: "", active: 1, created_at: "2026-10-24T00:00:00.000Z" }],
      vehicles: [{ id: vehicleId, tenant_id: sourceTenantId, customer_id: customerId, plate: "ABC1D23", brand: "Marca Fictícia", model: "Modelo Fictício", year: 2024, color: "", km: 1000, chassis: "", active: 1, service_model_id: "", service_porte_id: "" }],
      professionals: [{ id: professionalId, tenant_id: sourceTenantId, name: "Mecânico Fictício", role: "Mecânico", phone: "", email: "", active: 1 }],
      catalog: [{ id: catalogId, tenant_id: sourceTenantId, kind: "product", name: "Peça Fictícia", sku: "FAKE-MIG004", category: "Teste", cost: 5000, price: 8000, stock: 3, minimum_stock: 0, active: 1 }],
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
      audit_events: [{ id: randomUUID(), tenant_id: sourceTenantId, user_id: sourceUserId, action: "fixture.history", entity_id: orderId, created_at: "2026-10-21T10:00:00.000Z" }],
    }, "2026-10-24T12:00:00.000Z");
    const file = sealTransferPackage(payload, phrase);
    const settings = { "app.tenant_id": tenantId, "app.user_id": userId, "app.session_hash": "", "app.login_email": "", "app.login_key": "", "app.setup_hash": "", "app.public_share_hash": "", "app.extension_hash": "" };
    await db.withRequestContext(settings, async () => {
      await db.setRequestIdentity(tenantId, userId);
      const preview = await previewWorkshopImport(db, tenantId, file, phrase, userId);
      assert.equal(preview.canImport, true, preview.issues.join("; "));
      const beforeImportVerification = await verifyWorkshopImport(db, tenantId, file, phrase, userId, "empty");
      assert.equal(beforeImportVerification.mode, "empty");
      assert.equal(beforeImportVerification.entities.customers.missing, 1);
      assert.equal(beforeImportVerification.overall, "divergent");
      const adminTargetPool={query:async (_sql:string,values:unknown[] = []) => {
        assert.deepEqual(values,[tenantId]);
        return {rowCount:1,rows:[{tenant_id:tenantId,name:"Oficina Fictícia MIG002"}]};
      }} as never;
      const adminTransfer=createPlatformAdminDataTransfer(db,adminTargetPool);
      const stagedExport=await adminTransfer.stageExport(tenantId,phrase);
      const stagedParts:Buffer[]=[];
      for(let index=0;index<stagedExport.chunkCount;index++){
        const part=await adminTransfer.exportChunk(tenantId,stagedExport.id,index);
        assert.ok(part);
        stagedParts.push(part.bytes);
      }
      const stagedFile=Buffer.concat(stagedParts);
      assert.equal(stagedFile.length,stagedExport.size);
      assert.equal(transferFileSha256(stagedFile),stagedExport.sha256);
      assert.equal(openTransferPackage(stagedFile,phrase).source.tenant.id,tenantId);
      assert.equal(await adminTransfer.exportChunk(tenantId,stagedExport.id,stagedExport.chunkCount),undefined);

      const largeId=randomUUID();
      const largeEncryptedFixture=randomBytes(2*1024*1024+17);
      await db.prepare("INSERT INTO data_transfer_backups(id,tenant_id,created_by,package_sha256,package,expires_at) VALUES(?,?,?,?,?,?)")
        .run(largeId,tenantId,userId,transferFileSha256(largeEncryptedFixture),largeEncryptedFixture,new Date(Date.now()+3600000).toISOString());
      const largeParts=await Promise.all([0,1,2].map(index=>adminTransfer.exportChunk(tenantId,largeId,index)));
      assert.equal(largeParts.every(Boolean),true);
      assert.deepEqual(Buffer.concat(largeParts.map(part=>part!.bytes)),largeEncryptedFixture);
      assert.equal(await adminTransfer.exportChunk(tenantId,largeId,3),undefined);
      assert.equal(await adminTransfer.exportChunk(tenantId,randomUUID(),0),undefined);
      const beforeReadOnlyCounts=await db.prepare("SELECT (SELECT count(*) FROM customers WHERE tenant_id=?) AS customers,(SELECT count(*) FROM audit_events WHERE tenant_id=?) AS audit_events").get(tenantId,tenantId);
      const adminVerification=await adminTransfer.verify(tenantId,file.toString("utf8"),phrase,"empty");
      assert.equal((adminVerification as {overall:string}).overall,"divergent");
      assert.equal((adminVerification as {entities:Record<string,{missing:number}>}).entities.customers.missing,1);
      const afterReadOnlyCounts=await db.prepare("SELECT (SELECT count(*) FROM customers WHERE tenant_id=?) AS customers,(SELECT count(*) FROM audit_events WHERE tenant_id=?) AS audit_events").get(tenantId,tenantId);
      assert.deepEqual(afterReadOnlyCounts,beforeReadOnlyCounts,"a conferência administrativa não deve alterar dados nem auditoria operacional");
      await assert.rejects(adminTransfer.verify(tenantId,file.toString("utf8"),"frase-incorreta-ficticia","empty"),
        error=>error instanceof TransferVerificationError && error.code==="invalid_package");
      await assert.rejects(verifyWorkshopImport(db, tenantId, file, "frase-incorreta-ficticia", userId, "empty"),
        error=>error instanceof TransferVerificationError && error.code==="invalid_package");
      const result = await importWorkshopPackage(db, tenantId, file, phrase, preview.confirmationId, userId);
      assert.equal(result.counts.external_catalog_links, 1);
      const externalLink = await db.prepare("SELECT source,external_key,catalog_id FROM external_catalog_links WHERE tenant_id=?").get(tenantId);
      assert.deepEqual(externalLink, { source: "fixture", external_key: "external-key-fake", catalog_id: catalogId });
      assert.equal(result.counts.external_captures, 1);
      const capture = await db.prepare("SELECT batch_id,source_quantity,freight_total FROM external_captures WHERE tenant_id=? AND id=?").get(tenantId, externalCaptureId);
      assert.deepEqual(capture, { batch_id: "batch-fake-001", source_quantity: 2, freight_total: 350 });
      assert.equal(result.counts.customers, 1);
      assert.equal(result.counts.vehicles, 1);
      assert.equal(result.counts.orders, 1);
      assert.equal(result.counts.stock_movements, 1);
      assert.equal(result.counts.payment_installments, 2);
      assert.equal(result.counts.cash_entries, 2);
      const emptyVerification = await verifyWorkshopImport(db, tenantId, file, phrase, userId, "empty");
      assert.equal(emptyVerification.mode, "empty");
      assert.equal(emptyVerification.entities.customers.corresponding, 1);
      const auditCountBefore = (await db.prepare("SELECT count(*) AS count FROM audit_events WHERE tenant_id=?").get(tenantId))?.count;
      await admin.query("INSERT INTO horse_power.customers(id,tenant_id,name,email) VALUES($1,$2,$3,$4)", ["unrelated-customer-" + tenantId, tenantId, "Cliente Fictício Não Importado", "unrelated@example.invalid"]);
      const initialVerification = await verifyWorkshopImport(db, tenantId, file, phrase, userId, "merge");
      assert.equal(initialVerification.entities.customers.missing, 0);
      assert.equal(initialVerification.entities.customers.corresponding, 1);
      assert.equal(initialVerification.entities.customers.unrelatedExistingIgnored, 1);
      assert.equal(initialVerification.entities.customers.destinationRows, 2, "a contagem deve excluir os dados da outra oficina");
      assert.equal(initialVerification.entities.cash_entries.corresponding, 2);
      assert.equal(initialVerification.entities.orders.destinationMatched, 1, JSON.stringify(initialVerification.entities.orders.records));
      assert.equal(initialVerification.entities.orders.divergent, 0, JSON.stringify(initialVerification.entities.orders.records));
      assert.equal(initialVerification.entities.orders.notVerifiable, 1, JSON.stringify(initialVerification.entities.orders.records));
      assert.equal(initialVerification.entities.document_revisions.transformed, 1);
      assert.equal(initialVerification.policy.auditEventsExcluded, 1);
      assert.ok(initialVerification.policy.authorsRemapped > 0);
      assert.equal(initialVerification.entities.audit_events.destinationRows, null);
      assert.equal(initialVerification.financial["cash_entries.amount"]?.differenceCents, "0");
      assert.equal(initialVerification.stock.differenceUnits, "0");
      assert.equal(initialVerification.historicalDocuments.missing, 0);
      assert.equal((await db.prepare("SELECT count(*) AS count FROM audit_events WHERE tenant_id=?").get(tenantId))?.count, auditCountBefore, "a conferência não deve gerar eventos de auditoria");

      await db.prepare("UPDATE customers SET name=? WHERE tenant_id=? AND id=?").run("Cliente Fictício Alterado", tenantId, customerId);
      const changedCustomer = await verifyWorkshopImport(db, tenantId, file, phrase, userId, "merge");
      assert.equal(changedCustomer.entities.customers.divergent, 1);
      assert.ok(changedCustomer.entities.customers.records.some((record) => record.recordId === customerId && record.differingFields?.includes("name")));
      await db.prepare("UPDATE customers SET name=? WHERE tenant_id=? AND id=?").run("Cliente Fictício", tenantId, customerId);

      await db.prepare("UPDATE catalog SET stock=? WHERE tenant_id=? AND id=?").run(6, tenantId, catalogId);
      const changedStock = await verifyWorkshopImport(db, tenantId, file, phrase, userId, "merge");
      assert.equal(changedStock.stock.differenceUnits, "3");
      assert.equal(changedStock.entities.catalog.divergent, 1);
      await db.prepare("UPDATE catalog SET stock=? WHERE tenant_id=? AND id=?").run(3, tenantId, catalogId);

      await db.prepare("UPDATE cash_entries SET amount=? WHERE tenant_id=? AND id=?").run(4025, tenantId, cashEntryId);
      const changedPayment = await verifyWorkshopImport(db, tenantId, file, phrase, userId, "merge");
      assert.equal(changedPayment.financial["cash_entries.amount"]?.differenceCents, "25");
      assert.equal(changedPayment.entities.cash_entries.divergent, 1);
      await db.prepare("UPDATE cash_entries SET amount=? WHERE tenant_id=? AND id=?").run(4000, tenantId, cashEntryId);

      await admin.query("UPDATE horse_power.memberships SET role='operator' WHERE tenant_id=$1 AND user_id=$2", [tenantId, userId]);
      await assert.rejects(verifyWorkshopImport(db, tenantId, file, phrase, userId, "merge"),
        error=>error instanceof TransferVerificationError && error.code==="authorization");
      await admin.query("UPDATE horse_power.memberships SET role='owner' WHERE tenant_id=$1 AND user_id=$2", [tenantId, userId]);
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
      const replacementVerification = await verifyWorkshopImport(db, tenantId, replacementFile, phrase, userId, "replace");
      assert.equal(replacementVerification.historicalDocuments.missing, 0);
      assert.equal(replacementVerification.historicalDocuments.preservedDestinationArchives, 1);
      assert.equal(replacementVerification.backups.existing, 1);
      assert.equal(replacementVerification.backups.integrityValid, 1);
      assert.equal(replacementVerification.backups.integrityInvalid, 0);
      const reexported = openTransferPackage(await createWorkshopTransfer(db, tenantId, phrase), phrase);
      assert.equal(reexported.records.data_transfer_archived_documents?.length, 1);
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
      await admin.query("DELETE FROM horse_power.customers WHERE tenant_id=$1", [tenantId]);
      await admin.query("DELETE FROM horse_power.memberships WHERE tenant_id=$1", [tenantId]);
      await admin.query("DELETE FROM horse_power.users WHERE id=$1", [userId]);
      await admin.query("DELETE FROM horse_power.tenants WHERE id=$1", [tenantId]);
      await admin.query("DELETE FROM horse_power.customers WHERE tenant_id=$1", [otherTenantId]);
      await admin.query("DELETE FROM horse_power.tenants WHERE id=$1", [otherTenantId]);
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
      await admin.query("DELETE FROM horse_power.memberships WHERE tenant_id=$1", [tenantId]);
      await admin.query("DELETE FROM horse_power.users WHERE id=$1", [userId]);
      await admin.query("DELETE FROM horse_power.tenants WHERE id=$1", [tenantId]);
    }
    await admin.end();
  }
});
test("PostgreSQL local: admin transfer uses scoped RLS context and verifies a workshop without an owner", async (t) => {
  const admin = adminClient();
  await admin.connect();
  const db = await createLocalDatabase();
  const ownerlessTenantId = randomUUID(), ownerTenantId = randomUUID(), otherTenantId = randomUUID();
  const ownerUserId = randomUUID(), otherUserId = randomUUID();
  const phrase = "frase-ficticia-contexto-administrativo";
  const tenantIds = [ownerlessTenantId, ownerTenantId, otherTenantId];
  let fixtureCreated = false;
  try {
    await admin.query("INSERT INTO horse_power.tenants(id,name,document,phone,address) VALUES($1,$2,'','','')", [ownerlessTenantId, "Oficina Fictícia sem Proprietário"]);
    await admin.query("INSERT INTO horse_power.tenants(id,name,document,phone,address) VALUES($1,$2,'','','')", [ownerTenantId, "Oficina Fictícia Administrativa"]);
    await admin.query("INSERT INTO horse_power.tenants(id,name,document,phone,address) VALUES($1,$2,'','','')", [otherTenantId, "Oficina Fictícia Isolada"]);
    fixtureCreated = true;
    await admin.query("INSERT INTO horse_power.users(id,name,email,password_hash) VALUES($1,$2,$3,'fixture-hash'),($4,$5,$6,'fixture-hash')", [
      ownerUserId, "Proprietário Fictício", `owner-${ownerUserId}@example.invalid`,
      otherUserId, "Proprietário Fictício Isolado", `owner-${otherUserId}@example.invalid`,
    ]);
    await admin.query("INSERT INTO horse_power.memberships(user_id,tenant_id,role) VALUES($1,$2,'owner'),($3,$4,'owner')", [
      ownerUserId, ownerTenantId, otherUserId, otherTenantId,
    ]);
    await admin.query("INSERT INTO horse_power.customers(id,tenant_id,name,email) VALUES($1,$2,$3,$4)", [
      randomUUID(), otherTenantId, "Cliente Fictício Isolado", "isolado@example.invalid",
    ]);

    const hiddenOwner = await db.withTenantRead!(ownerTenantId, async () =>
      db.prepare("SELECT user_id FROM memberships WHERE tenant_id=? AND role='owner' ORDER BY user_id LIMIT 1").get(ownerTenantId));
    assert.equal(hiddenOwner, undefined, "a leitura comum não deve atravessar a política de vínculo próprio");
    const scopedOwner = await db.withTenantServiceRead!(ownerTenantId, async () =>
      db.prepare("SELECT user_id FROM memberships WHERE tenant_id=? AND role='owner' ORDER BY user_id LIMIT 1").get(ownerTenantId));
    assert.equal(scopedOwner?.user_id, ownerUserId, "o contexto de serviço só deve revelar o proprietário da oficina selecionada");
    const foreignOwner = await db.withTenantServiceRead!(ownerTenantId, async () =>
      db.prepare("SELECT user_id FROM memberships WHERE tenant_id=? AND role='owner' ORDER BY user_id LIMIT 1").get(otherTenantId));
    assert.equal(foreignOwner, undefined, "o contexto de serviço não deve revelar vínculos de outra oficina");

    const names = new Map<string, string>([[ownerlessTenantId, "Oficina Fictícia sem Proprietário"], [ownerTenantId, "Oficina Fictícia Administrativa"]]);
    const adminTargetPool = {
      query: async (_sql: string, values: unknown[] = []) => {
        const tenantId = String(values[0] || "");
        const name = names.get(tenantId);
        return name ? { rowCount: 1, rows: [{ tenant_id: tenantId, name }] } : { rowCount: 0, rows: [] };
      },
    } as never;
    const transfer = createPlatformAdminDataTransfer(db, adminTargetPool);

    const exported = await transfer.exportPackage(ownerlessTenantId, phrase);
    const payload = openTransferPackage(exported.archive, phrase);
    assert.equal(payload.records.customers?.length || 0, 0, "a exportação não deve incluir dados da oficina vizinha");
    assert.equal(payload.records.memberships?.length || 0, 0, "a exportação não deve inventar vínculos de acesso");
    const beforeRead = await admin.query("SELECT (SELECT count(*) FROM horse_power.audit_events WHERE tenant_id=$1) AS audit_count,(SELECT count(*) FROM horse_power.customers WHERE tenant_id=$1) AS customer_count", [ownerlessTenantId]);
    const report = await transfer.verify(ownerlessTenantId, exported.archive.toString("utf8"), phrase, "empty") as { mode: string };
    assert.equal(report.mode, "empty", "a conferência deve funcionar sem membership owner");
    const afterRead = await admin.query("SELECT (SELECT count(*) FROM horse_power.audit_events WHERE tenant_id=$1) AS audit_count,(SELECT count(*) FROM horse_power.customers WHERE tenant_id=$1) AS customer_count", [ownerlessTenantId]);
    assert.deepEqual(afterRead.rows, beforeRead.rows, "exportação e conferência não devem gravar dados nem auditoria operacional");
    await assert.rejects(transfer.verify(otherTenantId, exported.archive.toString("utf8"), phrase, "empty"),
      error => error instanceof TransferVerificationError && error.code === "workshop_unavailable");

    const preview = await transfer.preview(ownerTenantId, exported.archive.toString("utf8"), phrase, "merge") as { canImport: boolean; confirmationId: string };
    assert.equal(preview.canImport, true);
    const merged = await transfer.import(ownerTenantId, exported.archive.toString("utf8"), phrase, preview.confirmationId, "merge", undefined) as { mode: string };
    assert.equal(merged.mode, "merge");

    const replacePreview = await transfer.preview(ownerTenantId, exported.archive.toString("utf8"), phrase, "replace") as { canImport: boolean; confirmationId: string; targetWorkshop: string };
    assert.equal(replacePreview.canImport, true);
    const replaced = await transfer.import(ownerTenantId, exported.archive.toString("utf8"), phrase, replacePreview.confirmationId, "replace", replacePreview.targetWorkshop, randomUUID()) as { mode: string; backupId?: string };
    assert.equal(replaced.mode, "replace");
    assert.ok(replaced.backupId, "a substituição deve gerar backup validado");

    const protectedRows = await admin.query("SELECT (SELECT count(*) FROM horse_power.users WHERE id=$1) AS user_count,(SELECT count(*) FROM horse_power.memberships WHERE tenant_id=$2) AS membership_count,(SELECT count(*) FROM horse_power.data_transfer_backups WHERE tenant_id=$2) AS backup_count,(SELECT count(*) FROM horse_power.customers WHERE tenant_id=$3) AS other_customer_count", [
      ownerUserId, ownerTenantId, otherTenantId,
    ]);
    assert.deepEqual(protectedRows.rows[0], { user_count: 1, membership_count: 1, backup_count: 1, other_customer_count: 1 },
      "importações devem preservar usuários e vínculos e manter isolada a oficina vizinha");
  } finally {
    await db.close();
    if (fixtureCreated) {
      await admin.query("DELETE FROM horse_power.audit_events WHERE tenant_id=ANY($1::text[])", [tenantIds]);
      await admin.query("DELETE FROM horse_power.data_transfer_backups WHERE tenant_id=ANY($1::text[])", [tenantIds]).catch(() => {});
      await admin.query("DELETE FROM horse_power.data_transfer_records WHERE tenant_id=ANY($1::text[])", [tenantIds]).catch(() => {});
      await admin.query("DELETE FROM horse_power.data_transfer_archived_documents WHERE tenant_id=ANY($1::text[])", [tenantIds]).catch(() => {});
      await admin.query("DELETE FROM horse_power.customers WHERE tenant_id=ANY($1::text[])", [tenantIds]);
      await admin.query("DELETE FROM horse_power.memberships WHERE tenant_id=ANY($1::text[])", [tenantIds]);
      await admin.query("DELETE FROM horse_power.users WHERE id=ANY($1::text[])", [[ownerUserId, otherUserId]]);
      await admin.query("DELETE FROM horse_power.tenants WHERE id=ANY($1::text[])", [tenantIds]);
    }
    await admin.end();
  }
  t.diagnostic("Testa somente dados fictícios; a oficina sem proprietário foi apenas exportada e conferida.");
});
