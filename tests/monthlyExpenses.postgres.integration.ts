import test from "node:test";
import assert from "node:assert/strict";
import { adminClient } from "../scripts/local-admin";
import { createLocalDatabase } from "../server/db/local";
import { generateExpenses } from "../server/services/expenses";

test("PostgreSQL: rotina automática, mês imutável, RLS e conta sem valor", async () => {
  const admin = adminClient();
  await admin.connect();
  const db = await createLocalDatabase();
  try {
    await admin.query("BEGIN");
    const month = (
      await admin.query(
        "SELECT to_char(timezone('America/Sao_Paulo',statement_timestamp()),'YYYY-MM') m",
      )
    ).rows[0].m;
    await admin.query(
      "INSERT INTO horse_power.expense_templates(id,tenant_id,description,category,amount,due_day,start_month) VALUES('monthly-fixture','local-a','Gasto fictício','Variável',NULL,31,$1),('monthly-other','local-b','Outro gasto fictício','Fixo',10001,1,$1)",
      [month],
    );
    await admin.query(
      `INSERT INTO horse_power.expense_templates(id,tenant_id,description,category,amount,due_day,start_month,remaining_months,active,deleted_at) VALUES
      ('monthly-ended','local-a','Encerrado fictício','Fixo',100,1,to_char(to_date($1||'-01','YYYY-MM-DD')-interval '1 month','YYYY-MM'),1,1,NULL),
      ('monthly-future','local-a','Futuro fictício','Fixo',100,1,to_char(to_date($1||'-01','YYYY-MM-DD')+interval '1 month','YYYY-MM'),NULL,1,NULL),
      ('monthly-paused','local-a','Pausado fictício','Fixo',100,1,$1,NULL,0,NULL),
      ('monthly-removed','local-a','Excluído fictício','Fixo',100,1,$1,NULL,1,$1||'-01')`,
      [month],
    );
    await admin.query("SELECT horse_power.generate_current_expenses()");
    const a = await admin.query(
      "SELECT * FROM horse_power.payables WHERE template_id='monthly-fixture'",
    );
    assert.equal(a.rowCount, 1);
    assert.equal(a.rows[0].amount, null);
    assert.equal(a.rows[0].generation_month, month);
    assert.equal(a.rows[0].status, "open");
    const other = await admin.query(
      "SELECT * FROM horse_power.payables WHERE template_id='monthly-other'",
    );
    assert.equal(other.rowCount, 1);
    assert.equal(other.rows[0].tenant_id, "local-b");
    assert.equal(other.rows[0].amount, 10001);
    const [year, monthNumber] = month.split("-").map(Number);
    assert.equal(
      a.rows[0].due_on,
      month + "-" + new Date(year, monthNumber, 0).getDate(),
    );
    assert.equal(
      (
        await admin.query(
          "SELECT count(*)::int n FROM horse_power.payables WHERE template_id IN ('monthly-ended','monthly-future','monthly-paused','monthly-removed')",
        )
      ).rows[0].n,
      0,
    );

    await admin.query(
      "UPDATE horse_power.payables SET due_on='2098-01-01',status='cancelled' WHERE template_id='monthly-fixture'",
    );
    await admin.query("SELECT horse_power.generate_current_expenses()");
    assert.equal(
      (
        await admin.query(
          "SELECT count(*)::int n FROM horse_power.payables WHERE template_id='monthly-fixture'",
        )
      ).rows[0].n,
      1,
    );
    await admin.query(
      "UPDATE horse_power.expense_templates SET active=0,amount=12345 WHERE id='monthly-fixture'",
    );
    assert.equal(
      (
        await admin.query(
          "SELECT amount FROM horse_power.payables WHERE template_id='monthly-fixture'",
        )
      ).rows[0].amount,
      null,
    );
    await admin.query("SAVEPOINT unknown_payment");
    await assert.rejects(
      admin.query(
        "UPDATE horse_power.payables SET status='paid' WHERE template_id='monthly-fixture'",
      ),
    );
    await admin.query("ROLLBACK TO SAVEPOINT unknown_payment");
    await admin.query("SAVEPOINT immutable_month");
    await assert.rejects(
      admin.query(
        "UPDATE horse_power.payables SET generation_month='2000-01' WHERE template_id='monthly-fixture'",
      ),
    );
    await admin.query("ROLLBACK TO SAVEPOINT immutable_month");
    assert.equal(
      (
        await admin.query(
          "SELECT count(*)::int n FROM horse_power.audit_events WHERE action='expense.generated.automatic' AND entity_id=$1",
          [a.rows[0].id],
        )
      ).rows[0].n,
      1,
    );
    await admin.query("ROLLBACK");
    await db.withRequestContext!(
      { "app.tenant_id": "local-a", "app.user_id": "local-owner-a" },
      async () => {
        await assert.rejects(
          db.prepare("SELECT horse_power.generate_current_expenses()").get(),
        );
      },
      () => false,
    );
    await db.withRequestContext!(
      { "app.tenant_id": "local-a", "app.user_id": "local-owner-a" },
      async () => {
        await db
          .prepare(
            "INSERT INTO expense_templates(id,tenant_id,description,category,amount,due_day,start_month) VALUES('monthly-app-fixture','local-a','Fictício','Variável',NULL,10,'2099-02')",
          )
          .run();
        assert.equal(
          (
            await generateExpenses(
              db,
              { userId: "local-owner-a", tenantId: "local-a", role: "owner" },
              "2099-02",
            )
          ).created,
          1,
        );
        const rows = await db
          .prepare(
            "SELECT * FROM payables WHERE template_id='monthly-app-fixture'",
          )
          .all();
        assert.equal(rows.length, 1);
        assert.equal(rows[0].amount, null);
        assert.equal(
          (await db
            .prepare(
              "SELECT count(*)::int n FROM payables WHERE tenant_id='local-b'",
            )
            .get())!.n,
          0,
        );
      },
      () => false,
    );
  } finally {
    await admin.query("ROLLBACK").catch(() => {});
    await admin.end();
    await db.close();
  }
});
