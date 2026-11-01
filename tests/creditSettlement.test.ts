import test from "node:test";
import assert from "node:assert/strict";
import { createDatabase } from "../server/db/database";
import {
  configurePlan,
  settleCredit,
  settleInstallment,
} from "../server/services/payments";
import { cashControl, adjustCash } from "../server/services/cashControl";
import { nextBankingDay } from "../shared/bankingDays";
import { cashReport } from "../src/lib/cashReports";
import { orderPayments } from "../src/lib/orderReports";
import { createApp } from "../server/app";
import { digest } from "../server/auth/session";
const ctx = { tenantId: "a", userId: "u", role: "owner" };
function fixture() {
  const db = createDatabase(":memory:");
  db.exec(
    "INSERT INTO tenants(id,name) VALUES('a','A'),('b','B'); INSERT INTO users VALUES('u','Admin','u@a.test','disabled'),('m','Mecânico','m@a.test','disabled'); INSERT INTO memberships VALUES('u','a','owner'),('m','a','operator'); INSERT INTO customers(id,tenant_id,name) VALUES('c','a','Cliente'); INSERT INTO vehicles(id,tenant_id,customer_id,plate,brand,model,year) VALUES('v','a','c','ABC1D23','Fiat','Uno',2020); INSERT INTO orders(id,tenant_id,number,kind,status,customer_id,vehicle_id,entered_on,due_on,km,total) VALUES('o','a',1,'order','completed','c','v','2026-10-09','2026-10-09',0,10001); INSERT INTO receivables(id,tenant_id,order_id,customer_id,description,amount,due_on) VALUES('r','a','o','c','OS #1',10001,'2026-10-09'); INSERT INTO cash_accounts(id,tenant_id,name,kind,opening_balance,opening_on) VALUES('bank','a','Banco','bank',10000,'2026-10-01'),('foreign','b','Outro','bank',0,'2026-10-01')",
  );
  db.exec("INSERT INTO card_machines(id,tenant_id,name,name_key,operator,is_default,max_installments) VALUES('fixture-card','a','Máquina fictícia','máquina fictícia','Operadora fictícia',1,12);INSERT INTO card_machine_rates VALUES('a','fixture-card','Cartão de crédito',3,500);");
  return db;
}
const plan = {
  method: "Cartão de crédito",
  installments: 3,
  card_fee_bps: 500,
  interest_bps: 0,
  first_due_on: "2026-10-09",
  sale_on: "2026-10-09",
};
test("banking day skips weekends, national holidays, Carnival, Good Friday, Corpus Christi and year boundaries", () => {
  assert.equal(nextBankingDay("2026-10-09"), "2026-10-13");
  assert.equal(nextBankingDay("2026-02-13"), "2026-02-18");
  assert.equal(nextBankingDay("2026-04-02"), "2026-04-06");
  assert.equal(nextBankingDay("2026-06-03"), "2026-06-05");
  assert.equal(nextBankingDay("2026-12-31"), "2027-01-04");
  assert.throws(() => nextBankingDay("2026-02-30"), /inválida/);
});
test("credit installments remain visible but one net settlement reaches balance only on the banking day", async (t) => {
  t.mock.timers.enable({
    apis: ["Date"],
    now: new Date("2026-10-09T15:00:00Z"),
  });
  const db = fixture();
  try {
    const p = await configurePlan(db, ctx, "r", plan);
    const before = db
      .prepare("SELECT * FROM payment_installments ORDER BY sequence")
      .all();
    assert.equal(before.length, 3);
    assert.deepEqual(
      before.map((v) => v.due_on),
      ["2026-10-09", "2026-11-09", "2026-12-09"],
    );
    assert.equal(
      db.prepare("SELECT due_on FROM receivables").get()!.due_on,
      "2026-10-13",
    );
    await settleInstallment(db, ctx, String(before[0].id), "bank");
    const parts = db
      .prepare("SELECT * FROM payment_installments ORDER BY sequence")
      .all();
    assert.ok(
      parts.every(
        (v) =>
          v.status === "paid" && String(v.paid_at).startsWith("2026-10-13"),
      ),
    );
    assert.deepEqual(
      parts.map((v) => v.gross),
      before.map((v) => v.gross),
    );
    const entries = db.prepare("SELECT * FROM cash_entries").all(),
      movements = db.prepare("SELECT * FROM cash_movements").all();
    assert.equal(entries.length, 1);
    assert.equal(entries[0].amount, p.net);
    assert.equal(entries[0].gross_amount, p.gross);
    assert.equal(entries[0].fee_amount, p.fee);
    assert.equal(movements.length, 1);
    assert.equal(movements[0].day, "2026-10-13");
    assert.equal(movements[0].amount, p.net);
    let control = await cashControl(db, ctx);
    assert.equal(control.accounts[0].balance, 10000);
    assert.equal(control.accounts[0].pending_receipts, p.net);
    assert.equal(control.legacy_count, 0);
    assert.equal(
      cashReport(control.accounts as any, control.movements as any, {
        from: "2026-10-01",
        to: "2026-10-31",
        account_id: "bank",
      }).entries,
      0,
    );
    assert.equal(
      orderPayments({ id: "o" } as any, {
        receivables: [{ id: "r", order_id: "o" }] as any,
        cash: entries as any,
        installments: parts as any,
      }).length,
      0,
    );
    await assert.rejects(settleCredit(db, ctx, "r", "bank"), /já foi recebido/);
    await adjustCash(db, ctx, {
      account_id: "bank",
      target_balance: 12000,
      reason: "Conferência",
      request_id: "adjust",
    });
    assert.equal(
      db
        .prepare("SELECT amount FROM cash_movements WHERE origin='adjustment'")
        .get()!.amount,
      2000,
    );
    t.mock.timers.setTime(new Date("2026-10-13T15:00:00Z").getTime());
    control = await cashControl(db, ctx);
    assert.equal(control.accounts[0].balance, 12000 + p.net);
    assert.equal(control.accounts[0].pending_receipts, 0);
    const report = cashReport(
      control.accounts as any,
      control.movements as any,
      { from: "2026-10-13", to: "2026-10-13", account_id: "bank" },
    );
    assert.equal(report.entries, p.net);
    assert.equal(report.initial, 12000);
  } finally {
    db.close();
    t.mock.timers.reset();
  }
});
test("previously received credit installments are preserved and only the remaining total is received", async (t) => {
  t.mock.timers.enable({
    apis: ["Date"],
    now: new Date("2026-10-09T15:00:00Z"),
  });
  const db = fixture();
  try {
    await configurePlan(db, ctx, "r", plan);
    const first = db
      .prepare("SELECT * FROM payment_installments WHERE sequence=1")
      .get()!;
    db.prepare(
      "UPDATE payment_installments SET status='paid',paid_at='2026-10-08T12:00:00-03:00' WHERE id=?",
    ).run(first.id);
    db.prepare(
      "INSERT INTO cash_entries(id,tenant_id,receivable_id,installment_id,amount,gross_amount,fee_amount,method,created_at) VALUES('old','a','r',?,?,?,?,?,'2026-10-08T12:00:00-03:00')",
    ).run(first.id, first.net, first.gross, first.fee, first.method);
    const remaining = db
      .prepare(
        "SELECT SUM(net) net,SUM(gross) gross,SUM(fee) fee FROM payment_installments WHERE status='open'",
      )
      .get()!;
    const receipt = await settleCredit(db, ctx, "r", "bank");
    assert.equal(receipt.net, remaining.net);
    assert.equal(db.prepare("SELECT count(*) n FROM cash_entries").get()!.n, 2);
    assert.equal(
      db
        .prepare("SELECT paid_at FROM payment_installments WHERE id=?")
        .get(first.id)!.paid_at,
      "2026-10-08T12:00:00-03:00",
    );
    assert.equal(
      db.prepare("SELECT SUM(amount) n FROM cash_entries").get()!.n,
      Number(first.net) + Number(remaining.net),
    );
  } finally {
    db.close();
    t.mock.timers.reset();
  }
});
test("boleto keeps individual receipts and credit failures roll back without changing payments", async (t) => {
  t.mock.timers.enable({
    apis: ["Date"],
    now: new Date("2026-10-09T15:00:00Z"),
  });
  const db = fixture();
  try {
    await configurePlan(db, ctx, "r", plan);
    await assert.rejects(settleCredit(db, ctx, "r", "foreign"));
    await assert.rejects(
      settleCredit(db, { ...ctx, role: "operator" }, "r", "bank"),
      /administrador/,
    );
    assert.equal(
      db
        .prepare(
          "SELECT count(*) n FROM payment_installments WHERE status='open'",
        )
        .get()!.n,
      3,
    );
    assert.equal(db.prepare("SELECT count(*) n FROM cash_entries").get()!.n, 0);
    await configurePlan(db, ctx, "r", {
      ...plan,
      method: "Boleto",
      card_fee_bps: 0,
    });
    const first = db
      .prepare("SELECT id FROM payment_installments ORDER BY sequence")
      .get()!;
    await settleInstallment(db, ctx, String(first.id), "bank");
    assert.equal(
      db
        .prepare(
          "SELECT count(*) n FROM payment_installments WHERE status='open'",
        )
        .get()!.n,
      2,
    );
    assert.equal(
      db.prepare("SELECT day FROM cash_movements").get()!.day,
      "2026-10-09",
    );
  } finally {
    db.close();
    t.mock.timers.reset();
  }
});
test("credit receipt API enforces role and rejects duplicate confirmations", async (t) => {
  t.mock.timers.enable({
    apis: ["Date"],
    now: new Date("2026-10-09T15:00:00Z"),
  });
  const db = fixture();
  for (const [token, user] of [
    ["owner", "u"],
    ["mechanic", "m"],
  ])
    db.prepare("INSERT INTO sessions VALUES(?,?,?,?)").run(
      digest(token),
      user,
      "a",
      Date.now() + 3600000,
    );
  await configurePlan(db, ctx, "r", plan);
  const server = createApp(db).listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  try {
    const url =
      "http://127.0.0.1:" +
      (server.address() as any).port +
      "/api/receivables/r/settle-credit";
    const call = (token: string) =>
      fetch(url, {
        method: "POST",
        headers: {
          Cookie: "hp_session=" + token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ account_id: "bank" }),
      });
    assert.equal((await call("mechanic")).status, 403);
    const response = await call("owner");
    assert.equal(response.status, 200);
    assert.equal((await response.json()).settlement_on, "2026-10-13");
    assert.equal((await call("owner")).status, 400);
    assert.equal(
      db.prepare("SELECT count(*) n FROM cash_movements").get()!.n,
      1,
    );
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    db.close();
    t.mock.timers.reset();
  }
});

