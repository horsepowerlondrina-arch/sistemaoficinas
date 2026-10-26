import test from "node:test";
import assert from "node:assert/strict";
import { adminClient } from "../scripts/local-admin";

test("CAT-008 import role is limited to catalog data and refuses unknown fixtures", async () => {
  const client = adminClient();
  await client.connect();
  try {
    const role = await client.query(
      `SELECT rolsuper,rolbypassrls,rolcanlogin FROM pg_roles WHERE rolname='hp_catalog_importer'`,
    );
    assert.equal(role.rowCount, 1);
    assert.deepEqual(role.rows[0], {
      rolsuper: false,
      rolbypassrls: false,
      rolcanlogin: false,
    });
    const privileges = await client.query(`SELECT
      has_table_privilege('hp_catalog_importer','service_catalog.models','SELECT') can_read_catalog,
      has_table_privilege('hp_catalog_importer','service_catalog.models','INSERT') can_insert_catalog,
      has_table_privilege('hp_catalog_importer','horse_power.tenants','SELECT') can_read_workshops,
      has_schema_privilege('hp_catalog_importer','horse_power','USAGE') can_use_workshop_schema`);
    assert.deepEqual(privileges.rows[0], {
      can_read_catalog: true,
      can_insert_catalog: true,
      can_read_workshops: false,
      can_use_workshop_schema: false,
    });

    const before = Number(
      (await client.query("SELECT count(*) n FROM service_catalog.models"))
        .rows[0].n,
    );
    await client.query("BEGIN");
    await assert.rejects(
      client.query(
        "SELECT service_catalog.prepare_catalog_import_for_cat008()",
      ),
      /exact untouched synthetic fixture/,
    );
    await client.query("ROLLBACK");
    const after = Number(
      (await client.query("SELECT count(*) n FROM service_catalog.models"))
        .rows[0].n,
    );
    assert.equal(
      after,
      before,
      "a refused preflight must preserve all catalog rows",
    );

    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE hp_catalog_importer");
    const portes = await client.query("SELECT count(*)::int n FROM service_catalog.classifications");
    assert.equal(portes.rows[0].n, 4);
    await client.query("ROLLBACK");
  } finally {
    await client.end();
  }
});

