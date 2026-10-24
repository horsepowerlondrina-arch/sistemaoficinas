import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("synthetic homologation catalogs do not weaken full catalog validation or access rules", () => {
  const sql = readFileSync(
    new URL("../supabase/migrations/20261019220654_activate_readonly_service_catalog.sql", import.meta.url),
    "utf8",
  );

  assert.match(sql, /version='homologacao-sintetica'/);
  assert.match(sql, /source_sha256='synthetic'/);
  assert.match(sql, /model_total=synthetic_release\.model_count/);
  assert.match(sql, /time_total=synthetic_release\.time_count/);
  assert.match(sql, /application_total=synthetic_release\.application_count/);
  assert.match(sql, /model_total\s*<>\s*7534/);
  assert.match(sql, /time_total\s*<>\s*836093/);
  assert.match(sql, /application_total\s*<>\s*7292579/);
  assert.match(sql, /CREATE POLICY entitled_catalog_read ON models/);
  assert.match(sql, /CREATE POLICY entitled_catalog_read ON repair_times/);
  assert.match(sql, /CREATE POLICY tenant_read ON tenant_access/);
});
