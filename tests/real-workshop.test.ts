import test from "node:test";
import assert from "node:assert/strict";
import { createDatabase } from "../server/db/database";
import { generateExpenses, payExpense } from "../server/services/expenses";
import { createShare, readShare } from "../server/services/sharing";
import { calculatePlan } from "../server/domain/payments";
import { digest } from "../server/auth/session";
import { transitionOrder } from "../server/services/workshop";
const ctx = { userId: "u", tenantId: "a", role: "owner" };
function fixture() {
  const db = createDatabase(":memory:");
  db.prepare("INSERT INTO users VALUES(?,?,?,?)").run(
    "u",
    "Test",
    "test@example.com",
    "unused",
  );
  for (const t of ["a", "b"])
    db.prepare("INSERT INTO tenants(id,name) VALUES(?,?)").run(t, t);
  return db;
}
test("Recurring expenses: exact month, idempotence, missing values and finite installments", async () => {
  const db = fixture();
  db.exec(
    "INSERT INTO expense_templates(id,tenant_id,description,category,amount,due_day,remaining_months) VALUES('t','a','Ferramenta','Investimento',3673,31,2),('v','a','Peças','Variável',NULL,10,NULL),('other','b','Privado','Fixo',100,10,NULL)",
  );
  assert.equal((await generateExpenses(db, ctx, "2026-02")).created, 1);
  assert.equal((await generateExpenses(db, ctx, "2026-02")).created, 0);
  db.exec("UPDATE expense_templates SET due_day=15 WHERE id='t'");
  assert.equal((await generateExpenses(db, ctx, "2026-02")).created, 0);
  assert.equal(
    db.prepare("SELECT due_on FROM payables").get()!.due_on,
    "2026-02-28",
  );
  assert.equal((await generateExpenses(db, ctx, "2026-03")).created, 1);
  assert.equal((await generateExpenses(db, ctx, "2026-04")).created, 0);
  const p = db.prepare("SELECT * FROM payables ORDER BY due_on").get()!;
  await payExpense(db, ctx, String(p.id), "2026-02-27", "Pix");
  await assert.rejects(
    async () => await payExpense(db, ctx, String(p.id), "2026-02-27", "Pix"),
  );
  await assert.rejects(
    async () =>
      await payExpense(
        db,
        { ...ctx, tenantId: "b" },
        String(p.id),
        "2026-02-27",
        "Pix",
      ),
  );
  assert.equal(
    db.prepare("SELECT SUM(amount) n FROM payables WHERE status='paid'").get()!
      .n,
    3673,
  );
  db.close();
});
test("Public shares allow only selected data, expire, revoke and isolate tenants", async () => {
  const db = fixture();
  db.exec(
    "INSERT INTO orders(id,tenant_id,number,kind,status,guest_name,guest_plate,entered_on,due_on,km,notes,total) VALUES('o','a',1,'quote','quote','Cliente Nome Completo','ABC1D23','2026-09-20','2026-09-20',0,'INTERNAL SECRET',50000)",
  );
  const s = await createShare(db, ctx, "o");
  const token = s.path.split("/").pop()!;
  const out = (await readShare(db, token))!;
  assert.equal(out.total, 50000);
  assert.equal(out.customer, "Cliente Nome Completo");
  db.exec("INSERT INTO customers(id,tenant_id,name) VALUES('full-name','a','José da Silva Santos')");
  db.exec("UPDATE orders SET customer_id='full-name' WHERE id='o'");
  assert.equal((await readShare(db, token))!.customer, "Cliente Nome Completo");
  assert.ok(!JSON.stringify(out).includes("INTERNAL SECRET"));
  assert.equal((out as any).tenant_id, undefined);
  await assert.rejects(
    async () => await createShare(db, { ...ctx, tenantId: "b" }, "o"),
  );
  const s2 = await createShare(db, ctx, "o");
  assert.notEqual(s2.path, s.path);
  assert.equal(s2.reused, false);
  assert.ok(await readShare(db, token));
  const token2 = s2.path.split("/").pop()!;
  assert.equal((await readShare(db, token2))!.customer, "José da Silva Santos");
  assert.equal((await readShare(db, token))!.customer, "Cliente Nome Completo");

  await transitionOrder(db, ctx, "o", "cancelled");
  assert.equal(await readShare(db, token), null);
  assert.equal(await readShare(db, token2), null);
  const s3 = await createShare(db, ctx, "o");
  assert.notEqual(s3.path, s.path);
  assert.notEqual(s3.path, s2.path);
  assert.equal(s3.reused, false);
  const t2 = s3.path.split("/").pop()!;
  db.prepare("UPDATE public_shares SET expires_at=0 WHERE token_hash=?").run(
    digest(t2),
  );
  assert.equal(await readShare(db, t2), null);
  assert.equal(await readShare(db, "o"), null);
  db.close();
});
test("Inter fee pass-through preserves net and keeps extra interest separate", () => {
  for (const fee of [
    84, 353, 451, 527, 603, 679, 755, 873, 949, 1025, 1101, 1177, 1253,
  ]) {
    for (const base of [100, 19999, 100000, 19506563]) {
      const p = calculatePlan(base, {
        method: "Cartão de crédito",
        installments: 12,
        card_fee_bps: fee,
        interest_bps: 0,
        pass_card_fee: true,
        first_due_on: "2026-09-20",
      });
      assert.equal(p.net, base);
      assert.equal(p.interest, 0);
      assert.equal(p.surcharge, p.gross - base);
      assert.equal(
        p.installments.reduce((s, i) => s + i.net, 0),
        base,
      );
    }
  }
  const p = calculatePlan(100000, {
    method: "Cartão de crédito",
    installments: 3,
    card_fee_bps: 527,
    interest_bps: 1000,
    pass_card_fee: true,
    first_due_on: "2026-09-20",
  });
  assert.equal(p.net, 110000);
  assert.equal(p.interest, 10000);
  assert.equal(p.gross, p.base + p.interest + p.surcharge);
});

test("New endpoints require login, enforce role and isolate expenses; public pages work without session", async () => {
  const { createApp } = await import("../server/app");
  const { hashPassword } = await import("../server/auth/session");
  const { default: EventEmitter } = await import("node:events");
  const once = EventEmitter.once;
  const db = fixture();
  db.prepare("UPDATE users SET password_hash=? WHERE id=?").run(
    hashPassword("temporary-password"),
    "u",
  );
  db.exec(
    "INSERT INTO memberships VALUES('u','a','owner'); INSERT INTO orders(id,tenant_id,number,kind,status,entered_on,due_on,km) VALUES('o','a',1,'quote','quote','2026-09-20','2026-09-20',0)",
  );
  const server = createApp(db).listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as any).port}/api`;
  let cookie = "";
  const request = async (path: string, method = "GET", body?: any) =>
    fetch(base + path, {
      method,
      headers: { "Content-Type": "application/json", cookie },
      body: body ? JSON.stringify(body) : undefined,
    });
  try {
    assert.equal((await request("/expenses")).status, 401);
    const login = await request("/login", "POST", {
      email: "test@example.com",
      password: "temporary-password",
    });
    assert.equal(login.status, 200);
    cookie = login.headers.get("set-cookie")!.split(";")[0];
    let r = await request("/payables", "POST", {
      description: "Teste despesa",
      category: "Fixo",
      amount: 1000,
      due_on: "2026-09-20",
    });
    assert.equal(r.status, 200);
    const p = await r.json();
    assert.equal(
      (
        await request(`/payables/${p.id}/pay`, "POST", {
          paid_on: "2026-09-20",
          method: "Pix",
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await request(`/payables/${p.id}/pay`, "POST", {
          paid_on: "2026-09-20",
          method: "Pix",
        })
      ).status,
      400,
    );
    const share = await (await request("/orders/o/share", "POST", {})).json();
    const saved = cookie;
    cookie = "";
    r = await request("/public/" + share.path.split("/").pop());
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("cache-control"), "no-store");
    cookie = saved;
    db.exec("UPDATE memberships SET role='operator' WHERE user_id='u'");
    assert.equal((await request("/expenses")).status, 403);
    assert.equal((await request("/orders/o/share", "POST", {})).status, 403);
    assert.equal((await request("/payables", "POST", {})).status, 403);
  } finally {
    server.close();
    await once(server, "close");
    db.close();
  }
});
