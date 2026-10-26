import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { migrate } from "../server/db/migrate";
test("migração preserva OS, itens, recebimentos e vínculos do banco anterior", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(
      readFileSync(new URL("../server/db/schema.sql", import.meta.url), "utf8"),
    );
    db.exec(`INSERT INTO tenants(id,name,address) VALUES('a','Oficina','Rua Histórica, 123');
 INSERT INTO users VALUES('user','Admin','test@example.com','hash');
 INSERT INTO customers(id,tenant_id,name) VALUES('customer','a','Cliente');
 INSERT INTO vehicles(id,tenant_id,customer_id,plate,brand,model,year) VALUES('vehicle','a','customer','ABC1D23','Honda','Fit',2020);
 INSERT INTO catalog(id,tenant_id,kind,name,sku,cost,price) VALUES('product','a','product','Peça','SKU',100,200);
 INSERT INTO orders(id,tenant_id,number,customer_id,vehicle_id,status,entered_on,due_on,km,total) VALUES('order','a',1001,'customer','vehicle','completed','2026-01-01','2026-01-02',10,200),('quote','a',1002,'customer','vehicle','quote','2026-01-01','2026-01-02',10,0);
 INSERT INTO order_items VALUES('item','a','order','product',NULL,'product','Peça',1,200,100);
 INSERT INTO stock_movements(id,tenant_id,catalog_id,order_id,quantity,reason,user_id) VALUES('movement','a','product','order',-1,'OS','user');
 INSERT INTO receivables(id,tenant_id,order_id,customer_id,description,amount,due_on,status,method,paid_at) VALUES('receipt','a','order','customer','OS #1001',200,'2026-01-02','paid','Pix','2026-01-02T12:00:00Z');
 INSERT INTO cash_entries(id,tenant_id,receivable_id,amount,method) VALUES('cash','a','receipt',200,'Pix');`);
    migrate(db);
    migrate(db);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM orders").get()!.n, 2);
    assert.equal(db.prepare("SELECT address FROM tenants WHERE id='a'").get()!.address,"Rua Histórica, 123");
    assert.equal(db.prepare("SELECT identity_legacy FROM orders WHERE id='order'").get()!.identity_legacy,1);
    assert.equal(db.prepare("SELECT profile_data FROM tenants WHERE id='a'").get()!.profile_data,"{}");
    assert.equal(db.prepare("SELECT COUNT(*) n FROM migrations WHERE version=23").get()!.n,1);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM migrations WHERE version=24").get()!.n,1);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM migrations WHERE version=25").get()!.n,1);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM migrations WHERE version=26").get()!.n,1);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM migrations WHERE version=27").get()!.n,1);
    assert.ok(db.prepare("SELECT name FROM pragma_table_info('audit_events') WHERE name='metadata'").get());
    assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='data_transfer_records'").get());
    assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='data_transfer_backups'").get());
    assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='data_transfer_archived_documents'").get());
    assert.ok(db.prepare("SELECT name FROM pragma_table_info('data_transfer_backups') WHERE name='expires_at'").get());
    assert.deepEqual(
      db.prepare("SELECT id FROM labor_categories ORDER BY sort_order").all().map((r:any)=>r.id),
      ["compacto","medio","premium","pesado"],
    );
    assert.equal(
      db.prepare("SELECT kind FROM orders WHERE id='quote'").get()!.kind,
      "quote",
    );
    assert.equal(db.prepare("SELECT COUNT(*) n FROM order_items").get()!.n, 1);
    assert.equal(
      db.prepare("SELECT COUNT(*) n FROM stock_movements").get()!.n,
      1,
    );
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
    assert.equal(db.prepare("PRAGMA foreign_keys").get()!.foreign_keys, 1);
    const cash = db
      .prepare(
        "SELECT c.*,p.status FROM cash_entries c JOIN payment_installments p ON p.id=c.installment_id",
      )
      .get()!;
    assert.deepEqual(
      [cash.amount, cash.gross_amount, cash.fee_amount, cash.status],
      [200, 200, 0, "paid"],
    );
    assert.equal(
      db.prepare("SELECT COUNT(*) n FROM migrations WHERE version=2").get()!.n,
      1,
    );
  } finally {
    db.close();
  }
});
