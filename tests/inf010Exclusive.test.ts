import test from "node:test";
import assert from "node:assert/strict";
import { createPlatformAdminApp } from "../server/platformAdminApp.js";
import {
  exclusiveLocalRoles,
  configureLocalHomologation,
  localConnectionRoles,
} from "../server/localHomologationConfig.js";
import { once } from "node:events";
import type { Pool } from "pg";
test("INF010 dedicated logins are accepted only in explicitly isolated local mode", () => {
  const env: Record<string, string> = {
    LOCAL_HOMOLOGATION: "true",
    LOCAL_EXCLUSIVE_CREDENTIALS: "true",
    DATABASE_URL:
      "postgresql://osdrive_local_app.vnclahdnirqlcbamodqy:fake@aws-1-ca-central-1.pooler.supabase.com:6543/postgres",
    PLATFORM_ADMIN_DATABASE_URL:
      "postgresql://osdrive_local_admin.vnclahdnirqlcbamodqy:fake@aws-1-ca-central-1.pooler.supabase.com:6543/postgres",
    PLATFORM_ADMIN_TOTP_ENCRYPTION_KEY: "0".repeat(64),
  };
  configureLocalHomologation(env);
  assert.deepEqual(localConnectionRoles(env), {
    operational: "osdrive_local_app",
    admin: "osdrive_local_admin",
  });
  assert.equal(
    exclusiveLocalRoles({ LOCAL_EXCLUSIVE_CREDENTIALS: "true" }),
    false,
  );
  assert.throws(() =>
    configureLocalHomologation({
      ...env,
      LOCAL_EXCLUSIVE_CREDENTIALS: "false",
    }),
  );
});
test("INF010 local admin rejects other identities and enrollment without touching the database", async () => {
  const original = {
    LOCAL_HOMOLOGATION: process.env.LOCAL_HOMOLOGATION,
    LOCAL_EXCLUSIVE_CREDENTIALS: process.env.LOCAL_EXCLUSIVE_CREDENTIALS,
  };
  process.env.LOCAL_HOMOLOGATION = "true";
  process.env.LOCAL_EXCLUSIVE_CREDENTIALS = "true";
  let queries = 0;
  const pool = {
    query: async () => {
      queries++;
      throw new Error("Unexpected database write");
    },
  } as unknown as Pool;
  const app = createPlatformAdminApp(pool, "0".repeat(64));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    for (const [path, body] of [
      [
        "/admin-api/login",
        {
          email: "existing@example.test",
          password: "placeholder",
          code: "123456",
        },
      ],
      ["/admin-api/enroll/start", {}],
      ["/admin-api/administrators", {}],
    ] as const) {
      const r = await fetch(base + path, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://127.0.0.1:5173",
        },
        body: JSON.stringify(body),
      });
      assert.equal(r.status, 403);
    }
    assert.equal(queries, 0);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    for (const [k, v] of Object.entries(original)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});
