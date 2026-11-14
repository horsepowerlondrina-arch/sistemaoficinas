import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { once } from "node:events";
import type { Pool } from "pg";
import { selfServiceRoutes } from "../server/selfServiceRoutes.js";
import { selfServiceTestEmails, testOrigin } from "../server/services/selfServicePolicy.js";

test("self service refuses production, historical deployment and addresses outside explicit test recipients", () => {
  const e = { SELF_SERVICE_TEST_ENABLED: "true", SELF_SERVICE_TEST_EMAILS: "basic@testes.osdrive.com.br", APP_ENV: "development", EXPECTED_DATABASE_PROJECT: "vnclahdnirqlcbamodqy", VERCEL: "1", NODE_ENV: "production" };
  assert.deepEqual(selfServiceTestEmails(e), []);
  assert.deepEqual(selfServiceTestEmails({ ...e, VERCEL_PROJECT_ID: "another" }), []);
  assert.deepEqual(selfServiceTestEmails({ ...e, VERCEL_PROJECT_ID: "prj_rLVsFKBpMXQFtfm1kgYHFQObr4Jc", APP_ENV: "horse_power" }), []);
  assert.deepEqual(selfServiceTestEmails({ ...e, VERCEL_PROJECT_ID: "prj_rLVsFKBpMXQFtfm1kgYHFQObr4Jc" }), [e.SELF_SERVICE_TEST_EMAILS]);
  assert.deepEqual(selfServiceTestEmails({ ...e, SELF_SERVICE_TEST_EMAILS: "user@real.test" }), []);
});

test("self service enforces origins, avoids email enumeration and never returns activation secrets", async () => {
  const previous = { ...process.env };
  process.env.SELF_SERVICE_TEST_ENABLED = "true";
  process.env.SELF_SERVICE_TEST_EMAILS = "basic@testes.osdrive.com.br";
  delete process.env.VERCEL;
  let registered = 0, sent = 0, duplicate = false, count = 1;
  const pool = { async query(sql: string, args: unknown[]) {
    if (sql.startsWith("INSERT INTO platform_admin.login_attempts")) return { rows: [{ count }] };
    if (sql.includes("create_workshop_self_service")) {
      if (duplicate) throw Object.assign(new Error(), { code: "23505" });
      registered++; assert.match(String(args[8]), /^[a-f0-9]{64}$/);
    }
    return { rows: [] };
  } } as unknown as Pool;
  const app = express(); app.use(express.json()); app.use(selfServiceRoutes(pool, async i => {
    sent++; assert.match(i.token, /^[a-f0-9]{64}$/); return { tokenHash: "" };
  }));
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}/admin-api/workshop-registration`;
  const body = { workshop: { name: "Oficina Fictícia", responsible_name: "Master Fictício", responsible_email: process.env.SELF_SERVICE_TEST_EMAILS }, plan_code: "basic" };
  const post = (data: unknown, origin: string | null = testOrigin) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify(data) });
  try {
    assert.equal((await post(body, "https://attacker.test")).status, 403);
    assert.equal((await post(body, null)).status, 403);
    assert.equal((await post({ ...body, role: "owner" })).status, 400);
    const accepted = await post(body); assert.equal(accepted.status, 202);
    const publicBody = await accepted.json(); assert.deepEqual(Object.keys(publicBody), ["message"]);
    duplicate = true;
    assert.deepEqual(await (await post(body)).json(), publicBody);
    assert.deepEqual(await (await post({ ...body, workshop: { ...body.workshop, responsible_email: "other@testes.osdrive.com.br" } })).json(), publicBody);
    assert.equal(registered, 1); assert.equal(sent, 1);
    count = 13; assert.equal((await post(body)).status, 429);
    process.env.SELF_SERVICE_TEST_ENABLED = "false";
    assert.equal((await post(body)).status, 404);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
  }
});
