import test from "node:test";
import assert from "node:assert/strict";
import { createDatabase } from "../server/db/database";
import {
  saveOrder,
  transitionOrder,
  listOrders,
  mechanicWorkspace,
} from "../server/services/workshop";
import { filterOrders, revenueBreakdown } from "../src/lib/workflow";
import { selectReportOrders } from "../src/lib/orderReports";
const owner = { userId: "u", tenantId: "a", role: "owner" };
function fixture() {
  const db = createDatabase(":memory:");
  db.exec(
    "INSERT INTO tenants(id,name) VALUES('a','A'); INSERT INTO users VALUES('u','Admin','a@example.test','disabled'); INSERT INTO customers(id,tenant_id,name) VALUES('c','a','Cliente'); INSERT INTO vehicles(id,tenant_id,customer_id,plate,brand,model,year) VALUES('v','a','c','ABC1D23','Marca','Modelo',2020); INSERT INTO catalog(id,tenant_id,kind,name,sku,cost,price,stock) VALUES('p','a','product','Peça','P',1000,2000,5)",
  );
  return db;
}
const input = (extra: any = {}) => ({
  status: "quote",
  entered_on: "2026-10-14",
  due_on: "2026-10-14",
  km: 0,
  problem: "",
  notes: "",
  discount: 0,
  items: [{ catalog_id: "p", quantity: 1, price: 2000 }],
  ...extra,
});
test("one OS retains number and items from budget through approval completion and reopening", async () => {
  const db = fixture();
  try {
    const record = await saveOrder(db, owner, input());
    const before = (await listOrders(db, "a"))[0];
    assert.equal(before.kind, "order");
    assert.equal(before.status, "quote");
    await assert.rejects(transitionOrder(db, owner, record, "open"), /Vincule/);
    await saveOrder(
      db,
      owner,
      input({ customer_id: "c", vehicle_id: "v", items: before.items }),
      record,
    );
    await transitionOrder(db, owner, record, "open");
    const approved = (await listOrders(db, "a"))[0];
    assert.equal(approved.id, before.id);
    assert.equal(approved.number, before.number);
    assert.equal(approved.items[0].id, before.items[0].id);
    assert.equal(db.prepare("SELECT stock FROM catalog").get()!.stock, 5);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM receivables").get()!.n, 0);
    await transitionOrder(db, owner, record, "completed");
    assert.equal(db.prepare("SELECT stock FROM catalog").get()!.stock, 4);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM receivables").get()!.n, 1);
    await transitionOrder(db, owner, record, "quote");
    assert.equal(db.prepare("SELECT stock FROM catalog").get()!.stock, 5);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM receivables").get()!.n, 0);
    assert.equal((await listOrders(db, "a"))[0].number, before.number);
  } finally {
    db.close();
  }
});
test("legacy kind cannot override status in permissions lists finance or anonymous draft editing", async () => {
  const db = fixture();
  try {
    const record = await saveOrder(
      db,
      owner,
      input({ customer_id: "c", vehicle_id: "v" }),
    );
    db.prepare("UPDATE orders SET kind='order' WHERE id=?").run(record);
    await saveOrder(db, owner, input({ confirm_vehicle_change: true, items: [] }), record);
    assert.equal((await listOrders(db, "a"))[0].customer_id, null);
    await saveOrder(
      db,
      owner,
      input({ customer_id: "c", vehicle_id: "v" }),
      record,
    );
    await transitionOrder(db, owner, record, "open");
    db.prepare("UPDATE orders SET kind='quote' WHERE id=?").run(record);
    assert.equal((await mechanicWorkspace(db, "a")).orders.length, 1);
    await transitionOrder(
      db,
      { ...owner, role: "operator" },
      record,
      "working",
    );
    await transitionOrder(db, owner, record, "completed");
    const row: any = (await listOrders(db, "a"))[0];
    row.kind = "quote";
    assert.equal(
      revenueBreakdown([row], "2000-01-01", "2100-01-01").products,
      2000,
    );
    assert.equal(
      selectReportOrders(
        [row],
        { from: "", to: "", basis: "opening", statuses: [] },
        { cash: [], installments: [], receivables: [] },
      ).length,
      1,
    );
    row.status = "quote";
    row.display_status = "quote";
    row.kind = "order";
    assert.equal(filterOrders([row], "quote").length, 1);
    assert.equal(
      selectReportOrders(
        [row],
        { from: "", to: "", basis: "opening", statuses: [] },
        { cash: [], installments: [], receivables: [] },
      ).length,
      0,
    );
  } finally {
    db.close();
  }
});

test("editing delivery date preserves an existing inactive product without allowing a new use", async () => {
  const db = fixture();
  try {
    const record = await saveOrder(db, owner, input({ customer_id: "c", vehicle_id: "v" }));
    const before = (await listOrders(db, "a"))[0];
    db.prepare("UPDATE catalog SET active=0 WHERE tenant_id='a' AND id='p'").run();
    await saveOrder(db, owner, input({
      customer_id: "c", vehicle_id: "v", due_on: "2026-10-15", items: before.items,
    }), record);
    const after = (await listOrders(db, "a"))[0];
    assert.equal(after.due_on, "2026-10-15");
    assert.equal(after.items[0].id, before.items[0].id);
    assert.equal(after.items[0].name, before.items[0].name);
    await assert.rejects(
      saveOrder(db, owner, input({ customer_id: "c", vehicle_id: "v" })),
      /não está disponível no catálogo/,
    );
  } finally {
    db.close();
  }
});

test("editing delivery date preserves an existing inactive legacy service", async () => {
  const db = fixture();
  try {
    db.prepare("INSERT INTO catalog(id,tenant_id,kind,name,sku,cost,price,stock,active) VALUES('s','a','service','Serviço legado','S',0,4500,0,1)").run();
    const record = await saveOrder(db, owner, input({
      customer_id: "c", vehicle_id: "v",
      items: [{ catalog_id: "s", quantity: 1, price: 4500 }],
    }));
    const before = (await listOrders(db, "a"))[0];
    db.prepare("UPDATE catalog SET active=0 WHERE tenant_id='a' AND id='s'").run();
    await saveOrder(db, owner, input({
      customer_id: "c", vehicle_id: "v", due_on: "2026-10-16", items: before.items,
    }), record);
    const after = (await listOrders(db, "a"))[0];
    assert.equal(after.due_on, "2026-10-16");
    assert.equal(after.items[0].id, before.items[0].id);
    assert.equal(after.items[0].price, 4500);
  } finally {
    db.close();
  }
});
