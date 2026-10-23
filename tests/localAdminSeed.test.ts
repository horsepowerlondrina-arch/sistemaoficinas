import test from "node:test";
import assert from "node:assert/strict";
import { assertLocalSeedEnvironment, createLocalAdminSeedCredentials, validateLocalAdminSeedCredentials, ensureLocalAdminWorkshopPermissions } from "../server/localAdminSeed.js";
import type { Pool } from "pg";

const localUrl = "postgres://hp_platform_admin_app:sample@127.0.0.1:5432/horse_power_local";

test("local admin seed credentials are fictitious, random and structurally validated", () => {
  const first = createLocalAdminSeedCredentials();
  const second = createLocalAdminSeedCredentials();
  assert.equal(first.email, "admin@plataforma.local");
  assert.equal(first.name, "Administrador de desenvolvimento");
  assert.notEqual(first.password, second.password);
  assert.notEqual(first.totpSecret, second.totpSecret);
  assert.deepEqual(validateLocalAdminSeedCredentials(first), first);
  assert.throws(() => validateLocalAdminSeedCredentials({ ...first, email: "real@example.com" }));
});

test("local admin seed accepts only the local database and blocks deployment environments", () => {
  assert.equal(new URL(assertLocalSeedEnvironment({ PLATFORM_ADMIN_DATABASE_URL: localUrl })).pathname, "/horse_power_local");
  assert.equal(new URL(assertLocalSeedEnvironment({ PLATFORM_ADMIN_DATABASE_URL: localUrl.replace("127.0.0.1", "localhost") })).hostname, "localhost");
  for (const env of [
    { PLATFORM_ADMIN_DATABASE_URL: localUrl, VERCEL: "1" },
    { PLATFORM_ADMIN_DATABASE_URL: localUrl, VERCEL_ENV: "preview" },
    { PLATFORM_ADMIN_DATABASE_URL: localUrl, VERCEL_URL: "example.vercel.app" },
    { PLATFORM_ADMIN_DATABASE_URL: localUrl, NODE_ENV: "production" },
    { PLATFORM_ADMIN_DATABASE_URL: localUrl, APP_ENV: "staging" },
    { PLATFORM_ADMIN_DATABASE_URL: localUrl, PGHOST: "remote.example" },
    { PLATFORM_ADMIN_DATABASE_URL: localUrl.replace("127.0.0.1", "db.supabase.co") },
    { PLATFORM_ADMIN_DATABASE_URL: localUrl.replace("horse_power_local", "production") },
    { PLATFORM_ADMIN_DATABASE_URL: localUrl.replace("hp_platform_admin_app", "postgres") },
  ]) assert.throws(() => assertLocalSeedEnvironment(env));
});

function permissionPool(account: Record<string, unknown> | null) {
  const queries: { sql: string; values: unknown[] }[] = [];
  const pool = {
    connect: async () => ({
      query: async (sql: string, values: unknown[] = []) => {
        queries.push({ sql, values });
        if (sql.startsWith("SELECT id,email,role,active,enrolled,permissions"))
          return { rows: account ? [{ ...account }] : [], rowCount: account ? 1 : 0 };
        if (sql.startsWith("UPDATE platform_admin.administrators SET permissions=")) {
          assert.ok(account);
          account.permissions = JSON.parse(String(values[0]));
          return { rows: [], rowCount: 1 };
        }
        if (sql.startsWith("INSERT INTO platform_admin.audit_events")) return { rows: [], rowCount: 1 };
        return { rows: [], rowCount: null };
      },
      release() {},
    }),
  } as unknown as Pool;
  return { pool, queries };
}

test("local seed reconciliation adds only workshop permissions once to the active fictional principal", async () => {
  const account = {
    id: "fictional-admin", email: "admin@plataforma.local", role: "principal", active: true, enrolled: true,
    permissions: ["audit:read", "platform:settings"], password_hash: "unchanged-password-hash", totp_secret_ciphertext: "unchanged-totp", sessions: ["preserve-session"],
  };
  const { pool, queries } = permissionPool(account);
  assert.deepEqual(await ensureLocalAdminWorkshopPermissions(pool), { status: "updated", added: ["workshops:read", "workshops:manage"] });
  assert.deepEqual(account.permissions, ["audit:read", "platform:settings", "workshops:read", "workshops:manage"]);
  assert.equal(account.password_hash, "unchanged-password-hash");
  assert.equal(account.totp_secret_ciphertext, "unchanged-totp");
  assert.deepEqual(account.sessions, ["preserve-session"]);
  const audit = queries.find(query => query.sql.startsWith("INSERT INTO platform_admin.audit_events"));
  assert.equal(audit?.values[5], "admin.local_seed.permissions_reconciled");
  assert.equal(JSON.parse(String(audit?.values[7])).added_permissions, "workshops:read,workshops:manage");
  assert.deepEqual(await ensureLocalAdminWorkshopPermissions(pool), { status: "unchanged", added: [] });
  assert.equal(queries.filter(query => query.sql.startsWith("UPDATE platform_admin.administrators SET permissions=")).length, 1);
  assert.equal(queries.filter(query => query.sql.startsWith("INSERT INTO platform_admin.audit_events")).length, 1);
});

test("local seed reconciliation never grants an inactive, un-enrolled or non-principal account", async () => {
  for (const patch of [{ active: false }, { enrolled: false }, { role: "finance" }]) {
    const account = {
      id: "fictional-admin", email: "admin@plataforma.local", role: "principal", active: true, enrolled: true,
      permissions: ["audit:read"], ...patch,
    };
    const { pool, queries } = permissionPool(account);
    const result = await ensureLocalAdminWorkshopPermissions(pool);
    assert.notEqual(result.status, "updated");
    assert.equal(queries.some(query => query.sql.startsWith("UPDATE platform_admin.administrators SET permissions=")), false);
    assert.equal(queries.some(query => query.sql.startsWith("INSERT INTO platform_admin.audit_events")), false);
  }
});
