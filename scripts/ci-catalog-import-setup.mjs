import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
import pg from "pg";

function fail() {
  throw new Error(
    "CAT-008 preflight setup accepts only the disposable GitHub Actions PostgreSQL 17 service.",
  );
}
if (process.env.GITHUB_ACTIONS !== "true") fail();
let adminUrl;
try {
  adminUrl = new URL(process.env.CI_PG_ADMIN_URL || "");
} catch {
  fail();
}
if (
  !["127.0.0.1", "localhost", "[::1]"].includes(adminUrl.hostname) ||
  adminUrl.pathname !== "/postgres" ||
  adminUrl.search ||
  adminUrl.hash ||
  decodeURIComponent(adminUrl.username) !== "postgres"
)
  fail();
const admin = new pg.Client({
  connectionString: adminUrl.toString(),
  ssl: false,
  connectionTimeoutMillis: 5000,
});
const database = "horse_power_cat008_test";
try {
  await admin.connect();
  if (
    (
      await admin.query("SELECT 1 FROM pg_database WHERE datname=$1", [
        database,
      ])
    ).rowCount
  )
    fail();
  await admin.query(
    `CREATE DATABASE ${database} ENCODING 'UTF8' TEMPLATE template0`,
  );
} finally {
  await admin.end().catch(() => {});
}

const targetUrl = new URL(adminUrl);
targetUrl.pathname = `/${database}`;
const target = new pg.Client({
  connectionString: targetUrl.toString(),
  ssl: false,
  connectionTimeoutMillis: 5000,
});
try {
  await target.connect();
  const files = readdirSync("local-postgres")
    .filter((name) => /^\d{3}-.*\.sql$/.test(name))
    .sort();
  if (files.length !== 18)
    throw new Error(
      "A série completa de 18 migrações locais não está presente.",
    );
  for (const file of files)
    await target.query(readFileSync(join("local-postgres", file), "utf8"));
  await target.query("BEGIN");
  await target.query(`INSERT INTO service_catalog.brands(id,name) VALUES('00000000-0000-4000-8000-000000000001','Marca Fictícia');
    INSERT INTO service_catalog.classifications(id,name) VALUES('00000000-0000-4000-8000-000000000004','Veículo Compacto');
    INSERT INTO service_catalog.families(id,brand_id) VALUES('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001');
    INSERT INTO service_catalog.bases(id,family_id,service_count) VALUES('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000002',1);
    INSERT INTO service_catalog.services(id,name) VALUES('00000000-0000-4000-8000-000000000005','Inspeção Fictícia');
    INSERT INTO service_catalog.models(id,brand_id,family_id,classification_id,name,fipe_code,complete,service_count,base_id,excluded_service_ids)
      VALUES('00000000-0000-4000-8000-000000000006','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000004','Modelo Fictício','000000-0',1,1,'00000000-0000-4000-8000-000000000003','[]');
    INSERT INTO service_catalog.repair_times(id,base_id,model_id,service_id,service_name,minutes,time_identifier)
      VALUES('00000000-0000-4000-8000-000000000007','00000000-0000-4000-8000-000000000003',NULL,'00000000-0000-4000-8000-000000000005','Inspeção Fictícia',30,'synthetic-demo');
    INSERT INTO service_catalog.releases(version,status,source_sha256,model_count,time_count,application_count)
      VALUES('homologacao-sintetica','active','synthetic',1,1,1)`);
  await target.query("COMMIT");
  await target.query("BEGIN");
  await target.query(
    "SELECT service_catalog.prepare_catalog_import_for_cat008()",
  );
  const cleaned = await target.query(`SELECT
    (SELECT count(*)::int FROM service_catalog.brands) brands,
    (SELECT count(*)::int FROM service_catalog.models) models,
    (SELECT count(*)::int FROM service_catalog.services) services,
    (SELECT count(*)::int FROM service_catalog.repair_times) repair_times,
    (SELECT status FROM service_catalog.releases WHERE version='homologacao-sintetica') synthetic_status`);
  assert.deepEqual(cleaned.rows[0], {
    brands: 0,
    models: 0,
    services: 0,
    repair_times: 0,
    synthetic_status: "retired",
  });
  await target.query("ROLLBACK");
  const retained = await target.query(
    "SELECT count(*)::int n FROM service_catalog.models WHERE id='00000000-0000-4000-8000-000000000006'",
  );
  assert.equal(
    retained.rows[0].n,
    1,
    "preflight fixture verification must rollback its synthetic cleanup",
  );
  console.log(
    "Disposable PostgreSQL 17 prepared; safe fixture cleanup passed and the fixture remains available for a repeatable import.",
  );
} catch (error) {
  await target.query("ROLLBACK").catch(() => {});
  console.error(
    error instanceof Error ? error.message : "CAT-008 preflight setup failed.",
  );
  process.exitCode = 1;
} finally {
  await target.end().catch(() => {});
}
