import { existsSync } from "node:fs";
import { adminClient } from "./local-admin.js";
import { localDatabaseUrl } from "../server/localConfig.js";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const runtimeUrl = new URL(localDatabaseUrl(process.env.LOCAL_DATABASE_URL));
const client = adminClient();
try {
  await client.connect();
  const identity = await client.query("SELECT current_database() AS database, current_setting('server_version') AS server_version, host(inet_server_addr()) AS server_address");
  const address = String(identity.rows[0]?.server_address || "");
  if (identity.rows[0]?.database !== "horse_power_local" || !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(address))
    throw new Error(`Preflight recusado: banco=${String(identity.rows[0]?.database)}, endereço=${address || "indisponível"}.`);
  const schemas = await client.query("SELECT nspname FROM pg_namespace WHERE nspname IN ('horse_power','service_catalog','platform_admin') ORDER BY nspname");
  const migration = await client.query("SELECT sha256 FROM local_setup.migrations WHERE version='007-platform-workshops'");
  const tenants = await client.query("SELECT count(*)::int AS count FROM horse_power.tenants");
  const registry = await client.query("SELECT to_regclass('platform_admin.workshops') IS NOT NULL AS exists");
  const accessFunction = await client.query("SELECT to_regprocedure('horse_power.local_tenant_access_state(text)') IS NOT NULL AS exists");
  if (!schemas.rows.some(row => row.nspname === "horse_power") || !schemas.rows.some(row => row.nspname === "platform_admin"))
    throw new Error("Schemas necessários não estão presentes; nenhuma alteração foi feita.");
  console.log(JSON.stringify({
    database: identity.rows[0].database,
    server_version: identity.rows[0].server_version,
    server_address: address,
    runtime_host: runtimeUrl.hostname,
    schemas: schemas.rows.map(row => row.nspname),
    existing_tenant_count: tenants.rows[0].count,
    migration_007_recorded: migration.rows.length === 1,
    workshop_registry_exists: registry.rows[0].exists,
    local_access_function_exists: accessFunction.rows[0].exists,
  }, null, 2));
} finally { await client.end(); }
