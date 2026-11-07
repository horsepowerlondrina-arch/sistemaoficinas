import { readFileSync, readdirSync } from "node:fs";
import pg from "pg";

if (process.env.GITHUB_ACTIONS !== "true") throw new Error("Somente CI descartável.");
const raw = process.env.CI_PG_ADMIN_URL || "";
let url;
try { url = new URL(raw); } catch { throw new Error("Configure a conexão PostgreSQL temporária."); }
if (!["127.0.0.1", "localhost"].includes(url.hostname) ||
    url.pathname !== "/postgres" || url.username !== "postgres" || url.search || url.hash)
  throw new Error("Somente o PostgreSQL temporário da CI é permitido.");

const admin = new pg.Client({ connectionString: raw });
await admin.connect();
try {
  for (const role of ["anon", "authenticated", "service_role", "horse_power_app", "hp_platform_admin_app"]) {
    await admin.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='${role}') THEN CREATE ROLE ${role} NOLOGIN; END IF; END $$`);
  }
  await admin.query("CREATE DATABASE horse_power_cloud_ci");
} finally {
  await admin.end();
}

url.pathname = "/horse_power_cloud_ci";
const files = readdirSync(new URL("../supabase/migrations/", import.meta.url))
  .filter(name => /^\d{14}_[a-z0-9_]+\.sql$/.test(name)).sort();
if (files.length < 49) throw new Error("Conjunto de migrações incompleto.");
for (const name of files) {
  const client = new pg.Client({ connectionString: url.toString() });
  await client.connect();
  try {
    await client.query(readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8"));
  } catch (error) {
    throw new Error(`Falha na migração ${name}: ${error instanceof Error ? error.message : "erro"}`);
  } finally {
    await client.end();
  }
}
const check = new pg.Client({ connectionString: url.toString() });
await check.connect();
try {
  const result = await check.query(`SELECT
    to_regclass('horse_power.orders') IS NOT NULL AS orders,
    to_regclass('platform_admin.workshops') IS NOT NULL AS workshops,
    to_regclass('service_catalog.repair_times') IS NOT NULL AS repair_times,
    to_regprocedure('horse_power.local_tenant_access_state(text)') IS NOT NULL AS access_state,
    to_regprocedure('horse_power.local_tenant_plan_summary(text)') IS NOT NULL AS plan_summary,
    (SELECT count(*) FROM pg_tables WHERE schemaname='horse_power' AND rowsecurity) >= 30 AS tenant_rls`);
  if (!Object.values(result.rows[0]).every(Boolean))
    throw new Error("Esquema isolado incompleto.");
  console.log(`Esquema novo validado com ${files.length} migrações em PostgreSQL 17 descartável.`);
} finally {
  await check.end();
}
