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
  // The disposable database needs the application role referenced by local migrations.
  await target.query("CREATE ROLE hp_local_app NOLOGIN");
  const files = readdirSync("local-postgres")
    .filter((name) => /^\d{3}-.*\.sql$/.test(name))
    .sort();
  if (
    files.length < 32 ||
    !files.includes("021-vehicle-update-audit-metadata.sql") ||
    !files.includes("022-admin-workshop-entitlements.sql") ||
    !files.includes("023-private-workshop-services.sql") ||
    !files.includes("024-admin-technical-catalog-entitlement.sql") ||
    !files.includes("025-private-service-categories-references.sql") ||
    !files.includes("026-vehicle-fipe-identity.sql") ||
    !files.includes("027-admin-workshop-management.sql") ||
    !files.includes("028-admin-external-plate-entitlement.sql") ||
    !files.includes("029-card-machines.sql") ||
    !files.includes("030-adm003-plan-entitlements.sql") ||
    !files.includes("031-retire-bulk-catalog-test-access.sql") ||
    !files.includes("032-password-reset.sql")
  )
    throw new Error(
      "A sequência de migrações locais até a 032, incluindo recuperação de senha, não está presente.",
    );
  for (const file of files)
    await target.query(readFileSync(join("local-postgres", file), "utf8"));
  await target.query("BEGIN");
  await target.query(`INSERT INTO service_catalog.brands(id,name) VALUES('00000000-0000-4000-8000-000000000001','Marca Fictícia');
    INSERT INTO service_catalog.classifications(id,name) VALUES
      ('00000000-0000-4000-8000-000000000004','Compacto'),
      ('00000000-0000-4000-8000-000000000014','Médio'),
      ('00000000-0000-4000-8000-000000000024','Premium'),
      ('00000000-0000-4000-8000-000000000034','Pesado');
    INSERT INTO service_catalog.families(id,brand_id) VALUES('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001');
    INSERT INTO service_catalog.bases(id,family_id,service_count) VALUES('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000002',0)`);
  await target.query("SET LOCAL ROLE hp_catalog_importer");
  await target.query(`INSERT INTO service_catalog.models
    (id,brand_id,family_id,classification_id,name,fipe_code,complete,service_count,base_id,excluded_service_ids)
    VALUES('ab7b2905-17d3-4664-8743-62ef07085599','00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000014',
      'Modelo Fictício','000000-0',1,0,'00000000-0000-4000-8000-000000000003','[]')`);
  const model = await target.query("SELECT c.name FROM service_catalog.models m JOIN service_catalog.classifications c ON c.id=m.classification_id");
  assert.equal(model.rows[0].name,"Médio", "historical CAT-007 UUIDs must not override the catalog porte");
  assert.equal((await target.query("SELECT count(*)::int n FROM service_catalog.model_labor_categories")).rows[0].n,0);
  const hash="a".repeat(64);
  await target.query("INSERT INTO service_catalog.releases(version,status,source_sha256,model_count,time_count,application_count) VALUES('2.0-quatro-portes','loading',$1,7534,836093,7292579)",[hash]);
  const release=await target.query("UPDATE service_catalog.releases SET status='active',validated_at=now() WHERE version='2.0-quatro-portes'");
  assert.equal(release.rowCount,1);
  await target.query("ROLLBACK");
  assert.equal((await target.query("SELECT count(*)::int n FROM service_catalog.models")).rows[0].n,0);
  assert.equal((await target.query("SELECT count(*)::int n FROM service_catalog.classifications")).rows[0].n,0);

  await target.query("CREATE ROLE cat008_rls_negative NOLOGIN");
  await target.query("GRANT USAGE ON SCHEMA service_catalog TO cat008_rls_negative");
  await target.query("GRANT INSERT ON service_catalog.brands TO cat008_rls_negative");
  await target.query("BEGIN");
  try {
    await target.query("SET LOCAL ROLE cat008_rls_negative");
    await assert.rejects(target.query("INSERT INTO service_catalog.brands(id,name) VALUES('00000000-0000-4000-8000-000000000009','Marca Negada')"),/permission denied|row-level security/);
  } finally { await target.query("ROLLBACK"); }
  console.log("Disposable PostgreSQL 17: four direct portes, historical override isolation, release RLS and rollback passed. No external source loaded.");
} catch (error) {
  await target.query("ROLLBACK").catch(() => {});
  console.error(
    error instanceof Error ? error.message : "CAT-008 preflight setup failed.",
  );
  process.exitCode = 1;
} finally {
  await target.end().catch(() => {});
}


