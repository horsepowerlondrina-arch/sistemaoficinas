import test from "node:test";
import assert from "node:assert/strict";
import { createDatabase } from "../server/db/database";
import { digest } from "../server/auth/session";
import { calculateDiscountAmount } from "../server/domain/orders";
import {
  configurePlan,
  settleInstallment,
  updateReceivableDiscount,
} from "../server/services/payments";
import { createShare, readShare } from "../server/services/sharing";
import { issueDocument, readDocument } from "../server/services/documents";
import { createApp } from "../server/app";

const ctx = { tenantId: "a", userId: "u", role: "owner" };
const terms = {
  method: "Pix",
  installments: 1,
  card_fee_bps: 0,
  interest_bps: 0,
  first_due_on: "2026-10-27",
};
function fixture() {
  const db = createDatabase(":memory:");
  db.exec(`
    INSERT INTO tenants(id,name) VALUES('a','Oficina A'),('b','Oficina B');
    INSERT INTO users VALUES('u','Admin','admin@test.invalid','disabled');
    INSERT INTO memberships VALUES('u','a','owner');
    INSERT INTO customers(id,tenant_id,name) VALUES('c','a','Cliente');
    INSERT INTO vehicles(id,tenant_id,customer_id,plate,brand,model,year) VALUES('v','a','c','ABC1D23','Fiat','Uno',2020);
    INSERT INTO catalog(id,tenant_id,kind,name,sku,category,cost,price,stock,minimum_stock) VALUES('part','a','product','Peça','P-1','',0,70000,5,0);
    INSERT INTO orders(id,tenant_id,number,status,customer_id,vehicle_id,entered_on,due_on,km,discount,total) VALUES('o','a',1,'completed','c','v','2026-10-27','2026-10-27',0,0,70000);
    INSERT INTO order_items(id,tenant_id,order_id,catalog_id,kind,name,quantity,price,cost) VALUES('oi','a','o','part','product','Peça',1,70000,0);
    INSERT INTO receivables(id,tenant_id,order_id,customer_id,description,amount,due_on) VALUES('r','a','o','c','OS #1',70000,'2026-10-27');
    INSERT INTO cash_accounts(id,tenant_id,name,kind,opening_balance,opening_on) VALUES('cash','a','Dinheiro','cash',0,'2026-10-01');
  `);
  return db;
}

test("fixed and percentage discounts use exact cents and enforce limits", () => {
  assert.equal(calculateDiscountAmount(70000, "money", 1234), 1234);
  assert.equal(calculateDiscountAmount(70000, "percent", 1250), 8750);
  assert.equal(calculateDiscountAmount(10001, "percent", 1250), 1250);
  assert.equal(calculateDiscountAmount(70000, "percent", 10000), 70000);
  assert.throws(() => calculateDiscountAmount(70000, "money", 70001), /superar/);
  assert.throws(() => calculateDiscountAmount(70000, "percent", 10001), /100%/);
});

test("discount updates the OS, receivable, current document and unpaid plan without changing issued history", async () => {
  const db = fixture();
  try {
    await configurePlan(db, ctx, "r", terms);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM payment_installments").get()!.n, 1);
    const oldShare = await createShare(db, ctx, "o");
    const oldToken = oldShare.path.slice(3);
    assert.equal(oldShare.document.total, 70000);

    const applied = await updateReceivableDiscount(db, ctx, "r", { mode: "percent", value: 1250 });
    assert.deepEqual(
      { changed: applied.changed, subtotal: applied.subtotal, discount: applied.discount, total: applied.total, reset: applied.payment_plan_reset },
      { changed: true, subtotal: 70000, discount: 8750, total: 61250, reset: true },
    );
    assert.equal(db.prepare("SELECT discount,total FROM orders WHERE tenant_id='a' AND id='o'").get()!.discount, 8750);
    assert.equal(db.prepare("SELECT total FROM orders WHERE tenant_id='a' AND id='o'").get()!.total, 61250);
    assert.equal(db.prepare("SELECT amount,plan_configured FROM receivables WHERE tenant_id='a' AND id='r'").get()!.amount, 61250);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM payment_installments WHERE tenant_id='a' AND receivable_id='r'").get()!.n, 0);
    assert.equal(await readShare(db, oldToken), null);
    assert.equal((await readDocument(db, ctx, "order", "o", 1)).order.total, 70000);

    const current = await issueDocument(db, ctx, "order", "o", true, true);
    assert.equal(current.order.total, 61250);
    assert.equal((await readDocument(db, ctx, "order", "o", 1)).order.total, 70000);

    await configurePlan(db, ctx, "r", terms);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM payment_installments WHERE tenant_id='a' AND receivable_id='r'").get()!.n, 1);
    assert.equal(db.prepare("SELECT SUM(principal) total FROM payment_installments WHERE tenant_id='a' AND receivable_id='r'").get()!.total, 61250);

    const fixed = await updateReceivableDiscount(db, ctx, "r", { mode: "money", value: 1500 });
    assert.equal(fixed.discount, 1500);
    assert.equal(fixed.total, 68500);
    const auditCount = db.prepare("SELECT COUNT(*) n FROM audit_events WHERE action='payment.discount_updated'").get()!.n;
    const unchanged = await updateReceivableDiscount(db, ctx, "r", { mode: "money", value: 1500 });
    assert.equal(unchanged.changed, false);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM audit_events WHERE action='payment.discount_updated'").get()!.n, auditCount);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM payment_installments WHERE tenant_id='a' AND receivable_id='r'").get()!.n, 0);

    await configurePlan(db, ctx, "r", terms);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM payment_installments WHERE tenant_id='a' AND receivable_id='r'").get()!.n, 1);
    assert.equal(db.prepare("SELECT SUM(principal) total FROM payment_installments WHERE tenant_id='a' AND receivable_id='r'").get()!.total, 68500);
    await assert.rejects(
      updateReceivableDiscount(db, { ...ctx, tenantId: "b" }, "r", { mode: "money", value: 1000 }),
      /não encontrado nesta oficina/,
    );
    assert.equal(db.prepare("SELECT total FROM orders WHERE tenant_id='a' AND id='o'").get()!.total, 68500);
  } finally {
    db.close();
  }
});

test("discount cannot rewrite a confirmed installment or duplicate the cash entry", async () => {
  const db = fixture();
  try {
    await configurePlan(db, ctx, "r", terms);
    const part = db.prepare("SELECT id FROM payment_installments WHERE tenant_id='a' AND receivable_id='r'").get()!;
    await settleInstallment(db, ctx, String(part.id), "cash");
    await assert.rejects(
      updateReceivableDiscount(db, ctx, "r", { mode: "money", value: 1000 }),
      /após um recebimento confirmado/,
    );
    assert.equal(db.prepare("SELECT amount FROM receivables WHERE tenant_id='a' AND id='r'").get()!.amount, 70000);
    assert.equal(db.prepare("SELECT total FROM orders WHERE tenant_id='a' AND id='o'").get()!.total, 70000);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM cash_entries WHERE tenant_id='a' AND receivable_id='r'").get()!.n, 1);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM payment_installments WHERE tenant_id='a' AND receivable_id='r' AND status='paid'").get()!.n, 1);
    await assert.rejects(settleInstallment(db, ctx, String(part.id), "cash"), /já foi recebida/);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM cash_entries WHERE tenant_id='a' AND receivable_id='r'").get()!.n, 1);
  } finally {
    db.close();
  }
});

test("saving a payment plan persists its discount atomically before creating installments", async () => {
  const db = fixture();
  try {
    const plan = await configurePlan(db, ctx, "r", terms, {
      mode: "percent",
      value: 1250,
    });
    assert.equal(plan.base, 61250);
    assert.equal(db.prepare("SELECT discount,total FROM orders WHERE tenant_id='a' AND id='o'").get()!.discount, 8750);
    assert.equal(db.prepare("SELECT amount,plan_configured FROM receivables WHERE tenant_id='a' AND id='r'").get()!.amount, 61250);
    assert.equal(db.prepare("SELECT SUM(principal) total FROM payment_installments WHERE tenant_id='a' AND receivable_id='r'").get()!.total, 61250);

    await assert.rejects(
      configurePlan(db, ctx, "r", { ...terms, method: "Forma inválida" }, {
        mode: "money",
        value: 1000,
      }),
      /Forma de pagamento inválida/,
    );
    assert.equal(db.prepare("SELECT discount,total FROM orders WHERE tenant_id='a' AND id='o'").get()!.discount, 8750);
    assert.equal(db.prepare("SELECT amount,plan_configured FROM receivables WHERE tenant_id='a' AND id='r'").get()!.amount, 61250);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM payment_installments WHERE tenant_id='a' AND receivable_id='r'").get()!.n, 1);
  } finally {
    db.close();
  }
});

test("receipt API previews the discounted amount without writing and persists it with tenant scope", async () => {
  const db = fixture();
  db.prepare("INSERT INTO sessions VALUES(?,?,?,?)").run(digest("owner"), "u", "a", Date.now() + 60000);
  const server = createApp(db).listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as any).port}/api/receivables/r`;
  const post = (path: string, body: unknown) =>
    fetch(base + path, {
      method: "POST",
      headers: { Cookie: "hp_session=owner", "Content-Type": "application/json", Origin: "http://127.0.0.1:5173" },
      body: JSON.stringify(body),
    });
  try {
    const preview = await post("/preview", { ...terms, discount: { mode: "percent", value: 1250 } });
    assert.equal(preview.status, 200);
    assert.equal((await preview.json()).base, 61250);
    assert.equal(db.prepare("SELECT amount FROM receivables WHERE id='r'").get()!.amount, 70000);
    const savedPlan = await post("/plan", {
      ...terms,
      discount: { mode: "percent", value: 1250 },
    });
    assert.equal(savedPlan.status, 200);
    assert.equal((await savedPlan.json()).base, 61250);
    assert.equal(db.prepare("SELECT discount FROM orders WHERE id='o'").get()!.discount, 8750);
    assert.equal(db.prepare("SELECT amount FROM receivables WHERE id='r'").get()!.amount, 61250);
    assert.equal(db.prepare("SELECT SUM(principal) total FROM payment_installments WHERE tenant_id='a' AND receivable_id='r'").get()!.total, 61250);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.close();
  }
});
