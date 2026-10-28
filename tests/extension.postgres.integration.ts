import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createLocalDatabase } from "../server/db/local";
import { createApp } from "../server/app";
import { digest } from "../server/auth/session";

test("PostgreSQL RLS permits a renewed Sky token to import once after expiry", async (t) => {
  if (process.env.GITHUB_ACTIONS !== "true") {
    t.skip("This regression test runs only against the disposable PostgreSQL 17 service in GitHub Actions.");
    return;
  }

  const db = await createLocalDatabase();
  const { adminClient } = await import("../scripts/local-admin");
  const admin = adminClient();
  await admin.connect();
  const credentials = JSON.parse(readFileSync("data/local-credentials.json", "utf8"));
  const localA = credentials.find((entry: any) => entry.tenant === "local-a");
  const localB = credentials.find((entry: any) => entry.tenant === "local-b");
  assert.ok(localA && localB, "CI must provide fictitious credentials for both workshops");

  const server = createApp(db).listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const extensionOrigin = "chrome-extension://" + "a".repeat(32);
  const today = new Date().toISOString().slice(0, 10);
  let cookieA = "";
  let cookieB = "";
  let orderId = "";
  let batchId = "";
  let code = "";
  let policiesInstalled = false;

  const request = (path: string, options: {
    cookie?: string;
    body?: unknown;
    origin?: string;
    bearer?: string;
  } = {}) => fetch(base + path, {
    method: options.body === undefined ? "GET" : "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: options.origin || "http://127.0.0.1:5173",
      ...(options.cookie ? { Cookie: options.cookie } : {}),
      ...(options.bearer ? { Authorization: "Bearer " + options.bearer } : {}),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });

  async function installRuntimePolicies() {
    policiesInstalled = true;
    await admin.query("DROP POLICY IF EXISTS backend_access ON horse_power.memberships");
    await admin.query("DROP POLICY IF EXISTS backend_access ON horse_power.sessions");
    await admin.query("DROP POLICY IF EXISTS backend_access ON horse_power.capture_sessions");
    await admin.query(`CREATE POLICY membership_self ON horse_power.memberships FOR SELECT TO hp_local_app
      USING (user_id = NULLIF(current_setting('app.user_id', true), ''))`);
    await admin.query(`CREATE POLICY session_select ON horse_power.sessions FOR SELECT TO hp_local_app USING (
      token_hash = NULLIF(current_setting('app.session_hash', true), '')
      OR (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')
          AND user_id = NULLIF(current_setting('app.user_id', true), ''))
      OR EXISTS (
        SELECT 1 FROM horse_power.capture_sessions c
        WHERE c.token_hash = NULLIF(current_setting('app.extension_hash', true), '')
          AND c.session_hash = sessions.token_hash
          AND c.user_id = sessions.user_id
          AND c.tenant_id = sessions.tenant_id
      )
    )`);
    await admin.query(`CREATE POLICY capture_session_scope ON horse_power.capture_sessions FOR ALL TO hp_local_app
      USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')
        OR token_hash = NULLIF(current_setting('app.extension_hash', true), ''))
      WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), ''))`);
  }

  async function restoreLocalPolicies() {
    await admin.query("DROP POLICY IF EXISTS membership_self ON horse_power.memberships");
    await admin.query("DROP POLICY IF EXISTS session_select ON horse_power.sessions");
    await admin.query("DROP POLICY IF EXISTS capture_session_scope ON horse_power.capture_sessions");
    await admin.query("CREATE POLICY backend_access ON horse_power.memberships FOR ALL TO hp_local_app USING (true) WITH CHECK (true)");
    await admin.query("CREATE POLICY backend_access ON horse_power.sessions FOR ALL TO hp_local_app USING (true) WITH CHECK (true)");
    await admin.query("CREATE POLICY backend_access ON horse_power.capture_sessions FOR ALL TO hp_local_app USING (true) WITH CHECK (true)");
    policiesInstalled = false;
  }

  try {
    const loginA = await request("/api/login", { body: { email: localA.email, password: localA.password } });
    assert.equal(loginA.status, 200, await loginA.clone().text());
    cookieA = loginA.headers.get("set-cookie")!.split(";")[0];
    const loginB = await request("/api/login", { body: { email: localB.email, password: localB.password } });
    assert.equal(loginB.status, 200, await loginB.clone().text());
    cookieB = loginB.headers.get("set-cookie")!.split(";")[0];

    await installRuntimePolicies();

    const orderResponse = await request("/api/orders", {
      cookie: cookieA,
      body: {
        status: "quote",
        guest_name: "Cliente Fictício da Extensão",
        guest_plate: "ABC1D23",
        guest_vehicle: "Veículo Fictício",
        entered_on: today,
        due_on: today,
        km: 0,
        problem: "Teste de conexão da extensão",
        notes: "",
        discount: 0,
        items: [],
      },
    });
    assert.equal(orderResponse.status, 201, await orderResponse.clone().text());
    orderId = (await orderResponse.json() as any).id;

    batchId = randomUUID();
    const start = async () => request(`/api/orders/${orderId}/capture-session`, {
      cookie: cookieA,
      body: { freight_total: 0, batch_id: batchId },
    });
    const firstResponse = await start();
    assert.equal(firstResponse.status, 200, await firstResponse.clone().text());
    const first = await firstResponse.json() as any;

    await admin.query(
      "UPDATE horse_power.capture_sessions SET expires_at=$1 WHERE tenant_id='local-a' AND order_id=$2 AND token_hash=$3",
      [Date.now() - 1000, orderId, digest(first.token)],
    );
    code = "INT015-" + randomUUID();
    const item = {
      capture_id: randomUUID(),
      source: "sky",
      name: "Peça Fictícia para Teste",
      code,
      brand: "Marca Fictícia",
      cost: 12345,
      quantity: 2,
      vehicle: { plate: "ABC1D23", make: "Marca Fictícia", model: "Modelo Fictício", year: "2020", engine: "1.0" },
    };
    const expiredImport = await request("/api/extension/import", {
      origin: extensionOrigin,
      bearer: first.token,
      body: item,
    });
    assert.equal(expiredImport.status, 401);
    assert.match((await expiredImport.json() as any).error, /Conexão expirada/);

    const reconnectedResponse = await start();
    assert.equal(reconnectedResponse.status, 200, await reconnectedResponse.clone().text());
    const reconnected = await reconnectedResponse.json() as any;
    assert.notEqual(reconnected.token, first.token);

    const oldTokenImport = await request("/api/extension/import", {
      origin: extensionOrigin,
      bearer: first.token,
      body: item,
    });
    assert.equal(oldTokenImport.status, 401);

    const importedResponse = await request("/api/extension/import", {
      origin: extensionOrigin,
      bearer: reconnected.token,
      body: item,
    });
    assert.equal(importedResponse.status, 200, await importedResponse.clone().text());
    assert.equal((await importedResponse.json() as any).duplicate, false);

    const duplicateResponse = await request("/api/extension/import", {
      origin: extensionOrigin,
      bearer: reconnected.token,
      body: item,
    });
    assert.equal(duplicateResponse.status, 200, await duplicateResponse.clone().text());
    assert.equal((await duplicateResponse.json() as any).duplicate, true);

    const stateA = await request(`/api/orders/${orderId}/capture-state`, { cookie: cookieA });
    assert.equal(stateA.status, 200, await stateA.clone().text());
    assert.equal((await stateA.json() as any).staged_items.length, 1);
    const stateB = await request(`/api/orders/${orderId}/capture-state`, { cookie: cookieB });
    assert.equal(stateB.status, 404);
  } finally {
    try {
      if (orderId) {
        const rows = await admin.query(
          "SELECT catalog_id FROM horse_power.external_captures WHERE tenant_id='local-a' AND order_id=$1",
          [orderId],
        );
        await admin.query("DELETE FROM horse_power.external_captures WHERE tenant_id='local-a' AND order_id=$1", [orderId]);
        await admin.query("DELETE FROM horse_power.external_catalog_links WHERE tenant_id='local-a' AND external_key LIKE $1", ["INT015-%|%"]);
        await admin.query("DELETE FROM horse_power.capture_sessions WHERE tenant_id='local-a' AND order_id=$1", [orderId]);
        await admin.query("DELETE FROM horse_power.order_items WHERE tenant_id='local-a' AND order_id=$1", [orderId]);
        await admin.query("DELETE FROM horse_power.audit_events WHERE tenant_id='local-a' AND entity_id=$1", [orderId]);
        await admin.query("DELETE FROM horse_power.orders WHERE tenant_id='local-a' AND id=$1", [orderId]);
        for (const row of rows.rows)
          await admin.query("DELETE FROM horse_power.catalog WHERE tenant_id='local-a' AND id=$1", [row.catalog_id]);
      }
      if (cookieA || cookieB) {
        const hashes = [cookieA, cookieB].filter(Boolean).map((cookie) => digest(cookie.slice("hp_session=".length)));
        await admin.query("DELETE FROM horse_power.sessions WHERE token_hash = ANY($1::text[])", [hashes]);
      }
      if (policiesInstalled) await restoreLocalPolicies();
    } finally {
      await admin.end();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await db.close();
    }
  }
});
