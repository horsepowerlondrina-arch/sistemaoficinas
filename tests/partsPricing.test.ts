import { catalogSalePrice, thirdPartySalePrice } from "../shared/pricing";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDatabase } from "../server/db/database";
import { digest } from "../server/auth/session";
import {
  beginCapture,
  beginCatalogCapture,
  catalogCaptureState,
  importCapture,
  finishCapture,
} from "../server/services/extension";
import {
  defaultRules,
  partsPricingSchema,
  priceFromCost,
  getPartsPricing,
} from "../server/services/partsPricing";
import { createApp } from "../server/app";
function fixture() {
  const db = createDatabase(":memory:");
  db.exec(
    `INSERT INTO tenants(id,name) VALUES('59c85eea-7112-40de-b77f-c5627c541b48','A'),('b','B');INSERT INTO users VALUES('u','Test','test@example.com','disabled');INSERT INTO memberships VALUES('u','59c85eea-7112-40de-b77f-c5627c541b48','owner');INSERT INTO customers(id,tenant_id,name) VALUES('c','59c85eea-7112-40de-b77f-c5627c541b48','Cliente');INSERT INTO vehicles(id,tenant_id,customer_id,plate,brand,model,year) VALUES('v','59c85eea-7112-40de-b77f-c5627c541b48','c','ABC1D23','Fiat','Uno',2020);INSERT INTO orders(id,tenant_id,number,kind,status,customer_id,vehicle_id,entered_on,due_on,km,total) VALUES('o','59c85eea-7112-40de-b77f-c5627c541b48',1,'order','working','c','v','2026-10-04','2026-10-04',0,0);`,
  );
  db.prepare("INSERT INTO sessions VALUES(?,?,?,?)").run(
    digest("session"),
    "u",
    "59c85eea-7112-40de-b77f-c5627c541b48",
    Date.now() + 3600000,
  );
  return db;
}
const ctx = { tenantId: "59c85eea-7112-40de-b77f-c5627c541b48", userId: "u", role: "owner" };
const part = (cost = 10000) => ({
  capture_id: randomUUID(),
  source: "sky",
  name: "Filtro teste",
  code: "F01",
  brand: "Teste",
  cost,
});
test("Horse Power bands use inclusive cent boundaries and minimum unit profit", () => {
  const cases = [
    [0, 800],
    [500, 1300],
    [1000, 1800],
    [2000, 3600],
    [2001, 3202],
    [5000, 8000],
    [5001, 7502],
    [10000, 15000],
    [10001, 14501],
    [25000, 36250],
    [25001, 35001],
    [50000, 70000],
    [50001, 67501],
    [100000, 135000],
    [100001, 130001],
  ];
  for (const [cost, price] of cases)
    assert.equal(priceFromCost(cost, "legacy", 4000), price);
  assert.equal(
    partsPricingSchema.safeParse({ rules: [...defaultRules].reverse() })
      .success,
    false,
  );
  assert.throws(() => priceFromCost(100000000, "legacy", 4000));
});
test("catalog capture applies freight and tenant policy, preserves order costs and isolates catalog sessions", async () => {
  const db = fixture();
  try {
    const order = await beginCapture(db, ctx, "o", "session", 1000);
    await importCapture(db, order.token, part());
    await finishCapture(db, ctx, "o");
    const snapshot = db.prepare("SELECT * FROM order_items").get()!;
    assert.equal(snapshot.cost, 11000);
    assert.equal(snapshot.price, 15950);
    const target = randomUUID();
    const catalog = await beginCatalogCapture(db, ctx, target, "session", 500);
    const payload = part(20000);
    await importCapture(db, catalog.token, payload);
    await importCapture(db, catalog.token, payload);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM catalog").get()!.n, 1);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM order_items").get()!.n, 1);
    const state = await catalogCaptureState(db, ctx, target);
    assert.equal(state.items[0].cost, 20500);
    assert.equal(state.items[0].price, 29725);
    assert.equal(state.items[0].freight_unit, 500);
    assert.equal(state.items[0].stock, 0);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM stock_movements").get()!.n, 0);
    assert.deepEqual(db.prepare("SELECT * FROM order_items").get(), snapshot);
    assert.equal(
      (await catalogCaptureState(db, { ...ctx, tenantId: "b" }, target)).items
        .length,
      0,
    );
    const other = await beginCatalogCapture(db, ctx, randomUUID(), "session");
    await assert.rejects(
      importCapture(db, other.token, payload),
      /já utilizada/,
    );
    db.prepare("UPDATE tenants SET parts_pricing_rules=? WHERE id=?").run(
      JSON.stringify([{ up_to: null, markup_bps: 10000, minimum_profit: 0 }]),
      "59c85eea-7112-40de-b77f-c5627c541b48",
    );
    await importCapture(db, catalog.token, {
      ...part(30000),
      code: "F02",
      name: "Segunda peça",
    });
    const second = db
      .prepare(
        "SELECT cost,price,freight_unit FROM catalog WHERE name='Segunda peça'",
      )
      .get()!;
    assert.equal(second.cost, 30300);
    assert.equal(second.freight_unit, 300);
    assert.equal(second.price, 60600);
    db.prepare("UPDATE catalog SET stock=7,stock_verified=1 WHERE id=?").run(state.items[0].id);
    await importCapture(db, catalog.token, { ...part(20000), quantity: 9 });
    assert.equal(db.prepare("SELECT stock FROM catalog WHERE id=?").get(state.items[0].id)!.stock, 7);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM stock_movements").get()!.n, 0);
    assert.deepEqual(db.prepare("SELECT * FROM order_items").get(), snapshot);
    await catalogCaptureState(db, ctx, target, true);
    await assert.rejects(importCapture(db, catalog.token, part()), /expirada/);
    db.exec("UPDATE orders SET status='completed' WHERE id='o'");
    await assert.rejects(beginCapture(db, ctx, "o", "session"));
  } finally {
    db.close();
  }
});
test("stock receipt is atomic and idempotent, saves landed cost and sale, and rejects foreign items", async () => {
  const db = fixture();
  const app = createApp(db).listen(0, "127.0.0.1");
  await new Promise<void>((r) => app.once("listening", r));
  const base = `http://127.0.0.1:${(app.address() as any).port}/api`;
  const headers = {
    Cookie: "hp_session=session",
    "Content-Type": "application/json",
  };
  const call = (path: string, body: any, method = "POST") =>
    fetch(base + path, { method, headers, body: JSON.stringify(body) });
  try {
    const rejected = await call("/catalog", {
      kind: "product", name: "Estoque pelo cadastro", sku: "BLOCKED",
      cost: 1200, price: 2160, stock: 5, minimum_stock: 0,
    });
    assert.equal(rejected.status, 400);
    assert.match((await rejected.json()).error, /estoque zero/);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM catalog WHERE sku='BLOCKED'").get()!.n, 0);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM stock_movements").get()!.n, 0);
    const created = await call("/catalog", {
      kind: "product",
      name: "Peça manual",
      sku: "MAN",
      cost: 1200,
      freight_unit: 200,
      price: 2160,
      stock: 0,
      minimum_stock: 0,
    });
    assert.equal(created.status, 200);
    const { id } = await created.json();
    const receipt = {
      quantity: 3,
      cost: 1500,
      freight_unit: 300,
      price: 2700,
      reason: "Compra teste",
      request_id: randomUUID(),
    };
    assert.equal((await call("/stock/" + id, receipt)).status, 200);
    assert.equal((await call("/stock/" + id, receipt)).status, 200);
    const item = db.prepare("SELECT * FROM catalog WHERE id=?").get(id)!;
    assert.equal(item.stock, 3);
    assert.equal(item.cost, 1500);
    assert.equal(item.price, 2700);
    assert.equal(item.freight_unit, 300);
    assert.equal(
      db.prepare("SELECT COUNT(*) n FROM stock_movements").get()!.n,
      1,
    );
    assert.equal(
      (await call("/stock/" + id, { ...receipt, quantity: 4 })).status,
      400,
    );
    assert.equal(
      (
        await call("/stock/" + id, {
          ...receipt,
          request_id: randomUUID(),
          cost: 100,
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await call("/stock/" + id, {
          ...receipt,
          request_id: randomUUID(),
          quantity: -4,
        })
      ).status,
      400,
    );
    assert.equal(
      db.prepare("SELECT stock FROM catalog WHERE id=?").get(id)!.stock,
      3,
    );
    db.exec(
      "INSERT INTO catalog(id,tenant_id,kind,name,sku,cost,price,stock) VALUES('foreign','b','product','Outro','X',0,0,0)",
    );
    assert.equal((await call("/stock/foreign", receipt)).status, 404);
    const settings = await call(
      "/parts-pricing",
      { mode: "legacy", rules: defaultRules },
      "PUT",
    );
    assert.equal(settings.status, 200);
    const preview = await call("/parts-pricing/preview", { cost: 500 });
    assert.equal((await preview.json()).price, 1300);
  } finally {
    await new Promise<void>((r) => app.close(() => r()));
    db.close();
  }
});

test("cadastro calcula venda por faixa com frete e custo de terceiros por percentual", () => {
  const policy = {
    mode: "legacy" as const,
    rate_bps: 4000,
    rules: defaultRules,
    service_markup_bps: 3000,
  };
  for (const cost of [0, 500, 2000, 2001, 5000, 5001, 10000, 10001, 100001]) {
    assert.equal(
      catalogSalePrice("product", cost, 0, policy),
      priceFromCost(cost, "legacy", 4000),
    );
  }
  assert.equal(catalogSalePrice("product", 1900, 200, policy), 3360);
  assert.equal(catalogSalePrice("service", 10000, 9999, policy), 13000);
  assert.equal(catalogSalePrice("service", 12345, 0, policy), 16049);
  assert.equal(
    catalogSalePrice("service", 10000, 0, { ...policy, service_markup_bps: 0 }),
    10000,
  );
  assert.equal(catalogSalePrice("service", 0, 0, policy), 0);
  assert.throws(() => catalogSalePrice("service", 100000000, 0, policy));
  assert.equal(
    partsPricingSchema.safeParse({ service_markup_bps: -1 }).success,
    false,
  );
  assert.equal(
    partsPricingSchema.safeParse({ service_markup_bps: 100001 }).success,
    false,
  );
});

test("serviço próprio calcula preço a partir do custo e do acréscimo da oficina", () => {
  assert.equal(thirdPartySalePrice(10000, 3000), 13000);
  assert.equal(thirdPartySalePrice(12345, 2750), 15740);
  assert.equal(thirdPartySalePrice(10000, 0), 10000);
  assert.throws(() => thirdPartySalePrice(100000000, 3000));
});

test("percentual de terceiros persiste por oficina e mantém compatibilidade com tabelas antigas", async () => {
  const db = fixture(),
    app = createApp(db).listen(0, "127.0.0.1");
  await new Promise<void>((r) => app.once("listening", r));
  const base = `http://127.0.0.1:${(app.address() as any).port}/api`;
  const headers = {
    Cookie: "hp_session=session",
    "Content-Type": "application/json",
  };
  const put = (body: any) =>
    fetch(base + "/parts-pricing", {
      method: "PUT",
      headers,
      body: JSON.stringify(body),
    });
  try {
    assert.equal((await getPartsPricing(db, "59c85eea-7112-40de-b77f-c5627c541b48")).service_markup_bps, 3000);
    db.prepare("UPDATE tenants SET parts_pricing_rules=? WHERE id='59c85eea-7112-40de-b77f-c5627c541b48'").run(
      JSON.stringify(defaultRules),
    );
    assert.equal((await getPartsPricing(db, "59c85eea-7112-40de-b77f-c5627c541b48")).service_markup_bps, 3000);
    assert.equal(
      (await put({ rules: defaultRules, service_markup_bps: 2750 })).status,
      200,
    );
    const workspace = await (
      await fetch(base + "/workspace", { headers })
    ).json();
    assert.equal(workspace.parts_pricing.service_markup_bps, 2750);
    assert.equal((await getPartsPricing(db, "b")).service_markup_bps, 3000);
    // Older clients saving only product rules must not reset the third-party setting.
    assert.equal((await put({ rules: defaultRules })).status, 200);
    assert.equal((await getPartsPricing(db, "59c85eea-7112-40de-b77f-c5627c541b48")).service_markup_bps, 2750);
    const preview = await (
      await fetch(base + "/parts-pricing/preview", {
        method: "POST",
        headers,
        body: JSON.stringify({ cost: 500 }),
      })
    ).json();
    assert.equal(preview.price, 1300);
    assert.equal(
      (await put({ rules: defaultRules, service_markup_bps: -1 })).status,
      400,
    );
    assert.equal((await getPartsPricing(db, "59c85eea-7112-40de-b77f-c5627c541b48")).service_markup_bps, 2750);
  } finally {
    await new Promise<void>((r) => app.close(() => r()));
    db.close();
  }
});
