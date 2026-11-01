import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createLocalDatabase } from "../server/db/local";
import { adminClient } from "../scripts/local-admin";
import {
  saveCardMachine,
  listCardMachines,
} from "../server/services/cardMachines";
if (existsSync(".env.local")) process.loadEnvFile(".env.local");
test("OPS-002 PostgreSQL 17: additive legacy migration, precedence and unchanged historical payments", async () => {
  const admin = adminClient();
  await admin.connect();
  try {
    await admin.query("BEGIN");
    await admin.query(`CREATE SCHEMA ops002_migration_fixture; SET search_path=ops002_migration_fixture,pg_catalog;
 CREATE TABLE tenants(id text primary key); INSERT INTO tenants VALUES('a'),('b'),('empty');
 CREATE TABLE payment_settings(tenant_id text primary key,debit_fee_bps integer,credit_fee_bps integer); INSERT INTO payment_settings VALUES('a',150,250),('b',0,0);
 CREATE TABLE card_rates(tenant_id text,method text,installments integer,fee_bps integer); INSERT INTO card_rates VALUES('a','Cartão de crédito',1,300),('a','Cartão de crédito',3,450);
 CREATE TABLE payment_installments(id text primary key,tenant_id text,gross integer,fee integer,net integer); INSERT INTO payment_installments VALUES('old','a',10000,350,9650);`);
    const migration = readFileSync(
      "local-postgres/029-card-machines.sql",
      "utf8",
    ).replace(
      "SET search_path=horse_power,pg_catalog;",
      "SET search_path=ops002_migration_fixture,pg_catalog;",
    );
    await admin.query(migration);
    assert.equal(
      (await admin.query("SELECT count(*) n FROM card_machines")).rows[0].n,
      "2",
    );
    const rate = await admin.query(
      "SELECT fee_bps FROM card_machine_rates WHERE tenant_id='a' AND method='Cartão de crédito' AND installments=1",
    );
    assert.equal(rate.rows[0].fee_bps, 300);
    assert.equal(
      (
        await admin.query(
          "SELECT fee_bps FROM card_machine_rates WHERE tenant_id='b' AND method='Cartão de débito'",
        )
      ).rows[0].fee_bps,
      0,
    );
    assert.deepEqual(
      (
        await admin.query(
          "SELECT gross,fee,net,machine_id,card_fee_bps FROM payment_installments WHERE id='old'",
        )
      ).rows[0],
      {
        gross: 10000,
        fee: 350,
        net: 9650,
        machine_id: null,
        card_fee_bps: null,
      },
    );
    await admin.query("ROLLBACK");
  } catch (e) {
    await admin.query("ROLLBACK");
    throw e;
  } finally {
    await admin.end();
  }
});
test("OPS-002 PostgreSQL 17: RLS, composite tenant keys, unique default and authorization", async () => {
  const db = await createLocalDatabase();
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
  await admin.end();
  const ctx = { tenantId: "local-a", userId: user, role: "owner" };
  const body = {
    name: "OPS002 Fictícia",
    operator: "Operadora Fictícia",
    active: true,
    is_default: false,
    max_installments: 3,
    rates: [{ method: "Cartão de crédito", installments: 3, fee_bps: 350 }],
  };
  try {
    await db.withRequestContext!(
      { "app.tenant_id": "local-a", "app.user_id": user },
      async () => {
        const { id } = await saveCardMachine(db, ctx, body);
        assert.ok((await listCardMachines(db, ctx)).some((m) => m.id === id));
        assert.equal(
          (
            await db
              .prepare("SELECT * FROM card_machines WHERE tenant_id='local-b'")
              .all()
          ).length,
          0,
        );
        await assert.rejects(
          saveCardMachine(db, { ...ctx, role: "operator" }, body),
          /administrador/,
        );
        // A failed nested transaction rolls back to a savepoint and leaves the outer fixture valid.
        await assert.rejects(
          db.transaction(async () => {
            await db
              .prepare(
                "INSERT INTO card_machines(id,tenant_id,name,name_key,operator) VALUES('ops002-cross','local-b','X','x','X')",
              )
              .run();
          }),
          /row-level security/,
        );
        await assert.rejects(
          db.transaction(async () => {
            await db
              .prepare(
                "INSERT INTO card_machine_rates(tenant_id,machine_id,method,installments,fee_bps) VALUES('local-a','missing-other-tenant','Cartão de débito',1,0)",
              )
              .run();
          }),
          /foreign key/,
        );
        const second = await saveCardMachine(db, ctx, {
          ...body,
          name: "OPS002 Segunda",
          is_default: true,
        });
        await saveCardMachine(db, ctx, { ...body, is_default: true }, id);
        assert.equal(
          (await listCardMachines(db, ctx)).filter((m) => m.is_default).length,
          1,
        );
        assert.equal(
          (await listCardMachines(db, ctx)).find((m) => m.id === second.id)
            ?.is_default,
          0,
        );
      },
      () => false,
    );
  } finally {
    await db.close();
  }
});
