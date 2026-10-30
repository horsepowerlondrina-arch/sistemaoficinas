import assert from "node:assert/strict";
import test from "node:test";
import { createDatabase } from "../server/db/database";
import { saveOrder } from "../server/services/workshop";

const ctx = { tenantId: "a", userId: "u", role: "owner" };
const base = { status: "quote", customer_id: "c", vehicle_id: "v1", guest_name: "", guest_plate: "", guest_vehicle: "", entered_on: "2026-10-30", due_on: "2026-10-30", km: 0, problem: "", notes: "", discount: 0 };

test("vehicle switch requires confirmation and atomically removes items, keeping other orders and audit", async () => {
  const db = createDatabase(":memory:");
  try {
    db.exec("INSERT INTO tenants(id,name) VALUES('a','A'),('b','B'); INSERT INTO users VALUES('u','Teste','test@example.invalid','disabled'); INSERT INTO customers(id,tenant_id,name) VALUES('c','a','Cliente'),('foreign','b','Outro'); INSERT INTO vehicles(id,tenant_id,customer_id,plate,brand,model,year) VALUES('v1','a','c','ABC1D23','Fiat','Uno',2020),('v2','a','c','DEF4G56','Fiat','Palio',2021),('foreign-v','b','foreign','GHI7J89','VW','Gol',2020); INSERT INTO catalog(id,tenant_id,kind,name,sku,category,cost,price,stock,minimum_stock) VALUES('p','a','product','Peça','P-1','',100,200,0,0)");
    const item = { id: "item-1", catalog_id: "p", quantity: 1, price: 200, cost: 100, professional_id: "" };
    const order = await saveOrder(db, ctx, { ...base, items: [item] });
    await assert.rejects(saveOrder(db, ctx, { ...base, vehicle_id: "v2", items: [] }, order), /Confirme a troca/);
    assert.equal(db.prepare("SELECT vehicle_id FROM orders WHERE id=?").get(order)!.vehicle_id, "v1");
    assert.equal(db.prepare("SELECT count(*) n FROM order_items WHERE order_id=?").get(order)!.n, 1);
    await assert.rejects(saveOrder(db, ctx, { ...base, vehicle_id: "v2", confirm_vehicle_change: true, items: [item] }, order), /Remova os itens/);
    await assert.rejects(saveOrder(db, ctx, { ...base, vehicle_id: "foreign-v", confirm_vehicle_change: true, items: [] }, order));
    await saveOrder(db, ctx, { ...base, vehicle_id: "v2", confirm_vehicle_change: true, items: [] }, order);
    assert.equal(db.prepare("SELECT vehicle_id,total FROM orders WHERE id=?").get(order)!.vehicle_id, "v2");
    assert.equal(db.prepare("SELECT count(*) n FROM order_items WHERE order_id=?").get(order)!.n, 0);
    assert.equal(Number(db.prepare("SELECT count(*) n FROM audit_events WHERE tenant_id='a' AND action LIKE 'order.vehicle_changed:%'").get()!.n), 1);
  } finally { db.close(); }
});

test("vehicle switch is blocked when the order has a receivable", async () => {
  const db = createDatabase(":memory:");
  try {
    db.exec("INSERT INTO tenants(id,name) VALUES('a','A'); INSERT INTO users VALUES('u','Teste','test@example.invalid','disabled'); INSERT INTO customers(id,tenant_id,name) VALUES('c','a','Cliente'); INSERT INTO vehicles(id,tenant_id,customer_id,plate,brand,model,year) VALUES('v1','a','c','ABC1D23','Fiat','Uno',2020),('v2','a','c','DEF4G56','Fiat','Palio',2021)");
    const order = await saveOrder(db, ctx, { ...base, items: [] });
    db.prepare("INSERT INTO receivables(id,tenant_id,order_id,customer_id,description,amount,due_on) VALUES('r','a',?,'c','Cobrança',100,'2026-10-30')").run(order);
    await assert.rejects(saveOrder(db, ctx, { ...base, vehicle_id: "v2", confirm_vehicle_change: true, items: [] }, order), /movimentações ou cobrança/);
    assert.equal(db.prepare("SELECT vehicle_id FROM orders WHERE id=?").get(order)!.vehicle_id, "v1");
  } finally { db.close(); }
});
