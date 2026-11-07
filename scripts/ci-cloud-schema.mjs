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
    if (name.startsWith("20261019215935_")) {
      // The next historical migration activates the catalog only after checking its data.
      // A tiny fictional release exercises that path without copying the real catalog.
      await client.query(`INSERT INTO service_catalog.brands(id,name) VALUES
          ('00000000-0000-4000-8000-000000000001','Marca Fictícia');
        INSERT INTO service_catalog.classifications(id,name) VALUES
          ('00000000-0000-4000-8000-000000000004','Veículo Compacto'),
          ('00000000-0000-4000-8000-000000000014','Veículo Médio'),
          ('00000000-0000-4000-8000-000000000024','Veículo Premium'),
          ('00000000-0000-4000-8000-000000000034','Veículo de Luxo');
        INSERT INTO service_catalog.families(id,brand_id) VALUES
          ('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001');
        INSERT INTO service_catalog.bases(id,family_id,service_count) VALUES
          ('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000002',1);
        INSERT INTO service_catalog.services(id,name) VALUES
          ('00000000-0000-4000-8000-000000000005','Serviço Fictício');
        INSERT INTO service_catalog.models
          (id,brand_id,family_id,classification_id,name,fipe_code,complete,service_count,base_id,excluded_service_ids)
          VALUES ('00000000-0000-4000-8000-000000000006','00000000-0000-4000-8000-000000000001',
          '00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000004',
          'Modelo Fictício','000000-0',1,1,'00000000-0000-4000-8000-000000000003','[]');
        INSERT INTO service_catalog.repair_times
          (id,base_id,service_id,service_name,minutes,time_identifier)
          VALUES ('00000000-0000-4000-8000-000000000007','00000000-0000-4000-8000-000000000003',
          '00000000-0000-4000-8000-000000000005','Serviço Fictício',30,'fixture');
        INSERT INTO service_catalog.releases(version,status,source_sha256,model_count,time_count,application_count)
          VALUES ('homologacao-sintetica','loading','synthetic',1,1,1)`);
    }
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
  // The historical chain needs a tiny release; the definitive catalog must start empty.
  await check.query("BEGIN");
  try {
    const modelId = "00000000-0000-4000-8000-000000000006";
    await check.query("DELETE FROM service_catalog.model_labor_categories WHERE model_id=$1", [modelId]);
    for (const [table, id] of [
      ["repair_times", "00000000-0000-4000-8000-000000000007"],
      ["models", modelId],
      ["bases", "00000000-0000-4000-8000-000000000003"],
      ["families", "00000000-0000-4000-8000-000000000002"],
      ["services", "00000000-0000-4000-8000-000000000005"],
      ["brands", "00000000-0000-4000-8000-000000000001"],
    ]) {
      const deleted = await check.query(`DELETE FROM service_catalog.${table} WHERE id=$1`, [id]);
      if (deleted.rowCount !== 1) throw new Error(`Fixture incompleta: ${table}.`);
    }
    const classes = await check.query("DELETE FROM service_catalog.classifications WHERE id=ANY($1::uuid[])", [[
      "00000000-0000-4000-8000-000000000004",
      "00000000-0000-4000-8000-000000000014",
      "00000000-0000-4000-8000-000000000024",
      "00000000-0000-4000-8000-000000000034",
    ]]);
    if (classes.rowCount !== 4) throw new Error("Fixture incompleta: classificações.");
    const release = await check.query("DELETE FROM service_catalog.releases WHERE version='homologacao-sintetica' AND source_sha256='synthetic'");
    if (release.rowCount !== 1) throw new Error("Fixture incompleta: release.");
    for (const table of ["brands", "classifications", "families", "bases", "models", "services", "repair_times", "model_labor_categories", "releases"]) {
      const count = await check.query(`SELECT count(*)::int n FROM service_catalog.${table}`);
      if (count.rows[0].n !== 0) throw new Error(`O catálogo não está vazio após limpeza: ${table}.`);
    }
    await check.query("COMMIT");
  } catch (error) {
    await check.query("ROLLBACK");
    throw error;
  }
  console.log(`Esquema novo validado com ${files.length} migrações e catálogo vazio em PostgreSQL 17 descartável.`);
} finally {
  await check.end();
}
