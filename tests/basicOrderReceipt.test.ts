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
    const cashEntry = db.prepare("SELECT amount,gross_amount,fee_amount,method FROM cash_entries WHERE tenant_id='a' AND receivable_id=?").get(receivable.id)!;
    assert.equal(cashEntry.amount, 2001);
    assert.equal(cashEntry.gross_amount, 2001);
    assert.equal(cashEntry.fee_amount, 0);
    assert.equal(cashEntry.method, "Pix");
    assert.equal(db.prepare("SELECT COUNT(*) n FROM audit_events WHERE tenant_id='a' AND entity_id=? AND action='order.basic_receipt_registered'").get(orderId)!.n, 1);
    await assert.rejects(recordBasicOrderReceipt(db, basicOwner, orderId, "Pix"), /já foi registrado/);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM cash_entries WHERE tenant_id='a'").get()!.n, 1);
    const after = workspaceForModules({ orders: await listOrders(db, "a"), cash_accounts: [] }, basicOwner.modules);
    assert.equal(after.orders[0].payment_status, "paid");
    assert.equal(after.orders[0].payment_method, "Pix");
    assert.ok(after.orders[0].payment_paid_at);
    await assert.rejects(transitionOrder(db, basicOwner, orderId, "open"), /motivo do estorno/);
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

test("Básico estorna recebimento com motivo, compensa caixa e reabre a OS sem perder a auditoria", async () => {
  const db = fixture();
  try {
    const orderId = await completedOrder(db);
    db.prepare("INSERT INTO cash_accounts(id,tenant_id,name,kind,opening_balance,opening_on,active) VALUES('account-a','a','Caixa','cash',0,'2026-01-01',1)").run();
    await recordBasicOrderReceipt(db, basicOwner, orderId, "Dinheiro", "account-a");
    const receivable = db.prepare("SELECT id FROM receivables WHERE tenant_id='a' AND order_id=?").get(orderId)!;
    const entry = db.prepare("SELECT id FROM cash_entries WHERE tenant_id='a' AND receivable_id=?").get(receivable.id)!;
    await assert.rejects(transitionOrder(db, basicOwner, orderId, "working"), /motivo do estorno/);
    assert.equal(db.prepare("SELECT status FROM orders WHERE tenant_id='a' AND id=?").get(orderId)!.status, "completed");
    await transitionOrder(db, basicOwner, orderId, "working", undefined, "Pagamento lançado por engano");
    assert.equal(db.prepare("SELECT status FROM orders WHERE tenant_id='a' AND id=?").get(orderId)!.status, "working");
    assert.equal(db.prepare("SELECT stock FROM catalog WHERE tenant_id='a' AND id='p'").get()!.stock, 5);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM receivables WHERE tenant_id='a' AND order_id=?").get(orderId)!.n, 0);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM cash_entries WHERE tenant_id='a' AND id=?").get(entry.id)!.n, 0);
    const movements = db.prepare("SELECT amount,origin,source_payload FROM cash_movements WHERE tenant_id='a' ORDER BY created_at,id").all();
    assert.equal(movements.length, 2);
    assert.equal(movements.reduce((sum, movement) => sum + Number(movement.amount), 0), 0);
    assert.ok(movements.some((movement) => movement.origin === "adjustment" && JSON.parse(String(movement.source_payload)).reason === "Pagamento lançado por engano"));
    const reversal = db.prepare("SELECT metadata FROM audit_events WHERE tenant_id='a' AND entity_id=? AND action='order.basic_receipt_reversed'").get(orderId)!;
    const snapshot = JSON.parse(String(reversal.metadata));
    assert.equal(snapshot.reason, "Pagamento lançado por engano");
    assert.equal(snapshot.cash_entry.id, entry.id);
    assert.equal(snapshot.receivable.id, receivable.id);
    await assert.rejects(transitionOrder(db, basicOwner, orderId, "working", undefined, "Estorno repetido"), /já está nesta situação/);
    await transitionOrder(db, basicOwner, orderId, "completed");
    assert.equal(db.prepare("SELECT COUNT(*) n FROM receivables WHERE tenant_id='a' AND order_id=?").get(orderId)!.n, 1);
  } finally {
    db.close();
  }
});

test("estorno no Básico exige administrador da oficina e recebimento simples reconhecido", async () => {
  const db = fixture();
  try {
    const orderId = await completedOrder(db);
    await recordBasicOrderReceipt(db, basicOwner, orderId, "Pix");
    await assert.rejects(transitionOrder(db, { ...basicOwner, tenantId: "b" }, orderId, "open", undefined, "Pagamento lançado por engano"), /não encontrado/);
    await assert.rejects(transitionOrder(db, { ...basicOwner, role: "operator" }, orderId, "open", undefined, "Pagamento lançado por engano"), /mecânico/);
    await assert.rejects(transitionOrder(db, { ...basicOwner, modules: { orders: true, finance: true } }, orderId, "open", undefined, "Pagamento lançado por engano"), /financeiro antes de reabrir/);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM cash_entries WHERE tenant_id='a'").get()!.n, 1);

    const otherOrder = await completedOrder(db);
    const otherReceivable = db.prepare("SELECT id FROM receivables WHERE tenant_id='a' AND order_id=?").get(otherOrder)!;
    await configurePlan(db, { ...basicOwner, modules: { orders: true, finance: true } }, String(otherReceivable.id), {
      method: "Pix", installments: 1, card_fee_bps: 0, interest_bps: 0, first_due_on: "2026-10-15",
    });
    const part = db.prepare("SELECT id FROM payment_installments WHERE tenant_id='a' AND receivable_id=?").get(otherReceivable.id)!;
    db.prepare("UPDATE payment_installments SET status='paid' WHERE id=?").run(part.id);
    db.prepare("UPDATE receivables SET status='paid' WHERE id=?").run(otherReceivable.id);
    db.prepare("INSERT INTO cash_entries(id,tenant_id,receivable_id,installment_id,amount,gross_amount,fee_amount,method) VALUES('other-entry','a',?,?,2001,2001,0,'Pix')").run(otherReceivable.id, part.id);
    await assert.rejects(transitionOrder(db, basicOwner, otherOrder, "open", undefined, "Pagamento lançado por engano"), /correção pelo Financeiro/);
    assert.equal(db.prepare("SELECT status FROM orders WHERE id=?").get(otherOrder)!.status, "completed");
    await transitionOrder(db, basicOwner, orderId, "open", undefined, "Pagamento lançado por engano");
    assert.equal(db.prepare("SELECT COUNT(*) n FROM cash_movements WHERE tenant_id='a'").get()!.n, 0);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM audit_events WHERE tenant_id='a' AND entity_id=? AND action='order.basic_receipt_reversed'").get(orderId)!.n, 1);
  } finally {
    db.close();
  }
});
