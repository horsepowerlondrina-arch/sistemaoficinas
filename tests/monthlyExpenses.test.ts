import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createDatabase } from "../server/db/database";
import { createApp } from "../server/app";
import { digest } from "../server/auth/session";
import {
  currentExpenseMonth,
  generateExpenses,
} from "../server/services/expenses";
import { expenseAppliesToMonth } from "../shared/expensePlanning";

test("planejamento: mês atual, valores ausentes, edição, pausa, parcelas e isolamento", async (t) => {
  const db = createDatabase(":memory:");
  db.exec(
    "INSERT INTO tenants(id,name) VALUES('a','Fictícia A'),('b','Fictícia B'); INSERT INTO users VALUES('u','Fictício','fixture@example.com','disabled'),('op','Operador','operator@example.com','disabled'); INSERT INTO memberships VALUES('u','a','owner'),('op','a','operator')",
  );
  for (const [token, user] of [
    ["owner", "u"],
    ["operator", "op"],
  ])
    db.prepare("INSERT INTO sessions VALUES(?,?,?,?)").run(
      digest(token),
      user,
      "a",
      Date.now() + 3600000,
    );
  const server = createApp(db).listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => {
    server.close();
    db.close();
  });
  const request = async (
    path: string,
    body?: unknown,
    method = "POST",
    token = "owner",
  ) =>
    fetch(`http://127.0.0.1:${(server.address() as any).port}/api${path}`, {
      method,
      headers: {
        Cookie: "hp_session=" + token,
        "Content-Type": "application/json",
      },
      ...(method === "GET" ? {} : { body: JSON.stringify(body ?? {}) }),
    });
  const month = currentExpenseMonth(),
    ctx = { userId: "u", tenantId: "a", role: "owner" };
  const config = {
    description: "Energia fictícia",
    supplier: "Fornecedor fictício",
    category: "Variável",
    amount: null,
    due_day: 1,
    start_month: month,
    remaining_months: null,
    active: 1,
    source: "Observação fictícia",
  };
  const response = await request("/expense-templates", config);
  assert.equal(response.status, 201);
  const { id } = await response.json();
  let p = db.prepare("SELECT * FROM payables WHERE template_id=?").get(id)!;
  assert.equal(p.amount, null);
  assert.equal(p.status, "open");
  assert.equal(p.due_on, month + "-01");
  assert.equal(p.notes, config.source);
  assert.equal(p.generation_month, month);
  assert.equal(
    (
      await request(`/payables/${p.id}/pay`, {
        paid_on: month + "-01",
        method: "Pix",
      })
    ).status,
    400,
  );
  assert.equal(db.prepare("SELECT count(*) n FROM cash_movements").get()!.n, 0);
  assert.equal(
    (
      await request(
        "/payables/" + p.id,
        {
          description: p.description,
          supplier: p.supplier,
          category: p.category,
          amount: 12345,
          due_on: "2098-02-02",
          notes: "Valor conferido",
        },
        "PUT",
      )
    ).status,
    200,
  );
  assert.equal((await generateExpenses(db, ctx, month)).created, 0); // Moving due date never changes the generated month.
  assert.equal(
    (
      await request(
        "/expense-templates/" + id,
        { ...config, amount: 34567, due_day: 31 },
        "PUT",
      )
    ).status,
    200,
  );
  p = db.prepare("SELECT * FROM payables WHERE id=?").get(p.id)!;
  assert.equal(p.amount, 12345);
  assert.equal(p.due_on, "2098-02-02");
  assert.equal(
    (
      await request("/payables/" + p.id + "/pay", {
        paid_on: month + "-01",
        method: "Pix",
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await request("/payables/" + p.id + "/pay", {
        paid_on: month + "-01",
        method: "Pix",
      })
    ).status,
    400,
  );
  assert.equal(
    (await request("/expense-templates/" + id, { ...config, active: 0 }, "PUT"))
      .status,
    200,
  );
  assert.equal((await generateExpenses(db, ctx, "2099-02")).created, 0);
  assert.equal(
    db.prepare("SELECT status FROM payables WHERE id=?").get(p.id)!.status,
    "paid",
  );
  assert.equal(
    (await request("/expense-templates/" + id, {}, "DELETE")).status,
    200,
  );
  assert.equal((await generateExpenses(db, ctx, month)).created, 0);
  // An ad hoc account has the same fields but never creates a recurring configuration.
  assert.equal(
    (
      await request("/payables", {
        description: "Despesa avulsa",
        supplier: "Fornecedor",
        category: "Eventual",
        amount: null,
        due_on: month + "-01",
        notes: "A informar",
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await request("/payables", {
        description: "Inválida",
        supplier: "",
        category: "X",
        amount: 123.5,
        due_on: month + "-01",
        notes: "",
      })
    ).status,
    400,
  );
  assert.equal(
    (await request("/expense-templates", config, "POST", "operator")).status,
    403,
  );
  db.exec(
    "INSERT INTO expense_templates(id,tenant_id,description,category,amount,due_day) VALUES('foreign','b','Privado','Fixo',500,10)",
  );
  assert.equal(
    (await request("/expense-templates/foreign", { ...config }, "PUT")).status,
    404,
  );
  assert.equal((await generateExpenses(db, ctx, month)).created, 0);
  assert.equal(
    db.prepare("SELECT count(*) n FROM payables WHERE tenant_id='b'").get()!.n,
    0,
  );
  assert.throws(() =>
    db
      .prepare("UPDATE payables SET generation_month=? WHERE id=?")
      .run("2000-01", p.id),
  );
});

test("vencimentos no fim do mês, centavos e parcelas finitas, sem duplicar canceladas", async () => {
  const db = createDatabase(":memory:");
  try {
    db.exec(
      "INSERT INTO users VALUES('u','Fictício','fixture@example.com','disabled');INSERT INTO tenants(id,name) VALUES('a','Fictícia');INSERT INTO expense_templates(id,tenant_id,description,category,amount,due_day,start_month,remaining_months) VALUES('x','a','Fictício','Fixo',10001,31,'2028-01',3)",
    );
    const ctx = { userId: "u", tenantId: "a", role: "owner" };
    for (const month of ["2028-01", "2028-02", "2028-03"])
      assert.equal((await generateExpenses(db, ctx, month)).created, 1);
    assert.deepEqual(
      db
        .prepare("SELECT due_on FROM payables ORDER BY due_on")
        .all()
        .map((x) => x.due_on),
      ["2028-01-31", "2028-02-29", "2028-03-31"],
    );
    db.exec(
      "UPDATE payables SET status='cancelled' WHERE generation_month='2028-02'",
    );
    assert.equal((await generateExpenses(db, ctx, "2028-02")).created, 0);
    assert.equal((await generateExpenses(db, ctx, "2028-04")).created, 0);
    assert.equal(
      db.prepare("SELECT sum(amount) total FROM payables").get()!.total,
      30003,
    );
    assert.equal(
      expenseAppliesToMonth(
        { active: 1, start_month: "2028-01", remaining_months: 3 },
        "2028-04",
      ),
      false,
    );
    assert.equal(expenseAppliesToMonth({ active: 0 }, "2028-01"), false);
  } finally {
    db.close();
  }
});
