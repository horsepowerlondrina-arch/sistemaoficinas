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

const directEnv = {
  CATALOG_IMPORT_TARGET: "homologation-direct",
  CATALOG_IMPORT_CONFIRM: "CAT-008-HOMOLOGATION-DIRECT-IMPORT",
  CATALOG_RIGHTS_CONFIRMED: "true",
  CATALOG_HOMOLOGATION_DIRECT_AUTHORIZED: "true",
};

test("CAT-008 direct mode accepts restricted logins on the authorized HMG endpoints", () => {
  const direct = assertTarget({
    ...directEnv,
    CATALOG_IMPORT_DATABASE_URL: `postgres://hp_catalog_import_login:test@db.${projectRef}.supabase.co:5432/postgres?sslmode=require`,
  });
  assert.equal(direct.target, "homologation");
  assert.equal(new URL(direct.connectionString).search, "");

  const pooler = assertTarget({
    ...directEnv,
    CATALOG_IMPORT_DATABASE_URL: `postgres://hp_catalog_import_login.${projectRef}:test@aws-0-ca-central-1.pooler.supabase.com:5432/postgres?sslmode=require`,
  });
  assert.equal(pooler.target, "homologation");
});

test("CAT-008 direct mode rejects missing authorization or processing rights", () => {
  const connection = `postgres://hp_catalog_import_login:test@db.${projectRef}.supabase.co:5432/postgres?sslmode=require`;
  assert.throws(
    () =>
      assertTarget({
        ...directEnv,
        CATALOG_HOMOLOGATION_DIRECT_AUTHORIZED: "false",
        CATALOG_IMPORT_DATABASE_URL: connection,
      }),
    /execução direta exige autorização explícita/,
  );
  assert.throws(
    () =>
      assertTarget({
        ...directEnv,
        CATALOG_RIGHTS_CONFIRMED: "false",
        CATALOG_IMPORT_DATABASE_URL: connection,
      }),
    /execução direta exige autorização explícita/,
  );
});

test("CAT-008 direct mode rejects production hosts and elevated logins", () => {
  assert.throws(
    () =>
      assertTarget({
        ...directEnv,
        CATALOG_IMPORT_DATABASE_URL:
          "postgres://hp_catalog_import_login:test@db.production.supabase.co:5432/postgres?sslmode=require",
      }),
    /execução direta exige autorização explícita/,
  );
  assert.throws(
    () =>
      assertTarget({
        ...directEnv,
        CATALOG_IMPORT_DATABASE_URL: `postgres://postgres:test@db.${projectRef}.supabase.co:5432/postgres?sslmode=require`,
      }),
    /execução direta exige autorização explícita/,
  );
});


const definitiveRef = "rvlovjpquozbrsszsxwe";
const definitiveEnv = {
  CATALOG_IMPORT_TARGET: "horse-power-definitive",
  CATALOG_IMPORT_CONFIRM: "HP-DEFINITIVE-CATALOG-IMPORT",
  CATALOG_RIGHTS_CONFIRMED: "true",
  GITHUB_ACTIONS: "true",
  GITHUB_EVENT_NAME: "workflow_dispatch",
};

test("CAT-008 definitive guard accepts only the new Horse Power project and manual dispatch", () => {
  const direct = assertTarget({
    ...definitiveEnv,
    CATALOG_IMPORT_DATABASE_URL:
      `postgres://hp_catalog_import_login:test@db.${definitiveRef}.supabase.co:5432/postgres?sslmode=require`,
  });
  assert.equal(direct.target, "definitive");
  assert.equal(new URL(direct.connectionString).search, "");
  const pooler = assertTarget({
    ...definitiveEnv,
    CATALOG_IMPORT_DATABASE_URL:
      `postgres://hp_catalog_import_login.${definitiveRef}:test@aws-0-ca-central-1.pooler.supabase.com:5432/postgres?sslmode=require`,
  });
  assert.equal(pooler.target, "definitive");
  for (const connection of [
    `postgres://hp_catalog_import_login:test@db.${projectRef}.supabase.co:5432/postgres?sslmode=require`,
    "postgres://hp_catalog_import_login:test@db.cbdwgocofigrdigfgwkp.supabase.co:5432/postgres?sslmode=require",
    `postgres://postgres:test@db.${definitiveRef}.supabase.co:5432/postgres?sslmode=require`,
  ]) {
    assert.throws(
      () => assertTarget({ ...definitiveEnv, CATALOG_IMPORT_DATABASE_URL: connection }),
      /Horse Power definitivo exige workflow_dispatch/,
    );
  }
  assert.throws(
    () => assertTarget({
      ...definitiveEnv,
      GITHUB_EVENT_NAME: "pull_request",
      CATALOG_IMPORT_DATABASE_URL: direct.connectionString,
    }),
    /Horse Power definitivo exige workflow_dispatch/,
  );
  assert.throws(
    () => assertTarget({
      ...definitiveEnv,
      CATALOG_IMPORT_CONFIRM: "CAT-008-HOMOLOGATION-IMPORT",
      CATALOG_IMPORT_DATABASE_URL: direct.connectionString,
    }),
    /Horse Power definitivo exige workflow_dispatch/,
  );
});
