import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDatabase } from "../server/db/database";
import {
  captureSchema,
  beginCapture,
  captureState,
  discardCapture,
  discardExtensionCapture,
  importCapture,
  finishCapture,
  suggestedPrice,
  updateCaptureFreight,
  updateStagedCaptureItem,
} from "../server/services/extension";
import { digest } from "../server/auth/session";
import { saveOrder } from "../server/services/workshop";
import { createShare, readShare } from "../server/services/sharing";
import { createApp } from "../server/app";
const ctx = { tenantId: "a", userId: "u", role: "owner" };
test("extension capture accepts Sky and rejects removed external sources", () => {
  const parsed = captureSchema.parse({
    capture_id: randomUUID(), source: "sky", name: "Peça fictícia", code: "CF1", brand: "Marca teste", cost: 1000,
  });
  assert.deepEqual(parsed.vehicle, { plate: "", make: "", model: "", year: "", engine: "" });
  assert.throws(() => captureSchema.parse({ capture_id: randomUUID(), source: "tempario", name: "Serviço removido" }));
});
function fixture() {
  const db = createDatabase(":memory:");
  db.exec(`INSERT INTO tenants(id,name) VALUES('a','A'),('b','B'); INSERT INTO users VALUES('u','Test','test@example.com','unused'); INSERT INTO memberships VALUES('u','a','owner');
INSERT INTO orders(id,tenant_id,number,kind,status,guest_plate,entered_on,due_on,km,total) VALUES('o','a',1,'quote','quote','ABC1D23','2026-10-03','2026-10-03',0,0),('other','b',1,'quote','quote','','2026-10-03','2026-10-03',0,0);`);
  db.prepare("INSERT INTO sessions VALUES(?,?,?,?)").run(
    digest("session"),
    "u",
    "a",
    Date.now() + 3600000,
  );
  return db;
}
const product = () => ({
  capture_id: randomUUID(),
  source: "sky",
  name: "Correia dentada",
  code: "CT100",
  brand: "Marca A",
  cost: 10000,
  quantity: 2,
});
test("capture connection uses the registered vehicle or a normalized guest plate", async () => {
  const db = fixture();
  try {
    assert.equal(
      (await beginCapture(db, ctx, "o", "session")).plate,
      "ABC1D23",
    );
    db.exec("UPDATE orders SET guest_plate='abc-1234' WHERE id='o'");
    assert.equal(
      (await beginCapture(db, ctx, "o", "session")).plate,
      "ABC1234",
    );
    db.exec(`INSERT INTO customers(id,tenant_id,name) VALUES('customer','a','Cliente');
      INSERT INTO vehicles(id,tenant_id,customer_id,plate,brand,model,year) VALUES('vehicle','a','customer','def-2a34','Fiat','Uno',2020);
      UPDATE orders SET customer_id='customer',vehicle_id='vehicle' WHERE id='o';`);
    assert.equal(
      (await beginCapture(db, ctx, "o", "session")).plate,
      "DEF2A34",
    );
    db.exec(
      "UPDATE orders SET vehicle_id=NULL,guest_plate='SEM PLACA' WHERE id='o'",
    );
    assert.equal((await beginCapture(db, ctx, "o", "session")).plate, "");
  } finally {
    db.close();
  }
});
test("Sky freight defaults to one purchase total and is redistributed proportionally", async () => {
  const db = fixture();
  try {
    const batch = randomUUID();
    const started = await beginCapture(db, ctx, "o", "session", 1750, batch);
    assert.equal(started.freight_total, 1750);
    await importCapture(db, started.token, {
      ...product(),
      capture_id: randomUUID(),
      code: "A100",
      name: "Peça A",
      cost: 10000,
      quantity: 1,
    });
    await importCapture(db, started.token, {
      ...product(),
      capture_id: randomUUID(),
      code: "B300",
      name: "Peça B",
      cost: 30000,
      quantity: 1,
    });
    const freightRows = db
      .prepare(
        "SELECT source_cost,freight_total FROM external_captures WHERE source='sky' ORDER BY source_cost",
      )
      .all()
      .map((row) => ({
        source_cost: Number(row.source_cost),
        freight_total: Number(row.freight_total),
      }));
    assert.equal(
      freightRows.reduce((sum, row) => sum + row.freight_total, 0),
      1750,
    );
    // UUID ordering may assign the remainder cent to either item.
    for (const row of freightRows)
      assert.ok(
        Math.abs(row.freight_total - (1750 * row.source_cost) / 40000) <= 0.5,
      );
    assert.equal(db.prepare("SELECT count(*) n FROM order_items").get()!.n, 0);
    assert.deepEqual(
      (await captureState(db, ctx, "o")).staged_items
        .map((r: any) => r.cost)
        .sort((a: number, b: number) => a - b),
      freightRows.map((row) => row.source_cost + row.freight_total),
    );
    await updateCaptureFreight(db, started.token, 2000);
    assert.deepEqual(
      db
        .prepare(
          "SELECT source_cost,freight_total FROM external_captures WHERE source='sky' ORDER BY source_cost",
        )
        .all()
        .map((row) => ({ ...row })),
      [
        { source_cost: 10000, freight_total: 500 },
        { source_cost: 30000, freight_total: 1500 },
      ],
    );
    assert.deepEqual(
      (await captureState(db, ctx, "o")).staged_items
        .map((r: any) => r.cost)
        .sort((a: number, b: number) => a - b),
      [10500, 31500],
    );
    assert.equal(
      db
        .prepare("SELECT freight_total FROM capture_sessions WHERE batch_id=?")
        .get(batch)!.freight_total,
      2000,
    );
  } finally {
    db.close();
  }
});

test("staged Sky items can change quantity, use zero to remove and only enter the order on conclude", async () => {
  const db = fixture();
  try {
    const started = await beginCapture(db, ctx, "o", "session", 0);
    await importCapture(db, started.token, {
      ...product(),
      quantity: 1,
      capture_id: randomUUID(),
    });
    let state = await captureState(db, ctx, "o");
    assert.equal(state.items.length, 0);
    assert.equal(state.staged_items.length, 1);
    const capture = state.staged_items[0];
    state = await updateStagedCaptureItem(db, ctx, "o", capture.id, {
      quantity: 4,
    });
    assert.equal(state.staged_items[0].quantity, 4);
    assert.equal(db.prepare("SELECT count(*) n FROM order_items").get()!.n, 0);

    await finishCapture(db, ctx, "o");
    const saved = db
      .prepare("SELECT quantity FROM order_items WHERE kind='product'")
      .get();
    assert.equal(saved!.quantity, 4);

    const next = await beginCapture(db, ctx, "o", "session", 0);
    await importCapture(db, next.token, {
      ...product(),
      code: "CT200",
      capture_id: randomUUID(),
      quantity: 1,
    });
    state = await captureState(db, ctx, "o");
    const removable = state.staged_items[0];
    state = await updateStagedCaptureItem(db, ctx, "o", removable.id, {
      quantity: 0,
    });
    assert.equal(state.staged_items.length, 0);
  } finally {
    db.close();
  }
});


test("discarding a Sky capture leaves the order untouched", async () => {
  const db = fixture();
  try {
    const started = await beginCapture(db, ctx, "o", "session", 0);
    await importCapture(db, started.token, {
      ...product(),
      capture_id: randomUUID(),
      quantity: 4,
    });
    assert.equal((await captureState(db, ctx, "o")).staged_items.length, 1);
    const discarded = await discardCapture(db, ctx, "o");
    assert.equal(discarded.staged_items.length, 0);
    assert.equal(discarded.items.length, 0);
    assert.equal(db.prepare("SELECT count(*) n FROM order_items").get()!.n, 0);
    assert.equal(
      db.prepare("SELECT count(*) n FROM external_captures").get()!.n,
      0,
    );
    assert.equal(db.prepare("SELECT count(*) n FROM service_times").get()!.n, 0);
  } finally {
    db.close();
  }
});

test("Sky capture stays staged until explicit confirmation and duplicate clicks do not duplicate", async () => {
  const db = fixture();
  try {
    const { token } = await beginCapture(db, ctx, "o", "session", 0);
    const item = { ...product(), quantity: 2 };
    const results = await Promise.all([importCapture(db, token, item), importCapture(db, token, item)]);
    assert.equal(results.filter((r) => r.duplicate).length, 1);
    assert.equal(db.prepare("SELECT count(*) n FROM order_items").get()!.n, 0);
    assert.equal(db.prepare("SELECT count(*) n FROM service_times").get()!.n, 0);
    const state = await finishCapture(db, ctx, "o");
    assert.equal(state.items.length, 1);
    assert.equal(state.items[0].kind, "product");
    assert.equal(state.items[0].quantity, 2);
    assert.equal(db.prepare("SELECT total FROM orders WHERE id=?").get("o")!.total, state.items[0].price * 2);
    assert.equal(db.prepare("SELECT stock FROM catalog WHERE kind='product'").get()!.stock, 0);
    await saveOrder(db, ctx, { status: "quote", guest_plate: "ABC1D23", entered_on: "2026-10-03", due_on: "2026-10-03", km: 0, discount: 0, problem: "", notes: "", items: state.items }, "o");
    assert.equal(db.prepare("SELECT cost FROM order_items WHERE kind='product'").get()!.cost, 10000);
    const share = await createShare(db, ctx, "o");
    const publicData = await readShare(db, share.path.split("/").pop()!);
    assert.ok(!JSON.stringify(publicData).includes("duration_seconds"));
    assert.ok(!JSON.stringify(publicData).includes("cost"));
    await assert.rejects(importCapture(db, token, product()), /expirada/);
  } finally { db.close(); }
});
test("capture rejects foreign tenants/, mechanics, mismatched vehicles, revoked sessions and closed quotes", async () => {
  const db = fixture();
  try {
    await assert.rejects(
      beginCapture(db, { ...ctx, role: "operator" }, "o", "session"),
    );
    await assert.rejects(beginCapture(db, ctx, "other", "session"));
    const { token } = await beginCapture(db, ctx, "o", "session");
    await assert.rejects(
      importCapture(db, token, { ...product(), vehicle: { plate: "ZZZ9Z99" } }),
      /outro veículo/,
    );
    assert.equal(db.prepare("SELECT count(*) n FROM catalog").get()!.n, 0);
    await assert.rejects(importCapture(db, "invalid", product()));
    const item = product();
    await importCapture(db, token, item);
    await assert.rejects(
      importCapture(db, token, { ...item, price: 999 }),
      /já utilizada/,
    );
    db.exec("UPDATE orders SET status='cancelled' WHERE id='o'");
    await assert.rejects(importCapture(db, token, product()), /não aceita/);
    db.exec(
      "UPDATE orders SET status='quote' WHERE id='o'; DELETE FROM sessions",
    );
    await assert.rejects(importCapture(db, token, product()), /expirada/);
  } finally {
    db.close();
  }
});
test("extension bearer endpoint works without cookies, requires scoped token and keeps other origins blocked", async () => {
  const db = fixture();
  const app = createApp(db).listen(0, "127.0.0.1");
  await new Promise<void>((r) => app.once("listening", r));
  const base = `http://127.0.0.1:${(app.address() as any).port}`;
  try {
    const { token } = await beginCapture(db, ctx, "o", "session");
    for (const [origin, auth, expected] of [
      ["chrome-extension://" + "a".repeat(32), "Bearer " + token, 200],
      ["https://evil.example", "Bearer " + token, 403],
      ["chrome-extension://" + "a".repeat(32), "Bearer invalid", 401],
    ] as const) {
      const r = await fetch(base + "/api/extension/import", {
        method: "POST",
        headers: {
          Origin: origin,
          Authorization: auth,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(product()),
      });
      assert.equal(r.status, expected, await r.text());
    }
    const removed = await fetch(base + "/api/extension/import", {
      method: "POST",
      headers: { Origin: "chrome-extension://" + "a".repeat(32), Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify({ capture_id: randomUUID(), source: "tempario", name: "Serviço removido" }),
    });
    assert.equal(removed.status, 400);
    const r = await fetch(base + "/api/orders/o/capture-session", {
      method: "POST",
      headers: {
        Origin: "chrome-extension://" + "a".repeat(32),
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    assert.equal(r.status, 403);
  } finally {
    await new Promise<void>((r) => app.close(() => r()));
    db.close();
  }
});
test("original part markup is rounded in cents", () => {
  assert.equal(suggestedPrice(1000), 1800);
  assert.equal(suggestedPrice(500), 1300);
  assert.equal(suggestedPrice(10000), 15000);
  assert.equal(suggestedPrice(15001), 21751);
});

test("extension discard removes staged captures and revokes bearer token", async () => {
  const db = fixture();
  try {
    const target = await beginCapture(db, ctx, "o", "session");
    await importCapture(db, target.token, product());
    assert.equal((await captureState(db, ctx, "o")).staged_items.length, 1);
    await discardExtensionCapture(db, target.token);
    assert.equal((await captureState(db, ctx, "o")).staged_items.length, 0);
    await assert.rejects(
      () => importCapture(db, target.token, product()),
      /expirada/,
    );
    await assert.rejects(
      () => discardExtensionCapture(db, "invalid"),
      /Conecte/,
    );
  } finally {
    db.close();
  }
});
