import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDatabase } from "../server/db/database";
import { createApp } from "../server/app";
import { digest } from "../server/auth/session";
import { cashToday } from "../server/services/cashControl";
import { cashReport } from "../src/lib/cashReports";
import { cashWorkbook } from "../src/lib/cashWorkbook";
import { postgresSql } from "../server/db/postgres";
function fixture() {
  const db = createDatabase(":memory:");
  db.exec(
    "INSERT INTO tenants(id,name) VALUES('a','A'),('b','B'); INSERT INTO users VALUES('u','Admin','admin@example.com','disabled'),('m','Mecânico','m@example.com','disabled'); INSERT INTO memberships VALUES('u','a','owner'),('m','a','operator'); INSERT INTO customers(id,tenant_id,name) VALUES('c','a','Cliente'); INSERT INTO vehicles(id,tenant_id,customer_id,plate,brand,model,year) VALUES('v','a','c','ABC1D23','Fiat','Uno',2020); INSERT INTO orders(id,tenant_id,number,kind,status,customer_id,vehicle_id,entered_on,due_on,km,total) VALUES('o','a',1,'order','completed','c','v','2026-02-01','2026-02-01',0,10000); INSERT INTO receivables(id,tenant_id,order_id,customer_id,amount,due_on,description) VALUES('r','a','o','c',10000,'2026-02-01','OS teste')",
  );
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
  db.exec("INSERT INTO card_machines(id,tenant_id,name,name_key,operator,is_default,max_installments) VALUES('fixture-card','a','Máquina fictícia','máquina fictícia','Operadora fictícia',1,12);INSERT INTO card_machine_rates VALUES('a','fixture-card','Cartão de crédito',1,300);");
  return db;
}
test("recorrentes podem ser criados editados e excluídos sem apagar contas já geradas", async () => {
  const db = fixture(),
    server = createApp(db).listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const base = "http://127.0.0.1:" + (server.address() as any).port + "/api";
  const call = (path: string, body: any, method = "POST", token = "owner") =>
    fetch(base + path, {
      method,
      headers: {
        Cookie: "hp_session=" + token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  try {
    const v = {
      request_id: randomUUID(),
      description: "Aluguel",
      category: "Fixo",
      supplier: "Imobiliária",
      amount: 200000,
      due_day: 31,
      remaining_months: null,
      start_month: "2026-02",
      active: 1,
    };
    const created = await call("/expense-templates", v);
    assert.equal(created.status, 201);
    const { id } = await created.json();
    assert.equal((await call("/expense-templates", v)).status, 201);
    assert.equal(
      db
        .prepare("SELECT COUNT(*) n FROM expense_templates WHERE tenant_id='a'")
        .get()!.n,
      1,
    );
    assert.equal(
      (await call("/expenses/generate", { month: "2026-02" })).status,
      200,
    );
    let payable = db
      .prepare("SELECT * FROM payables WHERE template_id=?")
      .get(id)!;
    assert.equal(payable.due_on, "2026-02-28");
    assert.equal(payable.supplier, "Imobiliária");
    assert.equal(
      (
        await call(
          "/expense-templates/" + id,
          {
            ...v,
            description: "Aluguel reajustado",
            amount: 250000,
            due_day: 10,
          },
          "PUT",
        )
      ).status,
      200,
    );
    assert.equal(
      (await call("/expenses/generate", { month: "2026-02" })).status,
      200,
    );
    assert.equal(
      db.prepare("SELECT COUNT(*) n FROM payables WHERE template_id=?").get(id)!
        .n,
      1,
    );
    assert.equal(
      db.prepare("SELECT amount FROM payables WHERE id=?").get(payable.id)!
        .amount,
      200000,
    );
    await call("/expenses/generate", { month: "2026-03" });
    assert.equal(
      db.prepare("SELECT amount FROM payables WHERE due_on='2026-03-10'").get()!
        .amount,
      250000,
    );
    assert.equal(
      (await call("/expense-templates/" + id, {}, "DELETE")).status,
      200,
    );
    await call("/expenses/generate", { month: "2026-04" });
    assert.equal(
      db.prepare("SELECT COUNT(*) n FROM payables WHERE template_id=?").get(id)!
        .n,
      2,
    );
    const expenses = await (
      await fetch(base + "/expenses", {
        headers: { Cookie: "hp_session=owner" },
      })
    ).json();
    assert.equal(expenses.templates.length, 0);
    assert.equal(
      (await call("/expense-templates", v, "POST", "mechanic")).status,
      403,
    );
    db.prepare(
      "INSERT INTO expense_templates(id,tenant_id,description,category,amount,due_day) VALUES('foreign','b','Outro','Fixo',100,10)",
    ).run();
    assert.equal(
      (await call("/expense-templates/foreign", {}, "DELETE")).status,
      404,
    );
    assert.equal(
      db
        .prepare("SELECT active FROM expense_templates WHERE id='foreign'")
        .get()!.active,
      1,
    );
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    db.close();
  }
});
test("caixa registra pagamentos e recebimentos líquidos uma vez, protege contas e conserva saldo inicial", async () => {
  const db = fixture(),
    server = createApp(db).listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const base = "http://127.0.0.1:" + (server.address() as any).port + "/api";
  const call = (path: string, body?: any, method = "POST", token = "owner") =>
    fetch(base + path, {
      method,
      headers: {
        Cookie: "hp_session=" + token,
        "Content-Type": "application/json",
      },
      ...(method === "GET" ? {} : { body: JSON.stringify(body || {}) }),
    });
  try {
    const bankData = {
      request_id: randomUUID(),
      name: "Banco",
      kind: "bank",
      opening_balance: 100000,
      opening_on: "2026-02-01",
      active: 1,
    };
    const bank = await (await call("/cash-accounts", bankData)).json();
    assert.equal((await call("/cash-accounts", bankData)).status, 201);
    assert.equal(
      db
        .prepare("SELECT COUNT(*) n FROM cash_accounts WHERE tenant_id='a'")
        .get()!.n,
      1,
    );
    const cash = await (
      await call("/cash-accounts", {
        ...bankData,
        request_id: randomUUID(),
        name: "Dinheiro",
        kind: "cash",
        opening_balance: 5000,
      })
    ).json();
    db.prepare(
      "INSERT INTO cash_accounts(id,tenant_id,name,kind,opening_balance,opening_on) VALUES('foreign','b','Privada','bank',500,'2026-02-01')",
    ).run();
    db.prepare(
      "INSERT INTO payables(id,tenant_id,description,category,amount,due_on) VALUES('p','a','Conta','Fixo',1000,'2026-02-28')",
    ).run();
    assert.equal(
      (await call("/payables/p/pay", { paid_on: "2026-02-28", method: "Pix" }))
        .status,
      400,
    );
    assert.equal(
      db.prepare("SELECT status FROM payables WHERE id='p'").get()!.status,
      "open",
    );
    assert.equal(
      (
        await call("/payables/p/pay", {
          paid_on: "2026-02-28",
          method: "Pix",
          account_id: "foreign",
        })
      ).status,
      404,
    );
    assert.equal(
      (
        await call("/payables/p/pay", {
          paid_on: "2026-02-28",
          method: "Pix",
          account_id: bank.id,
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await call("/payables/p/pay", {
          paid_on: "2026-02-28",
          method: "Pix",
          account_id: bank.id,
        })
      ).status,
      400,
    );
    await call("/receivables/r/plan", {
      method: "Cartão de crédito",
      installments: 1,
      card_fee_bps: 300,
      interest_bps: 0,
      first_due_on: cashToday(),
      pass_card_fee: false,
    });
    const part = db
      .prepare("SELECT * FROM payment_installments WHERE receivable_id='r'")
      .get()!;
    assert.equal(
      (await call("/installments/" + part.id + "/settle")).status,
      400,
    );
    assert.equal(db.prepare("SELECT COUNT(*) n FROM cash_entries").get()!.n, 0);
    assert.equal(
      (
        await call("/installments/" + part.id + "/settle", {
          account_id: bank.id,
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await call("/installments/" + part.id + "/settle", {
          account_id: bank.id,
        })
      ).status,
      400,
    );
    let data = await (await call("/cash-control", undefined, "GET")).json();
    assert.equal(
      data.accounts.find((a: any) => a.id === bank.id).balance,
      99000,
    );
    assert.equal(
      data.accounts.find((a: any) => a.id === cash.id).balance,
      5000,
    );
    assert.equal(data.accounts.find((a: any) => a.id === bank.id).pending_receipts, 9700);
    assert.equal(data.movements.length, 2);
    assert.equal(
      data.movements.find((m: any) => m.origin === "receipt").amount,
      9700,
    );
    assert.equal(
      data.movements.find((m: any) => m.origin === "receipt").fee_amount,
      300,
    );
    assert.equal(
      (
        await call(
          "/cash-accounts/" + bank.id,
          { ...bankData, opening_balance: 0 },
          "PUT",
        )
      ).status,
      400,
    );
    const adjustment = {
      account_id: bank.id,
      target_balance: 90000,
      reason: "Conferência do banco",
      request_id: randomUUID(),
    };
    assert.equal((await call("/cash-adjustments", adjustment)).status, 200);
    assert.equal((await call("/cash-adjustments", adjustment)).status, 200);
    data = await (await call("/cash-control", undefined, "GET")).json();
    assert.equal(
      data.accounts.find((a: any) => a.id === bank.id).balance,
      90000,
    );
    assert.equal(data.movements.length, 3);
    assert.equal(
      (await call("/cash-control", undefined, "GET", "mechanic")).status,
      403,
    );
    assert.equal(
      data.accounts.some((a: any) => a.id === "foreign"),
      false,
    );
    const report = cashReport(data.accounts, data.movements, {
      from: "2026-02-02",
      to: cashToday(),
      account_id: bank.id,
    });
    assert.equal(report.initial, 100000);
    assert.equal(report.entries, 0);
    assert.equal(report.exits, 10000);
    assert.equal(report.closing, 90000);
    assert.equal(
      postgresSql("SELECT * FROM cash_movements WHERE tenant_id=?"),
      "SELECT * FROM horse_power.cash_movements WHERE tenant_id=$1",
    );
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    db.close();
  }
});
test("relatório usa datas inclusivas e distingue implantação de saldo e entrada operacional", () => {
  const a = {
    id: "a",
    name: "=Conta",
    kind: "bank" as const,
    opening_balance: 10000,
    opening_on: "2026-02-10",
    active: 1,
    balance: 11500,
  };
  const rows = [
    {
      id: "r",
      account_id: "a",
      day: "2026-02-15",
      amount: 2000,
      gross_amount: 2100,
      fee_amount: 100,
      description: "Recebimento",
      method: "Cartão",
      origin: "receipt",
    },
    {
      id: "p",
      account_id: "a",
      day: "2026-02-20",
      amount: -500,
      gross_amount: 0,
      fee_amount: 0,
      description: "Despesa",
      method: "Pix",
      origin: "expense",
    },
  ];
  const all = cashReport([a], rows, {
    from: "2026-02-01",
    to: "2026-02-20",
    account_id: "",
  });
  assert.equal(all.initial, 0);
  assert.equal(all.openings, 10000);
  assert.equal(all.entries, 2000);
  assert.equal(all.exits, 500);
  assert.equal(all.closing, 11500);
  const cut = cashReport([a], rows, {
    from: "2026-02-20",
    to: "2026-02-20",
    account_id: "a",
  });
  assert.equal(cut.initial, 12000);
  assert.equal(cut.rows.length, 1);
  assert.equal(cut.closing, 11500);
  const before = cashReport([a], rows, {
    from: "2026-02-01",
    to: "2026-02-09",
    account_id: "",
  });
  assert.equal(before.closing, 0);
  assert.throws(() =>
    cashReport([a], rows, {
      from: "2026-03-01",
      to: "2026-02-01",
      account_id: "",
    }),
  );
  const bytes = cashWorkbook(all, "Horse Power");
  assert.equal(new DataView(bytes.buffer).getUint32(0, true), 0x04034b50);
  assert.ok(new TextDecoder().decode(bytes).includes('t="inlineStr"'));
});

