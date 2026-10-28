import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createPostgresDatabase } from "../server/db/postgres.js";
import { digest } from "../server/auth/session.js";
import {
  beginCapture,
  importCapture,
  finishCapture,
} from "../server/services/extension.js";
import { createApp } from "../server/app.js";
import { enableExtensionCatalog } from "../server/services/catalogReset.js";
const db = createPostgresDatabase();
const tenant = "ext-test-" + randomUUID(),
  user = randomUUID(),
  order = randomUUID(),
  sessionToken = randomUUID();
const ctx = { tenantId: tenant, userId: user, role: "owner" };
try {
  await db
    .prepare("INSERT INTO tenants(id,name) VALUES(?,?)")
    .run(tenant, "Teste temporário da extensão");
  await db
    .prepare("INSERT INTO users(id,name,email,password_hash) VALUES(?,?,?,?)")
    .run(user, "Teste", user + "@invalid.local", "disabled");
  await db
    .prepare(
      "INSERT INTO memberships(user_id,tenant_id,role) VALUES(?,?,'owner')",
    )
    .run(user, tenant);
  await db
    .prepare(
      "INSERT INTO sessions(token_hash,user_id,tenant_id,expires_at) VALUES(?,?,?,?)",
    )
    .run(digest(sessionToken), user, tenant, Date.now() + 300000);
  await db
    .prepare(
      "INSERT INTO orders(id,tenant_id,number,kind,status,entered_on,due_on,km,total) VALUES(?,?,1,'quote','quote','2026-10-03','2026-10-03',0,0)",
    )
    .run(order, tenant);
  const target = await beginCapture(db, ctx, order, sessionToken);
  assert.equal(target.plate, "");
  const part = {
    capture_id: randomUUID(), source: "sky", name: "Peça teste integração A",
    code: "TEST-A", brand: "Marca teste", cost: 10000, quantity: 2,
  };
  const results = await Promise.all([
    importCapture(db, target.token, part),
    importCapture(db, target.token, part),
  ]);
  assert.equal(results.filter((r) => r.duplicate).length, 1);
  await importCapture(db, target.token, {
    capture_id: randomUUID(), source: "sky", name: "Peça teste integração B",
    code: "TEST-B", brand: "Marca teste", cost: 10000, quantity: 1,
  });
  assert.equal((await db.prepare("SELECT COUNT(*) n FROM service_times WHERE tenant_id=?").get(tenant))?.n, 0);
  const state = await finishCapture(db, ctx, order);
  assert.equal(state.items.length, 2);
  assert.equal(state.total, 45000);
  // Verify published authenticated endpoints using only an isolated test tenant.
  if (process.env.VERIFY_ORIGIN) {
    assert.equal((await enableExtensionCatalog(db, ctx)).archived, 2);
    await db
      .prepare("UPDATE orders SET guest_plate=? WHERE id=? AND tenant_id=?")
      .run("abc-1d23", order, tenant);
    const base = process.env.VERIFY_ORIGIN,
      headers = {
        Cookie: `hp_session=${sessionToken}`,
        "Content-Type": "application/json",
        Origin: base,
      };
    const workspace = await fetch(base + "/api/workspace", { headers });
    assert.equal(workspace.status, 200);
    const emptyCatalog = await workspace.json();
    assert.equal(emptyCatalog.catalog_mode, "extension");
    assert.equal(emptyCatalog.catalog.length, 0);
    assert.equal(emptyCatalog.orders[0].items.length, 2);
    const manual = await fetch(base + "/api/catalog", {
      method: "POST",
      headers,
      body: JSON.stringify({
        kind: "service",
        name: "Cadastro manual permitido",
        sku: "MANUAL",
        cost: 0,
        price: 100,
        stock: 0,
        minimum_stock: 0,
      }),
    });
    assert.equal(manual.status, 200);
    const start = await fetch(
      base + "/api/orders/" + order + "/capture-session",
      { method: "POST", headers, body: "{}" },
    );
    assert.equal(start.status, 200, await start.clone().text());
    const { token, plate } = await start.json();
    assert.equal(plate, "ABC1D23");
    const r = await fetch(base + "/api/extension/import", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "chrome-extension://" + "a".repeat(32),
        Authorization: "Bearer " + token,
      },
      body: JSON.stringify({
        ...part,
        capture_id: randomUUID(),
        name: "Peça teste API",
        code: "TEST-C",
        quantity: 1,
      }),
    });
    assert.equal(r.status, 200, await r.text());
    assert.equal((await fetch(base + "/api/service-times", { headers })).status, 404);
    const removedSource = await fetch(base + "/api/extension/import", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "chrome-extension://" + "a".repeat(32), Authorization: "Bearer " + token },
      body: JSON.stringify({ capture_id: randomUUID(), source: "tempario", name: "Serviço removido" }),
    });
    assert.equal(removedSource.status, 400);
    const refreshed = await (
      await fetch(base + "/api/workspace", { headers })
    ).json();
    assert.equal(refreshed.catalog.length, 2);
    assert.equal(refreshed.orders[0].items.length, 3);
    const end = await fetch(base + "/api/orders/" + order + "/end-capture", {
      method: "POST",
      headers,
      body: "{}",
    });
    assert.equal(end.status, 200);
    const catalogTarget = randomUUID();
    const connectCatalog = await fetch(
      base + `/api/catalog-capture/${catalogTarget}/start`,
      { method: "POST", headers, body: JSON.stringify({ freight_unit: 100 }) },
    );
    assert.equal(connectCatalog.status, 200);
    const catalogSession = await connectCatalog.json();
    assert.equal(catalogSession.destination, "catalog");
    const imported = await fetch(base + "/api/extension/import", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + catalogSession.token,
      },
      body: JSON.stringify({
        capture_id: randomUUID(),
        source: "sky",
        name: "Peça teste frete",
        code: "FRETE",
        brand: "TEST",
        cost: 500,
      }),
    });
    assert.equal(imported.status, 200, await imported.text());
    const catalogState = await (
      await fetch(base + `/api/catalog-capture/${catalogTarget}/end`, {
        method: "POST",
        headers,
        body: "{}",
      })
    ).json();
    const part = catalogState.items[0];
    assert.equal(part.cost, 600);
    assert.equal(part.price, 1400);
    assert.equal(part.freight_unit, 100);
    assert.equal(part.stock, 0);
    const stockInput = {
      quantity: 3,
      cost: 600,
      freight_unit: 100,
      price: 1400,
      reason: "Entrada teste isolada",
      request_id: randomUUID(),
    };
    for (let n = 0; n < 2; n++) {
      const receipt = await fetch(base + `/api/stock/${part.id}`, {
        method: "POST",
        headers,
        body: JSON.stringify(stockInput),
      });
      assert.equal(receipt.status, 200, await receipt.text());
    }
    const saved = await db
      .prepare(
        "SELECT stock,cost,price FROM catalog WHERE tenant_id=? AND id=?",
      )
      .get(tenant, part.id);
    assert.equal(saved?.stock, 3);
    assert.equal(saved?.cost, 600);
    assert.equal(saved?.price, 1400);
    const latest = await (
      await fetch(base + "/api/workspace", { headers })
    ).json();
    assert.equal(latest.parts_pricing.rules.length, 7);
  }
  console.log(
    "Extensão verificada no PostgreSQL: Sky Peças, preços, frete, duplicações e encerramento.",
  );
} finally {
  for (const table of [
    "capture_sessions",
    "service_times",
    "external_captures",
    "external_catalog_links",
    "audit_events",
    "stock_movements",
    "order_items",
    "orders",
    "catalog",
    "sessions",
    "memberships",
  ])
    await db.prepare(`DELETE FROM ${table} WHERE tenant_id=?`).run(tenant);
  await db.prepare("DELETE FROM users WHERE id=?").run(user);
  await db.prepare("DELETE FROM tenants WHERE id=?").run(tenant);
  await db.close();
}
