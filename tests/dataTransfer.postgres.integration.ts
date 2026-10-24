import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import test from "node:test";
import { adminClient } from "../scripts/local-admin.js";
import { createLocalDatabase } from "../server/db/local.js";
import { createTransferPayload, sealTransferPackage } from "../shared/transferPackage.js";
import { importWorkshopPackage, previewWorkshopImport } from "../server/services/dataTransferImport.js";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
if (existsSync(".env.platform-admin.local")) process.loadEnvFile(".env.platform-admin.local");

test("PostgreSQL local: transferência fictícia completa preserva IDs, relações e snapshot e reverte a transação", async (t) => {
  const admin = adminClient();
  await admin.connect();
  const db = await createLocalDatabase();
  const tenantId = randomUUID(), userId = randomUUID();
  const sourceTenantId = randomUUID(), sourceUserId = randomUUID();
  const customerId = randomUUID(), vehicleId = randomUUID(), professionalId = randomUUID();
  const catalogId = randomUUID(), orderId = randomUUID(), itemId = randomUUID(), revisionId = randomUUID();
  const phrase = "frase-ficticia-postgres-mig002";
  let fixtureCreated = false;
  try {
    await admin.query("INSERT INTO horse_power.tenants(id,name,document,phone,address) VALUES($1,$2,'','','')", [tenantId, "Oficina Fictícia MIG002"]);
    await admin.query("INSERT INTO horse_power.users(id,name,email,password_hash) VALUES($1,$2,$3,'fixture-hash')", [userId, "Proprietário Fictício", `mig002-${userId}@example.invalid`]);
    await admin.query("INSERT INTO horse_power.memberships(user_id,tenant_id,role) VALUES($1,$2,'owner')", [userId, tenantId]);
    fixtureCreated = true;
    const payload = createTransferPayload("fixture", { id: sourceTenantId, name: "Oficina Fictícia Origem" }, {
      tenant: { id: sourceTenantId, name: "Oficina Fictícia Origem", document: "", phone: "", address: "" },
      users: [{ id: sourceUserId, name: "Proprietário Fictício", email: `mig002-${userId}@example.invalid` }],
      memberships: [{ user_id: sourceUserId, tenant_id: sourceTenantId, role: "owner" }],
      customers: [{ id: customerId, tenant_id: sourceTenantId, name: "Cliente Fictício", phone: "", email: "", document: "", birthday: "", address: "", notes: "", active: 1, created_at: "2026-10-24T00:00:00.000Z" }],
      vehicles: [{ id: vehicleId, tenant_id: sourceTenantId, customer_id: customerId, plate: "ABC1D23", brand: "Marca Fictícia", model: "Modelo Fictício", year: 2024, color: "", km: 1000, chassis: "", active: 1, service_model_id: "", service_porte_id: "" }],
      professionals: [{ id: professionalId, tenant_id: sourceTenantId, name: "Mecânico Fictício", role: "Mecânico", phone: "", email: "", active: 1 }],
      catalog: [{ id: catalogId, tenant_id: sourceTenantId, kind: "service", name: "Serviço de Teste", sku: "FAKE-MIG002", category: "", cost: 5000, price: 8000, stock: 0, minimum_stock: 0, active: 1 }],
      orders: [{ id: orderId, tenant_id: sourceTenantId, number: 1, customer_id: customerId, vehicle_id: vehicleId, status: "completed", entered_on: "2026-10-20", due_on: "2026-10-21", completed_on: "2026-10-21", km: 1000, problem: "Dado fictício", notes: "", discount: 0, total: 8000, created_at: "2026-10-20T10:00:00.000Z" }],
      order_items: [{ id: itemId, tenant_id: sourceTenantId, order_id: orderId, catalog_id: catalogId, professional_id: professionalId, kind: "service", name: "Serviço de Teste", quantity: 1, price: 8000, cost: 5000 }],
      document_revisions: [{ id: revisionId, tenant_id: sourceTenantId, kind: "order", entity_id: orderId, revision: 1, issued_at: "2026-10-21T10:00:00.000Z", issued_by: sourceUserId, payload: JSON.stringify({ workshop: "Oficina Fictícia Origem", order_id: orderId, total: 8000 }), digest: "fictitious-document-digest" }],
    }, "2026-10-24T12:00:00.000Z");
    const file = sealTransferPackage(payload, phrase);
    const settings = { "app.tenant_id": tenantId, "app.user_id": userId, "app.session_hash": "", "app.login_email": "", "app.login_key": "", "app.setup_hash": "", "app.public_share_hash": "", "app.extension_hash": "" };
    await db.withRequestContext(settings, async () => {
      await db.setRequestIdentity(tenantId, userId);
      const preview = await previewWorkshopImport(db, tenantId, file, phrase);
      assert.equal(preview.canImport, true, preview.issues.join("; "));
      const result = await importWorkshopPackage(db, tenantId, file, phrase, preview.confirmationId, userId);
      assert.equal(result.counts.customers, 1);
      assert.equal(result.counts.vehicles, 1);
      assert.equal(result.counts.orders, 1);
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
      assert.match(String(rows?.payload), /Oficina Fictícia Origem/);
      assert.equal((await db.prepare("SELECT action FROM audit_events WHERE tenant_id=? AND user_id=?").get(tenantId,userId))?.action, "data_transfer.imported");
      const repeated = await previewWorkshopImport(db, tenantId, file, phrase);
      assert.equal(repeated.canImport, false);
    }, () => false);
  } finally {
    await db.close();
    if (fixtureCreated) {
      await admin.query("DELETE FROM horse_power.memberships WHERE tenant_id=$1", [tenantId]);
      await admin.query("DELETE FROM horse_power.users WHERE id=$1", [userId]);
      await admin.query("DELETE FROM horse_power.tenants WHERE id=$1", [tenantId]);
    }
    await admin.end();
  }
  t.diagnostic("Fixture names, IDs and document values are fictitious; transaction was rolled back.");
});
