import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDatabase } from "../server/db/database";
import { digest } from "../server/auth/session";
import { enableExtensionCatalog } from "../server/services/catalogReset";
import {
  beginCapture,
  importCapture,
  finishCapture,
} from "../server/services/extension";
import { saveOrder, listOrders } from "../server/services/workshop";
import { createApp } from "../server/app";
const ctx = { tenantId: "a", userId: "u", role: "owner" };
function fixture() {
  const db = createDatabase(":memory:");
  db.exec(`INSERT INTO tenants(id,name) VALUES('a','A'),('b','B');
    INSERT INTO users VALUES('u','Test','test@example.com','disabled');
    INSERT INTO memberships VALUES('u','a','owner');
    INSERT INTO catalog(id,tenant_id,kind,name,sku,cost,price,stock) VALUES
      ('service','a','service','Troca de óleo','S1',0,10000,0),
      ('product','a','product','Filtro de óleo','P1',1000,2000,5),
      ('other','b','service','Troca de óleo','S1',0,10000,0);
    INSERT INTO orders(id,tenant_id,number,kind,status,entered_on,due_on,km,total) VALUES('order','a',1,'quote','quote','2026-10-03','2026-10-03',0,14000),('fresh','a',2,'quote','quote','2026-10-03','2026-10-03',0,0);
    INSERT INTO order_items(id,tenant_id,order_id,catalog_id,professional_id,kind,name,quantity,price,cost) VALUES('i1','a','order','service',NULL,'service','Troca de óleo histórica',1,10000,0),('i2','a','order','product',NULL,'product','Filtro histórico',2,2000,1000);
    INSERT INTO service_aliases VALUES('a','troca oleo','Troca de óleo','service');
    INSERT INTO external_catalog_links VALUES('a','tempario','troca oleo','service');`);
  db.prepare("INSERT INTO service_times(id,tenant_id,catalog_id,capture_id,source,service_name,make,model,vehicle_year,engine,duration_seconds,source_price) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)").run("history","a","service","history-capture","Tempario","Serviço histórico","Fiat","Uno","2015","",1800,12000);
  db.prepare("INSERT INTO sessions VALUES(?,?,?,?)").run(
    digest("session"),
    "u",
    "a",
    Date.now() + 3600000,
  );
  return db;
}
const capture = () => ({
  capture_id: randomUUID(),
  source: "sky",
  name: "Filtro de óleo novo",
  code: "F1",
  brand: "Marca",
  cost: 1500,
  quantity: 1,
});
test("reset hides the old catalog, preserves documents and stock, isolates tenants and is safe to repeat", async () => {
  const db = fixture();
  try {
    const before = await listOrders(db, "a");
    const old = await beginCapture(db, ctx, "fresh", "session");
    await assert.rejects(
      enableExtensionCatalog(db, { ...ctx, role: "operator" }),
    );
    assert.equal((await enableExtensionCatalog(db, ctx)).archived, 2);
    assert.deepEqual(await listOrders(db, "a"), before);
    assert.equal(
      db.prepare("SELECT stock FROM catalog WHERE id='product'").get()!.stock,
      5,
    );
    assert.equal(
      db.prepare("SELECT active FROM catalog WHERE id='other'").get()!.active,
      1,
    );
    assert.equal(
      db
        .prepare(
          "SELECT COUNT(*) n FROM catalog WHERE tenant_id='a' AND archived_at IS NULL",
        )
        .get()!.n,
      0,
    );
    await assert.rejects(importCapture(db, old.token, capture()), /expirada/);
    const current = await beginCapture(db, ctx, "fresh", "session");
    await importCapture(db, current.token, capture());
    const imported = db
      .prepare(
        "SELECT * FROM catalog WHERE tenant_id='a' AND archived_at IS NULL",
      )
      .get()!;
    assert.notEqual(imported.id, "service");
    assert.equal(imported.kind, "product");
    assert.equal(imported.cost, 1500);
    assert.equal(imported.active, 1);
    await importCapture(db, current.token, {
      capture_id: randomUUID(),
      source: "sky",
      name: "Filtro de óleo",
      code: "F1",
      brand: "Marca",
      cost: 1500,
    });
    assert.equal(db.prepare("SELECT COUNT(*) n FROM service_times").get()!.n, 1);
    await finishCapture(db, ctx, "fresh");
    assert.equal(db.prepare("SELECT duration_seconds FROM service_times").get()!.duration_seconds, 1800);
    assert.equal((await enableExtensionCatalog(db, ctx)).changed, false);
    assert.equal(
      db
        .prepare(
          "SELECT COUNT(*) n FROM catalog WHERE tenant_id='a' AND archived_at IS NULL",
        )
        .get()!.n,
      1,
    );
    assert.equal(
      db.prepare("SELECT COUNT(*) n FROM service_times").get()!.n,
      1,
    );
  } finally {
    db.close();
  }
});
test("archived items remain editable in their original quote but cannot be added to a new one", async () => {
  const db = fixture();
  try {
    await enableExtensionCatalog(db, ctx);
    const order = (await listOrders(db, "a")).find((o) => o.id === "order")!;
    const input = { ...order, notes: "Observação atualizada" };
    await saveOrder(db, ctx, input, "order");
    assert.deepEqual(
      (await listOrders(db, "a")).find((o) => o.id === "order")!.items,
      order.items,
    );
    await assert.rejects(saveOrder(db, ctx, input), /não está disponível/);
    await assert.rejects(
      saveOrder(db, ctx, input, "fresh"),
      /não está disponível/,
    );
    assert.equal(
      db.prepare("SELECT total FROM orders WHERE id='order'").get()!.total,
      14000,
    );
  } finally {
    db.close();
  }
});
test("HTTP preserva histórico, remove a API antiga de tempos e mantém Sky Peças", async () => {
  const db = fixture();
  const token = await beginCapture(db, ctx, "fresh", "session");
  await importCapture(db, token.token, capture());
  await enableExtensionCatalog(db, ctx);
  const app = createApp(db).listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => app.once("listening", resolve));
  const base = `http://127.0.0.1:${(app.address() as any).port}/api`;
  const headers = {
    Cookie: "hp_session=session",
    "Content-Type": "application/json",
  };
  const item = {
    kind: "service",
    name: "Troca de óleo",
    sku: "new",
    cost: 0,
    price: 10000,
    stock: 0,
    minimum_stock: 0,
  };
  try {
    const workspace = await (
      await fetch(base + "/workspace", { headers })
    ).json();
    assert.equal(workspace.catalog_mode, "extension");
    assert.equal(workspace.catalog.length, 0);
    assert.equal(workspace.orders.length, 2);
    assert.equal((await fetch(base + "/service-times", { headers })).status, 404);
    let r = await fetch(base + "/catalog", {
      method: "POST",
      headers,
      body: JSON.stringify(item),
    });
    assert.equal(r.status, 400);
    r = await fetch(base + "/catalog/service", {
      method: "PUT",
      headers,
      body: JSON.stringify(item),
    });
    assert.equal(r.status, 400);
    const connection = await beginCapture(db, ctx, "order", "session");
    await importCapture(db, connection.token, capture());
    assert.equal(db.prepare("SELECT COUNT(*) n FROM service_times").get()!.n, 1);
    await finishCapture(db, ctx, "order");
    assert.equal(
      db.prepare("SELECT duration_seconds FROM service_times").get()!
        .duration_seconds,
      1800,
    );
    const imported = db
      .prepare(
        "SELECT id FROM catalog WHERE tenant_id='a' AND archived_at IS NULL",
      )
      .get()!;
    r = await fetch(base + "/catalog/" + imported.id, {
      method: "PUT",
      headers,
      body: JSON.stringify({ ...item, price: 14000 }),
    });
    assert.equal(r.status, 400, await r.text());
    assert.equal(
      (await (await fetch(base + "/workspace", { headers })).json()).catalog
        .length,
      1,
    );
    assert.equal((await fetch(base + "/service-times", { headers })).status, 404);
  } finally {
    await new Promise<void>((resolve) => app.close(() => resolve()));
    db.close();
  }
});
