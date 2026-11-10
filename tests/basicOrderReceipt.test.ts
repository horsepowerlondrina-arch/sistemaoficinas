import test from "node:test";
import assert from "node:assert/strict";
import { createDatabase } from "../server/db/database.js";
import { configurePlan } from "../server/services/payments.js";
import { listOrders, recordBasicOrderReceipt, saveOrder, transitionOrder } from "../server/services/workshop.js";
import { workspaceForModules } from "../shared/workshopModules.js";

const basicOwner = { userId: "u", tenantId: "a", role: "owner", modules: { orders: true, finance: false } };

function fixture() {
  const db = createDatabase(":memory:");
  db.exec(
    "INSERT INTO tenants(id,name) VALUES('a','A'),('b','B'); " +
    "INSERT INTO users VALUES('u','Admin','a@example.test','disabled'); " +
    "INSERT INTO customers(id,tenant_id,name) VALUES('c','a','Cliente'); " +
    "INSERT INTO vehicles(id,tenant_id,customer_id,plate,brand,model,year) VALUES('v','a','c','ABC1D23','Marca','Modelo',2020); " +
    "INSERT INTO catalog(id,tenant_id,kind,name,sku,cost,price,stock) VALUES('p','a','product','Peça','P',1000,2001,5)",
  );
  return db;
}

async function completedOrder(db: ReturnType<typeof createDatabase>) {
  const orderId = await saveOrder(db, basicOwner, {
    status: "open", entered_on: "2026-10-14", due_on: "2026-10-15", km: 0,
    customer_id: "c", vehicle_id: "v", problem: "", notes: "", discount: 0,
    items: [{ catalog_id: "p", quantity: 1, price: 2001 }],
  });
  await transitionOrder(db, basicOwner, orderId, "completed");
  return orderId;
}

test("Básico finaliza OS e registra recebimento integral uma única vez", async () => {
  const db = fixture();
  try {
    const orderId = await completedOrder(db);
    const before = workspaceForModules({ orders: await listOrders(db, "a"), cash_accounts: [] }, basicOwner.modules);
    assert.equal(before.orders[0].status, "completed");
    assert.equal(before.orders[0].display_status, "completed");
    assert.equal(before.orders[0].payment_status, "open");

    await recordBasicOrderReceipt(db, basicOwner, orderId, "Pix");
    const receivable = db.prepare("SELECT id,status,amount FROM receivables WHERE tenant_id='a' AND order_id=?").get(orderId)!;
    assert.equal(receivable.status, "paid");
    assert.equal(receivable.amount, 2001);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM payment_installments WHERE tenant_id='a' AND receivable_id=?").get(receivable.id)!.n, 1);
    assert.deepEqual(db.prepare("SELECT amount,gross_amount,fee_amount,method FROM cash_entries WHERE tenant_id='a' AND receivable_id=?").get(receivable.id),
      { amount: 2001, gross_amount: 2001, fee_amount: 0, method: "Pix" });
    assert.equal(db.prepare("SELECT COUNT(*) n FROM audit_events WHERE tenant_id='a' AND entity_id=? AND action='order.basic_receipt_registered'").get(orderId)!.n, 1);
    await assert.rejects(recordBasicOrderReceipt(db, basicOwner, orderId, "Pix"), /já foi registrado/);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM cash_entries WHERE tenant_id='a'").get()!.n, 1);
    await assert.rejects(transitionOrder(db, basicOwner, orderId, "open"), /recebimento confirmado/);
  } finally {
    db.close();
  }
});

test("recebimento simples exige oficina, administrador, módulo e método permitidos", async () => {
  const db = fixture();
  try {
    const orderId = await completedOrder(db);
    await assert.rejects(recordBasicOrderReceipt(db, { ...basicOwner, tenantId: "b" }, orderId, "Pix"), /não encontrado/);
    await assert.rejects(recordBasicOrderReceipt(db, { ...basicOwner, role: "operator" }, orderId, "Pix"), /administrador/);
    await assert.rejects(recordBasicOrderReceipt(db, { ...basicOwner, modules: { orders: true, finance: true } }, orderId, "Pix"), /indisponível/);
    await assert.rejects(recordBasicOrderReceipt(db, basicOwner, orderId, "Cartão de crédito" as never), /indisponível/);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM cash_entries WHERE tenant_id='a'").get()!.n, 0);
  } finally {
    db.close();
  }
});

test("recebimento simples preserva plano existente e exige conta ativa quando houver", async () => {
  const db = fixture();
  try {
    const orderId = await completedOrder(db);
    const receivable = db.prepare("SELECT id FROM receivables WHERE tenant_id='a' AND order_id=?").get(orderId)!;
    await configurePlan(db, { ...basicOwner, modules: { orders: true, finance: true } }, String(receivable.id), {
      method: "Pix", installments: 1, card_fee_bps: 0, interest_bps: 0, first_due_on: "2026-10-15",
    });
    await assert.rejects(recordBasicOrderReceipt(db, basicOwner, orderId, "Pix"), /condições ou pagamentos/);
    assert.equal(db.prepare("SELECT status FROM receivables WHERE id=?").get(receivable.id)!.status, "open");
    assert.equal(db.prepare("SELECT COUNT(*) n FROM cash_entries WHERE receivable_id=?").get(receivable.id)!.n, 0);

    const nextOrder = await saveOrder(db, basicOwner, {
      status: "open", entered_on: "2026-10-14", due_on: "2026-10-15", km: 0,
      customer_id: "c", vehicle_id: "v", problem: "", notes: "", discount: 0,
      items: [{ catalog_id: "p", quantity: 1, price: 2001 }],
    });
    await transitionOrder(db, basicOwner, nextOrder, "completed");
    db.prepare("INSERT INTO cash_accounts(id,tenant_id,name,kind,opening_balance,opening_on,active) VALUES('account-a','a','Caixa','cash',0,'2026-01-01',1)").run();
    await assert.rejects(recordBasicOrderReceipt(db, basicOwner, nextOrder, "Dinheiro"), /Selecione a conta/);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM cash_entries WHERE tenant_id='a'").get()!.n, 0);
    await recordBasicOrderReceipt(db, basicOwner, nextOrder, "Dinheiro", "account-a");
    assert.equal(db.prepare("SELECT COUNT(*) n FROM cash_movements WHERE tenant_id='a' AND account_id='account-a' AND origin='receipt'").get()!.n, 1);
  } finally {
    db.close();
  }
});
