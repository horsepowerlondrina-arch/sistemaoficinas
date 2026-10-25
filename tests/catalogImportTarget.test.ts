import test from "node:test";
import assert from "node:assert/strict";
import { assertTarget } from "../scripts/catalog-import";

const projectRef = "vnclahdnirqlcbamodqy";
const dispatchEnv = {
  CATALOG_IMPORT_TARGET: "homologation",
  CATALOG_IMPORT_CONFIRM: "CAT-008-HOMOLOGATION-IMPORT",
  CATALOG_RIGHTS_CONFIRMED: "true",
  GITHUB_ACTIONS: "true",
  GITHUB_EVENT_NAME: "workflow_dispatch",
};

test("CAT-008 target guard accepts only explicit local or HMG destinations", () => {
  assert.equal(
    assertTarget({
      CATALOG_IMPORT_DATABASE_URL:
        "postgres://postgres:test@127.0.0.1:5432/horse_power_cat008_test",
      CATALOG_IMPORT_CONFIRM: "CAT-008-ISOLATED-LOCAL",
      CATALOG_IMPORT_TARGET: "local",
    }).target,
    "local",
  );
  assert.throws(
    () =>
      assertTarget({
        ...dispatchEnv,
        CATALOG_IMPORT_DATABASE_URL:
          "postgres://hp_catalog_import_login:test@db.prod.supabase.co:5432/postgres",
      }),
    /homologação exige workflow_dispatch/,
  );
  assert.throws(
    () =>
      assertTarget({
        ...dispatchEnv,
        CATALOG_IMPORT_DATABASE_URL: `postgres://postgres:test@db.${projectRef}.supabase.co:5432/postgres`,
      }),
    /homologação exige workflow_dispatch/,
  );
  assert.throws(
    () =>
      assertTarget({
        ...dispatchEnv,
        PGHOST: "unexpected-host",
        CATALOG_IMPORT_DATABASE_URL: `postgres://hp_catalog_import_login:test@db.${projectRef}.supabase.co:5432/postgres`,
      }),
    /variável PostgreSQL implícita/,
  );
});

test("CAT-008 HMG guard requires the exact ref, restricted login, TLS, and manual confirmation", () => {
  const direct = assertTarget({
    ...dispatchEnv,
    CATALOG_IMPORT_DATABASE_URL: `postgres://hp_catalog_import_login:test@db.${projectRef}.supabase.co:5432/postgres?sslmode=require`,
  });
  assert.equal(direct.target, "homologation");
  assert.equal(new URL(direct.connectionString).search, "");

  const pooler = assertTarget({
    ...dispatchEnv,
    CATALOG_IMPORT_DATABASE_URL: `postgres://hp_catalog_import_login.${projectRef}:test@aws-0-ca-central-1.pooler.supabase.com:5432/postgres?sslmode=require`,
  });
  assert.equal(pooler.target, "homologation");
  assert.throws(
    () =>
      assertTarget({
        ...dispatchEnv,
        GITHUB_EVENT_NAME: "pull_request",
        CATALOG_IMPORT_DATABASE_URL: direct.connectionString,
      }),
    /homologação exige workflow_dispatch/,
  );
});
