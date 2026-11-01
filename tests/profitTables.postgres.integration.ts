import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createLocalDatabase } from "../server/db/local";
import { adminClient } from "../scripts/local-admin";
import {
  getPartsPricing,
  savePartsPricing,
} from "../server/services/partsPricing";
import { catalogSalePrice } from "../shared/pricing";
test("OPS-003 PostgreSQL 17: faixas persistidas, isolamento por oficina e rollback sem alterar históricos", async () => {
  const credentials = JSON.parse(
    readFileSync(
      process.env.LOCAL_TEST_CREDENTIALS_FILE || "data/local-credentials.json",
      "utf8",
    ),
  );
  const a = credentials.find((c: any) => c.tenant === "local-a");
  const admin = adminClient();
  await admin.connect();
  const user = (
    await admin.query("SELECT id FROM horse_power.users WHERE email=$1", [
      a.email,
    ])
  ).rows[0].id;
  const before = (
    await admin.query(
      "SELECT parts_pricing_rules FROM horse_power.tenants WHERE id='local-a'",
    )
  ).rows[0];
  await admin.end();
  const db = await createLocalDatabase();
  try {
    await db.withRequestContext!(
      { "app.tenant_id": "local-a", "app.user_id": user },
      async () => {
        const otherBefore = await getPartsPricing(db, "local-b");
        const history = await db
          .prepare(
            "SELECT id,price,cost FROM order_items WHERE tenant_id='local-a' ORDER BY id",
          )
          .all();
        const rules = [
          { from: 0, up_to: 10000, markup_bps: 2000, minimum_profit: 0 },
          { from: 10001, up_to: null, markup_bps: 4000, minimum_profit: 0 },
        ];
        const service_rules = [
          { from: 0, up_to: null, markup_bps: 7000, minimum_profit: 0 },
        ];
        await savePartsPricing(
          db,
          { tenantId: "local-a", userId: user, role: "owner" },
          { mode: "legacy", rules, service_rules },
        );
        const saved = await getPartsPricing(db, "local-a");
        assert.deepEqual(saved.rules, rules);
        assert.deepEqual(saved.service_rules, service_rules);
        assert.equal(catalogSalePrice("product", 10000, 0, saved), 12000);
        assert.equal(catalogSalePrice("service", 10000, 0, saved), 17000);
        assert.deepEqual(await getPartsPricing(db, "local-b"), otherBefore);
        assert.deepEqual(
          await db
            .prepare(
              "SELECT id,price,cost FROM order_items WHERE tenant_id='local-a' ORDER BY id",
            )
            .all(),
          history,
        );
        await assert.rejects(
          savePartsPricing(
            db,
            { tenantId: "local-a", userId: user, role: "operator" },
            { rules },
          ),
          /administrador/,
        );
      },
      () => false,
    );
  } finally {
    await db.close();
  }
  const verify = adminClient();
  await verify.connect();
  try {
    assert.deepEqual(
      (
        await verify.query(
          "SELECT parts_pricing_rules FROM horse_power.tenants WHERE id='local-a'",
        )
      ).rows[0],
      before,
    );
  } finally {
    await verify.end();
  }
});
