import { nextBankingDay } from "../shared/bankingDays";
import { cashToday } from "../server/services/cashControl";
import { calculatePlan, addMonthsClamped } from "../server/domain/payments";
import { configurePlan, settleInstallment } from "../server/services/payments";
import { listOrders } from "../server/services/workshop";
import { lookupVehicle } from "../server/services/vehicleLookup";
import { filterOrders, revenueBreakdown } from "../src/lib/workflow";
import type { Order } from "../src/lib/types";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDatabase, type DB } from "../server/db/database";
import { hashPassword } from "../server/auth/session";
import {
  saveOrder,
  transitionOrder,
  settle,
} from "../server/services/workshop";
import { totalOf } from "../server/domain/orders";
import { createApp } from "../server/app";
const ctx = { userId: "user", tenantId: "a", role: "owner" };
function fixture(path = ":memory:") {
  const db = createDatabase(path);
  db.prepare("INSERT INTO users VALUES(?,?,?,?)").run(
    "user",
    "Teste",
    "test@example.com",
    hashPassword("password-test"),
  );
  for (const tenant of ["a", "b"]) {
    db.prepare("INSERT INTO tenants(id,name) VALUES(?,?)").run(
      tenant,
      `Oficina ${tenant}`,
    );
    db.prepare("INSERT INTO customers(id,tenant_id,name) VALUES(?,?,?)").run(
      `${tenant}-customer`,
      tenant,
      "Cliente Teste",
    );
    db.prepare(
      "INSERT INTO vehicles(id,tenant_id,customer_id,plate,brand,model,year) VALUES(?,?,?,?,?,?,?)",
    ).run(
      `${tenant}-vehicle`,
      tenant,
      `${tenant}-customer`,
      "ABC1D23",
      "Honda",
      "Civic",
      2022,
    );
    db.prepare(
      "INSERT INTO catalog(id,tenant_id,kind,name,sku,cost,price,stock,minimum_stock) VALUES(?,?,?,?,?,?,?,?,?)",
    ).run(
      `${tenant}-product`,
      tenant,
      "product",
      "Peça teste",
      "SKU-1",
      4000,
      10000,
      5,
      1,
    );
  }
  db.prepare("INSERT INTO memberships VALUES(?,?,?)").run("user", "a", "owner");
  db.exec("INSERT INTO card_machines(id,tenant_id,name,name_key,operator,is_default,max_installments) VALUES('fixture-card','a','Máquina fictícia','máquina fictícia','Operadora fictícia',1,12);INSERT INTO card_machine_rates VALUES('a','fixture-card','Cartão de crédito',2,0);INSERT INTO card_machine_rates VALUES('a','fixture-card','Cartão de crédito',3,350);");
  return db;
}
const input = (extra: Record<string, any> = {}) => ({
  customer_id: "a-customer",
  vehicle_id: "a-vehicle",
  status: "open",
  entered_on: "2026-09-19",
  due_on: "2026-09-20",
  km: 10000,
  problem: "Teste",
  notes: "",
  discount: 500,
  items: [{ catalog_id: "a-product", quantity: 2, price: 10000 }],
  ...extra,
});
async function ready(db: DB, record: string) {
  await transitionOrder(db, ctx, record, "working");
  await transitionOrder(db, ctx, record, "ready");
}
test("cálculo usa centavos e rejeita desconto maior que subtotal", () => {
  assert.equal(totalOf([{ price: 1999, quantity: 3 }], 100), 5897);
  assert.throws(() => totalOf([{ price: 100, quantity: 1 }], 101));
});
test("orçamento não baixa estoque; aprovação e conclusão geram efeitos únicos", async () => {
  const db = fixture();
  try {
    const record = await saveOrder(db, ctx, input({ status: "quote" }));
    assert.equal(
      db.prepare("SELECT stock FROM catalog WHERE id=?").get("a-product")!
        .stock,
      5,
    );
    assert.equal(db.prepare("SELECT COUNT(*) n FROM receivables").get()!.n, 0);
    await transitionOrder(db, ctx, record, "open");
    await ready(db, record);
    await transitionOrder(db, ctx, record, "completed");
    assert.equal(
      db.prepare("SELECT stock FROM catalog WHERE id=?").get("a-product")!
        .stock,
      3,
    );
    const r = db.prepare("SELECT * FROM receivables").get()!;
    assert.equal(r.amount, 19500);
    await assert.rejects(
      async () => await transitionOrder(db, ctx, record, "completed"),
    );
    await assert.rejects(
      async () => await saveOrder(db, ctx, input(), record),
      /não podem/,
    );
    assert.equal(db.prepare("SELECT COUNT(*) n FROM receivables").get()!.n, 1);
    assert.equal(
      db.prepare("SELECT COUNT(*) n FROM stock_movements").get()!.n,
      1,
    );
  } finally {
    db.close();
  }
});
test("estoque insuficiente gera aviso mas não bloqueia a finalização da OS", async () => {
  const db = fixture();
  try {
    const record = await saveOrder(
      db,
      ctx,
      input({
        items: [
          { catalog_id: "a-product", quantity: 3, price: 10000 },
          { catalog_id: "a-product", quantity: 3, price: 10000 },
        ],
      }),
    );
    await ready(db, record);
    const result = await transitionOrder(db, ctx, record, "completed");
    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings[0], /Estoque insuficiente/);
    assert.equal(
      db.prepare("SELECT stock FROM catalog WHERE id=?").get("a-product")!
        .stock,
      5,
    );
    assert.equal(
      db.prepare("SELECT status FROM orders WHERE id=?").get(record)!.status,
      "completed",
    );
    assert.equal(db.prepare("SELECT COUNT(*) n FROM receivables").get()!.n, 1);
    assert.equal(
      db.prepare("SELECT COUNT(*) n FROM stock_movements").get()!.n,
      0,
    );
  } finally {
    db.close();
  }
});
test("baixa integral gera caixa uma única vez e recusa segunda baixa", async () => {
  const db = fixture();
  try {
    const record = await saveOrder(db, ctx, input());
    await ready(db, record);
    await transitionOrder(db, ctx, record, "completed");
    const r = db.prepare("SELECT id FROM receivables").get()!;
    await settle(db, ctx, String(r.id), "Pix");
    await assert.rejects(
      async () => await settle(db, ctx, String(r.id), "Pix"),
      /já foi/,
    );
    assert.equal(
      db.prepare("SELECT SUM(amount) total FROM cash_entries").get()!.total,
      19500,
    );
    assert.equal(
      db.prepare("SELECT status FROM receivables").get()!.status,
      "paid",
    );
  } finally {
    db.close();
  }
});
test("vínculos de outra oficina e veículo de outro cliente são recusados", async () => {
  const db = fixture();
  try {
    await assert.rejects(
      async () =>
        await saveOrder(db, ctx, input({ customer_id: "b-customer" })),
      /não encontrado/,
    );
    await assert.rejects(
      async () =>
        await saveOrder(
          db,
          ctx,
          input({
            items: [{ catalog_id: "b-product", quantity: 1, price: 10000 }],
          }),
        ),
      /não encontrado/,
    );
    db.prepare("INSERT INTO customers(id,tenant_id,name) VALUES(?,?,?)").run(
      "other",
      "a",
      "Outro cliente",
    );
    await assert.rejects(
      async () => await saveOrder(db, ctx, input({ customer_id: "other" })),
      /não pertence/,
    );
    assert.equal(db.prepare("SELECT COUNT(*) n FROM orders").get()!.n, 0);
  } finally {
    db.close();
  }
});
test("administrador pode reabrir atendimento cancelado e editar novamente", async () => {
  const db = fixture();
  try {
    const record = await saveOrder(db, ctx, input());
    await transitionOrder(db, ctx, record, "cancelled");
    await assert.rejects(
      async () => await saveOrder(db, ctx, input(), record),
      /não podem/,
    );
    await transitionOrder(db, ctx, record, "open");
    await saveOrder(db, ctx, input({ notes: "Reaberta" }), record);
    const row = db
      .prepare("SELECT status,kind,notes FROM orders WHERE id=?")
      .get(record)!;
    assert.deepEqual(
      [row.status, row.kind, row.notes],
      ["open", "order", "Reaberta"],
    );
  } finally {
    db.close();
  }
});

test("OS finalizada pode voltar para execução ou orçamento desfazendo estoque e cobrança aberta", async () => {
  const db = fixture();
  try {
    const record = await saveOrder(db, ctx, input());
    await ready(db, record);
    await transitionOrder(db, ctx, record, "completed");
    const receivable = db
      .prepare("SELECT id FROM receivables WHERE order_id=?")
      .get(record)!;
    await configurePlan(db, ctx, String(receivable.id), {
      method: "Cartão de crédito",
      installments: 2,
      card_fee_bps: 0,
      interest_bps: 0,
      first_due_on: "2026-09-20",
    });
    await transitionOrder(db, ctx, record, "working");
    assert.equal(
      db.prepare("SELECT stock FROM catalog WHERE id=?").get("a-product")!
        .stock,
      5,
    );
    assert.equal(
      db
        .prepare("SELECT COUNT(*) n FROM stock_movements WHERE order_id=?")
        .get(record)!.n,
      0,
    );
    assert.equal(
      db
        .prepare("SELECT COUNT(*) n FROM receivables WHERE order_id=?")
        .get(record)!.n,
      0,
    );
    assert.equal(
      db.prepare("SELECT COUNT(*) n FROM payment_installments").get()!.n,
      0,
    );
    let row = db
      .prepare("SELECT status,kind,completed_on FROM orders WHERE id=?")
      .get(record)!;
    assert.deepEqual(
      [row.status, row.kind, row.completed_on],
      ["working", "order", null],
    );

    await transitionOrder(db, ctx, record, "quote");
    row = db.prepare("SELECT status,kind FROM orders WHERE id=?").get(record)!;
    assert.deepEqual([row.status, row.kind], ["quote", "quote"]);
  } finally {
    db.close();
  }
});

test("OS com recebimento confirmado não pode ser reaberta", async () => {
  const db = fixture();
  try {
    const record = await saveOrder(db, ctx, input());
    await ready(db, record);
    await transitionOrder(db, ctx, record, "completed");
    const receivable = db
      .prepare("SELECT id FROM receivables WHERE order_id=?")
      .get(record)!;
    await settle(db, ctx, String(receivable.id), "Pix");
    await assert.rejects(
      async () => await transitionOrder(db, ctx, record, "working"),
      /recebimento confirmado/,
    );
    assert.equal(
      db.prepare("SELECT status FROM orders WHERE id=?").get(record)!.status,
      "completed",
    );
    assert.equal(
      db.prepare("SELECT stock FROM catalog WHERE id=?").get("a-product")!
        .stock,
      3,
    );
  } finally {
    db.close();
  }
});
test("snapshot de preço não muda ao alterar o catálogo", async () => {
  const db = fixture();
  try {
    const record = await saveOrder(db, ctx, input());
    db.prepare("UPDATE catalog SET price=99999 WHERE id=?").run("a-product");
    assert.equal(
      db.prepare("SELECT total FROM orders WHERE id=?").get(record)!.total,
      19500,
    );
    assert.equal(
      db.prepare("SELECT price FROM order_items WHERE order_id=?").get(record)!
        .price,
      10000,
    );
  } finally {
    db.close();
  }
});
test("correção explícita de custo atualiza somente o atendimento escolhido e preserva preço e custos históricos", async () => {
  const db = fixture();
  try {
    const os = await saveOrder(db, ctx, input());
    const quote = await saveOrder(db, ctx, input({ status: "quote" }));
    const historical = await saveOrder(db, ctx, input());
    await ready(db, historical);
    await transitionOrder(db, ctx, historical, "completed");
    db.prepare("UPDATE catalog SET cost=6500,price=12000 WHERE id=?").run(
      "a-product",
    );
    const savedItems = (orderId: string) =>
      db.prepare("SELECT * FROM order_items WHERE order_id=?").all(orderId);
    // Ordinary saves continue to preserve the original cost despite a catalog change.
    await saveOrder(db, ctx, input({ items: savedItems(os) }), os);
    assert.equal(savedItems(os)[0].cost, 4000);
    for (const record of [os, quote]) {
      await saveOrder(
        db,
        ctx,
        input({
          items: savedItems(record).map((item) => ({
            ...item,
            cost_override: 6500,
          })),
        }),
        record,
      );
      assert.equal(savedItems(record)[0].cost, 6500);
      assert.equal(savedItems(record)[0].price, 10000);
      assert.equal(
        db.prepare("SELECT total FROM orders WHERE id=?").get(record)!.total,
        19500,
      );
    }
    assert.equal(savedItems(historical)[0].cost, 4000);
    // A corrected snapshot is preserved on subsequent ordinary saves, including a later catalog change.
    db.prepare("UPDATE catalog SET cost=8000 WHERE id=?").run("a-product");
    await saveOrder(db, ctx, input({ items: savedItems(os) }), os);
    assert.equal(savedItems(os)[0].cost, 6500);
    await saveOrder(
      db,
      ctx,
      input({
        items: savedItems(os).map((item) => ({ ...item, cost_override: 0 })),
      }),
      os,
    );
    assert.equal(savedItems(os)[0].cost, 0);
    await assert.rejects(
      saveOrder(
        db,
        ctx,
        input({
          items: savedItems(os).map((item) => ({ ...item, cost_override: -1 })),
        }),
        os,
      ),
      /custo válido/,
    );
    await assert.rejects(
      saveOrder(
        db,
        { ...ctx, role: "mechanic" },
        input({
          items: savedItems(os).map((item) => ({
            ...item,
            cost_override: 9999,
          })),
        }),
        os,
      ),
    );
    await assert.rejects(
      saveOrder(
        db,
        ctx,
        input({
          items: savedItems(historical).map((item) => ({
            ...item,
            cost_override: 9999,
          })),
        }),
        historical,
      ),
      /não podem ser editadas/,
    );
    await assert.rejects(
      saveOrder(
        db,
        { ...ctx, tenantId: "b" },
        input({
          items: savedItems(os).map((item) => ({
            ...item,
            cost_override: 9999,
          })),
        }),
        os,
      ),
    );
  } finally {
    db.close();
  }
});

test("dados persistem ao fechar e reabrir o banco", async () => {
  const dir = mkdtempSync(join(tmpdir(), "horse-power-test-"));
  const path = join(dir, "test.sqlite");
  try {
    const db = fixture(path);
    const record = await saveOrder(db, ctx, input());
    db.close();
    const reopened = createDatabase(path);
    try {
      assert.equal(
        reopened.prepare("SELECT total FROM orders WHERE id=?").get(record)!
          .total,
        19500,
      );
    } finally {
      reopened.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("API autentica, protege oficinas, valida entrada e revoga sessão", async () => {
  const db = fixture();
  const server = createApp(db).listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address() as { port: number };
  const base = `http://127.0.0.1:${address.port}/api`;
  let cookie = "";
  const request = async (
    path: string,
    method = "GET",
    body?: unknown,
    origin?: string,
  ) => {
    const res = await fetch(base + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(cookie ? { Cookie: cookie } : {}),
        ...(origin ? { Origin: origin } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return res;
  };
  try {
    assert.equal((await request("/workspace")).status, 401);
    const login = await request("/login", "POST", {
      email: "test@example.com",
      password: "password-test",
    });
    assert.equal(login.status, 200);
    cookie = login.headers.get("set-cookie")!.split(";")[0];
    assert.match(login.headers.get("set-cookie")!, /HttpOnly/);
    const workspace = await (await request("/workspace")).json();
    assert.deepEqual(
      workspace.customers.map((c: any) => c.id),
      ["a-customer"],
    );
    db.prepare(
      "UPDATE tenants SET catalog_mode='extension' WHERE id='a'",
    ).run();
    const porte = db.prepare('SELECT id FROM labor_portes LIMIT 1').get()!.id;
    db.prepare('INSERT INTO labor_rates VALUES(?,?,?)').run('a',porte,12000);
    db.prepare('INSERT INTO labor_commercial_rates(tenant_id,category_id,hourly_rate) VALUES(?,?,?)').run('a','compacto',12000);
    const manualCatalog = await request("/workshop-services", "POST", {
      execution:'internal',porte_id:porte,minutes:85,pricing_mode:'time',
      commercial_category_id:'compacto',
      name: "Diagnóstico manual",
      sku: "MAN-SVC",
      category: "Manual",
      cost: 0,
      price: 17000,
      stock: 0,
      minimum_stock: 0,
      active: 1,
    });
    assert.equal(manualCatalog.status, 200, await manualCatalog.text());
    assert.equal(
      db
        .prepare(
          "SELECT COUNT(*) n FROM workshop_services WHERE tenant_id='a' AND name='Diagnóstico manual'",
        )
        .get()!.n,
      1,
    );
    assert.equal(
      (await request("/tenant", "POST", { tenant_id: "b" })).status,
      403,
    );
    assert.equal(
      (await request("/customers/b-customer", "PUT", { name: "Intruso" }))
        .status,
      404,
    );
    assert.equal(
      (await request("/orders", "POST", input({ customer_id: "b-customer" })))
        .status,
      404,
    );
    assert.equal(
      (await request("/orders", "POST", input({ due_on: "2026-02-31" })))
        .status,
      400,
    );
    const createdCostOrder = await request("/orders", "POST", input());
    assert.equal(createdCostOrder.status, 201);
    const costOrderId = (await createdCostOrder.json()).id;
    const costItems = db
      .prepare("SELECT * FROM order_items WHERE order_id=?")
      .all(costOrderId);
    const correctedCost = await request(
      `/orders/${costOrderId}`,
      "PUT",
      input({
        items: costItems.map((item) => ({ ...item, cost_override: 6500 })),
      }),
    );
    assert.equal(correctedCost.status, 200, await correctedCost.text());
    const product = db
      .prepare("SELECT * FROM catalog WHERE id='a-product'")
      .get()!;
    const catalogEdit = await request("/catalog/a-product", "PUT", {
      ...product,
      name: "Peça corrigida pela API",
      cost: 6500,
      freight_unit: 500,
      price: 12000,
    });
    assert.equal(catalogEdit.status, 200, await catalogEdit.text());
    const catalogRefresh = await request(
      `/orders/${costOrderId}`,
      "PUT",
      input({
        items: costItems.map((item) => ({
          ...item,
          name: "cliente não decide o nome",
          refresh_catalog: true,
          cost_override: 6500,
          price: 12000,
        })),
      }),
    );
    assert.equal(catalogRefresh.status, 200, await catalogRefresh.text());
    const refreshed = db
      .prepare("SELECT * FROM order_items WHERE order_id=?")
      .get(costOrderId)!;
    assert.equal(refreshed.name, "Peça corrigida pela API");
    assert.equal(refreshed.price, 12000);
    assert.equal(refreshed.cost, 6500);
    assert.equal(
      db
        .prepare("SELECT cost FROM order_items WHERE order_id=?")
        .get(costOrderId)!.cost,
      6500,
    );
    assert.equal(
      (
        await request(
          `/orders/${costOrderId}`,
          "PUT",
          input({
            items: costItems.map((item) => ({ ...item, cost_override: -1 })),
          }),
        )
      ).status,
      400,
    );
    assert.equal(
      db
        .prepare("SELECT cost FROM order_items WHERE order_id=?")
        .get(costOrderId)!.cost,
      6500,
    );
    assert.equal(
      (
        await request(
          "/orders",
          "POST",
          input({
            items: [{ catalog_id: "a-product", quantity: -1, price: 10000 }],
          }),
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await request(
          "/customers",
          "POST",
          { name: "Blocked" },
          "https://untrusted.example",
        )
      ).status,
      403,
    );
    assert.equal(
      (await request("/customers", "POST", { name: "Persistente" })).status,
      200,
    );
    assert.equal(
      (await (await request("/workspace")).json()).customers.length,
      2,
    );
    assert.equal((await request("/logout", "POST", {})).status, 200);
    assert.equal((await request("/workspace")).status, 401);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.close();
  }
});

test("OS sem cliente pode ser cancelada e exige vínculos na aprovação", async () => {
  const db = fixture();
  try {
    const guest = await saveOrder(
      db,
      ctx,
      input({
        status: "quote",
        customer_id: null,
        vehicle_id: null,
        guest_name: "Consulta sem cadastro",
      }),
    );
    assert.equal(
      (await listOrders(db, "a"))[0].customer_name,
      "Consulta sem cadastro",
    );
    await assert.rejects(
      async () => await transitionOrder(db, ctx, guest, "open"),
      /Vincule/,
    );
    await transitionOrder(db, ctx, guest, "cancelled");
    const rows = (await listOrders(db, "a")) as Order[];
    assert.equal(filterOrders(rows, "all").length, 1);
    assert.equal(filterOrders(rows, "cancelled").length, 1);
    assert.equal(filterOrders(rows, "quote").length, 0);
    const quote = await saveOrder(
      db,
      ctx,
      input({ status: "quote", customer_id: null, vehicle_id: null }),
    );
    await saveOrder(db, ctx, input({ status: "quote" }), quote);
    await transitionOrder(db, ctx, quote, "open");
    assert.equal(
      db.prepare("SELECT kind FROM orders WHERE id=?").get(quote)!.kind,
      "order",
    );
  } finally {
    db.close();
  }
});
test("parcelas conservam centavos, taxas e líquido, inclusive nos limites de arredondamento", () => {
  for (const base of [1, 7, 24, 99, 100, 101, 1999, 10001])
    for (const count of [1, 2, 3, 7, 24].filter((n) => n <= base))
      for (const fee of [0, 1, 333, 4999, 5000, 9999, 10000]) {
        const plan = calculatePlan(base, {
          method: "Cartão de crédito",
          installments: count,
          card_fee_bps: fee,
          interest_bps: count > 1 ? 399 : 0,
          first_due_on: "2026-01-31",
        });
        for (const key of ["gross", "fee", "net", "interest"] as const)
          assert.equal(
            plan.installments.reduce((s, p) => s + p[key], 0),
            plan[key],
          );
        assert.equal(
          plan.installments.reduce((s, p) => s + p.principal, 0),
          base,
        );
        for (const p of plan.installments) {
          assert.ok(p.interest >= 0);
          assert.ok(p.net >= 0);
          assert.ok(p.fee >= 0);
          assert.equal(p.net + p.fee, p.gross);
        }
      }
  assert.equal(addMonthsClamped("2026-01-31", 1), "2026-02-28");
  assert.equal(addMonthsClamped("2028-01-31", 1), "2028-02-29");
  assert.equal(addMonthsClamped("2026-01-31", 2), "2026-03-31");
  const plan = calculatePlan(10000, {
    method: "Cartão de crédito",
    installments: 3,
    card_fee_bps: 350,
    interest_bps: 1000,
    first_due_on: "2026-01-31",
  });
  assert.deepEqual(
    [plan.interest, plan.gross, plan.fee, plan.net],
    [1000, 11000, 385, 10615],
  );
  assert.throws(() =>
    calculatePlan(10000, {
      method: "Pix",
      installments: 2,
      card_fee_bps: 0,
      interest_bps: 0,
      first_due_on: "2026-01-31",
    }),
  );
});
test("Crédito parcelado recebe o total líquido em uma única confirmação", async () => {
  const db = fixture();
  try {
    const record = await saveOrder(db, ctx, input());
    await ready(db, record);
    await transitionOrder(db, ctx, record, "completed");
    const r = db.prepare("SELECT id FROM receivables").get()!;
    const plan = await configurePlan(db, ctx, String(r.id), {
      method: "Cartão de crédito",
      installments: 3,
      card_fee_bps: 350,
      interest_bps: 1000,
      first_due_on: "2026-01-31",
    });
    const parts = db
      .prepare("SELECT * FROM payment_installments ORDER BY sequence")
      .all();
    assert.equal(
      filterOrders((await listOrders(db, "a")) as Order[], "active")
        .length,
      1,
    );
    await assert.rejects(
      async () =>
        await settleInstallment(
          db,
          { ...ctx, tenantId: "b" },
          String(parts[0].id),
        ),
      /não encontrado/,
    );
    await settleInstallment(db, ctx, String(parts[0].id));
    assert.equal(
      db.prepare("SELECT SUM(amount) n FROM cash_entries").get()!.n,
      plan.net,
    );
    await assert.rejects(
      async () => await settleInstallment(db, ctx, String(parts[0].id)),
      /já foi/,
    );
    await assert.rejects(
      async () =>
        await configurePlan(db, ctx, String(r.id), {
          method: "Pix",
          installments: 1,
          card_fee_bps: 0,
          interest_bps: 0,
          first_due_on: "2026-02-01",
        }),
      /não pode mudar/,
    );
    assert.equal(
      (await listOrders(db, "a"))[0].display_status,
      "completed",
    );
    assert.equal(
      db.prepare("SELECT due_on FROM receivables").get()!.due_on,
      nextBankingDay(cashToday()),
    );
    await assert.rejects(settleInstallment(db, ctx, String(parts[1].id)), /já foi/);
    assert.equal(
      filterOrders((await listOrders(db, "a")) as Order[], "active")
        .length,
      0,
    );
    assert.equal(
      filterOrders((await listOrders(db, "a")) as Order[], "completed")
        .length,
      1,
    );
    const cash = db
      .prepare(
        "SELECT SUM(amount) net,SUM(gross_amount) gross,SUM(fee_amount) fee,COUNT(*) n FROM cash_entries",
      )
      .get()!;
    assert.deepEqual(
      [cash.net, cash.gross, cash.fee, cash.n],
      [plan.net, plan.gross, plan.fee, 1],
    );
  } finally {
    db.close();
  }
});
test("faturamento separa peças e serviços com desconto proporcional e custo histórico", async () => {
  const db = fixture();
  try {
    db.prepare(
      "INSERT INTO catalog(id,tenant_id,kind,name,sku,cost,price) VALUES('service','a','service','Serviço','SVC',0,10000)",
    ).run();
    const record = await saveOrder(
      db,
      ctx,
      input({
        discount: 3000,
        items: [
          { catalog_id: "a-product", quantity: 2, price: 10000 },
          { catalog_id: "service", quantity: 1, price: 10000 },
        ],
      }),
    );
    const original = (await listOrders(db, "a"))[0];
    db.prepare("UPDATE catalog SET cost=9999 WHERE id='a-product'").run();
    await saveOrder(db, ctx, { ...original, items: original.items }, record);
    const second = (await listOrders(db, "a"))[0];
    await saveOrder(db, ctx, { ...second, items: second.items }, record);
    await ready(db, record);
    await transitionOrder(db, ctx, record, "completed");
    assert.deepEqual(
      revenueBreakdown(
        (await listOrders(db, "a")) as Order[],
        "2000-01-01",
        "2100-01-01",
      ),
      { products: 18000, services: 9000, productProfit: 10000, productCost: 8000, missingCostOrders: 0, serviceCost: 0, serviceProfit: 9000 },
    );
  } finally {
    db.close();
  }
});
test("consulta por placa isola cadastros e trata resposta externa sem expor credencial", async () => {
  const db = fixture();
  const prior = process.env.PLACA_FIPE_TOKENS_JSON;
  try {
    delete process.env.PLACA_FIPE_TOKENS_JSON;
    const local = await lookupVehicle(db, "a", "abc-1d23");
    assert.equal(local.vehicle?.id, "a-vehicle");
    assert.equal(
      (await lookupVehicle(db, "b", "ABC1D23")).vehicle?.id,
      "b-vehicle",
    );
    assert.equal(
      (await lookupVehicle(db, "a", "ZZZ9Z99")).source,
      "unavailable",
    );
    process.env.PLACA_FIPE_TOKENS_JSON = JSON.stringify({
      a: "test-secret-token",
    });
    let called = 0;
    const fake = (async (url, options) => {
      called++;
      assert.equal(url, "https://api.placafipe.com.br/getplaca");
      assert.equal(
        JSON.parse(String(options?.body)).token,
        "test-secret-token",
      );
      return Response.json({
        codigo: 1,
        informacoes_veiculo: {
          marca: "Honda",
          modelo: "Civic",
          ano_modelo: "2024",
          cor: "Preto",
          proprietario: "Não deve sair",
        },
      });
    }) as typeof fetch;
    const found = await lookupVehicle(db, "a", "ZZZ9Z99", fake);
    assert.equal(found.source, "external");
    assert.equal(found.vehicle?.year, 2024);
    assert.ok(!JSON.stringify(found).includes("secret"));
    assert.ok(!JSON.stringify(found).includes("proprietario"));
    assert.equal(
      (await lookupVehicle(db, "b", "ZZZ9Z99", fake)).source,
      "unavailable",
    );
    assert.equal(called, 1);
    await assert.rejects(
      () =>
        lookupVehicle(db, "a", "ZZZ9Z99", (async () => {
          throw new Error("test-secret-token");
        }) as typeof fetch),
      (e) => e instanceof Error && !e.message.includes("secret"),
    );
  } finally {
    if (prior === undefined) delete process.env.PLACA_FIPE_TOKENS_JSON;
    else process.env.PLACA_FIPE_TOKENS_JSON = prior;
    db.close();
  }
});
test("API cadastra cliente e veículo atomicamente e limita o mecânico à operação", async () => {
  const db = fixture();
  const record = await saveOrder(db, ctx, input());
  await saveOrder(db, ctx, input({ status: "quote" }));
  const server = createApp(db).listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  let cookie = "";
  const request = async (path: string, method = "GET", body?: unknown) =>
    fetch(
      `http://127.0.0.1:${(server.address() as { port: number }).port}/api${path}`,
      {
        method,
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
    );
  try {
    const login = await request("/login", "POST", {
      email: "test@example.com",
      password: "password-test",
    });
    cookie = login.headers.get("set-cookie")!.split(";")[0];
    const combo = {
      customer: { name: "Cliente conjunto" },
      vehicle: {
        plate: "ZZZ1A23",
        brand: "Honda",
        model: "Fit",
        year: 2020,
        km: 0,
      },
    };
    const created = await request("/customers-with-vehicle", "POST", combo);
    assert.equal(created.status, 201);
    const result = await created.json();
    assert.equal(
      db
        .prepare("SELECT customer_id FROM vehicles WHERE id=?")
        .get(result.vehicle_id)!.customer_id,
      result.id,
    );
    assert.equal(
      (await request("/customers-with-vehicle", "POST", combo)).status,
      400,
    );
    assert.equal(
      db
        .prepare(
          "SELECT COUNT(*) n FROM customers WHERE name='Cliente conjunto'",
        )
        .get()!.n,
      1,
    );
    db.prepare(
      "UPDATE memberships SET role='operator' WHERE user_id='user'",
    ).run();
    const workspace = await (await request("/workspace")).json();
    assert.equal(workspace.orders.length, 1);
    assert.equal(workspace.catalog.length, 0);
    assert.equal(workspace.receivables.length, 0);
    for (const key of [
      "cost",
      "price",
      "total",
      "discount",
      "payment_status",
      "receivable_id",
    ])
      assert.ok(!JSON.stringify(workspace).includes(`"${key}"`), key);
    for (const [path, method, body] of [
      ["/customers", "POST", { name: "Bloqueado" }],
      ["/orders", "POST", input()],
      ["/payment-settings", "PUT", {}],
      ["/vehicles/lookup", "POST", { plate: "ABC1D23" }],
      [`/orders/${record}`, "PUT", input()],
      [`/orders/${record}/status`, "POST", { status: "cancelled" }],
      [`/orders/${record}/status`, "POST", { status: "completed" }],
      ["/installments/fake/settle", "POST", {}],
    ] as const)
      assert.equal((await request(path, method, body)).status, 403, path);
    assert.equal(
      (await request(`/orders/${record}/status`, "POST", { status: "working" }))
        .status,
      200,
    );
    assert.equal(
      (
        await request(`/orders/${record}/notes`, "PATCH", {
          notes: "Conferir torque antes da entrega.",
        })
      ).status,
      200,
    );
    assert.equal(
      (await request(`/orders/${record}/status`, "POST", { status: "ready" }))
        .status,
      200,
    );
    assert.equal(
      db.prepare("SELECT notes FROM orders WHERE id=?").get(record)!.notes,
      "Conferir torque antes da entrega.",
    );
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    db.close();
  }
});

test("produção permite login e saída nos domínios configurados e bloqueia outras origens", async () => {
  const previous = {
    NODE_ENV: process.env.NODE_ENV,
    APP_ORIGIN: process.env.APP_ORIGIN,
    APP_ORIGINS: process.env.APP_ORIGINS,
  };
  process.env.NODE_ENV = "production";
  process.env.APP_ORIGIN = "https://horse-power.vercel.app";
  process.env.APP_ORIGINS =
    "https://horse-power.vercel.app,https://oficinahorsepower.com.br";
  const db = fixture();
  const server = createApp(db).listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
  try {
    for (const origin of process.env.APP_ORIGINS.split(",")) {
      const login = await fetch(`${base}/login`, {
        method: "POST",
        headers: { Origin: origin, "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "test@example.com",
          password: "password-test",
        }),
      });
      assert.equal(login.status, 200);
      const cookie = login.headers.get("set-cookie")!.split(";")[0];
      const logout = await fetch(`${base}/logout`, {
        method: "POST",
        headers: { Origin: origin, Cookie: cookie },
      });
      assert.equal(logout.status, 200);
      assert.equal(
        (await fetch(`${base}/session`, { headers: { Cookie: cookie } }))
          .status,
        401,
      );
    }
    for (const origin of [
      "https://evil.example",
      "https://oficinahorsepower.com.br.evil.example",
      "http://oficinahorsepower.com.br",
      "null",
    ]) {
      for (const path of ["login", "logout"]) {
        assert.equal(
          (
            await fetch(`${base}/${path}`, {
              method: "POST",
              headers: { Origin: origin },
            })
          ).status,
          403,
        );
      }
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.close();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("edição explícita do cadastro atualiza descrição custo e venda só no item da OS ou orçamento escolhido", async () => {
  const db = fixture();
  try {
    const os = await saveOrder(db, ctx, input());
    const quote = await saveOrder(db, ctx, input({ status: "quote" }));
    const untouched = await saveOrder(db, ctx, input());
    const items = (id: string) =>
      db.prepare("SELECT * FROM order_items WHERE order_id=?").all(id);
    const original = { ...items(untouched)[0] };
    db.prepare(
      "UPDATE catalog SET name='Peça corrigida',cost=6500,price=12000 WHERE id='a-product'",
    ).run();
    for (const id of [os, quote]) {
      const before = items(id)[0];
      await saveOrder(
        db,
        ctx,
        input({
          items: items(id).map((item) => ({
            ...item,
            name: "nome de cliente ignorado",
            refresh_catalog: true,
            cost_override: 6500,
            price: 12000,
          })),
        }),
        id,
      );
      const saved = items(id)[0];
      assert.equal(saved.name, "Peça corrigida");
      assert.equal(saved.cost, 6500);
      assert.equal(saved.price, 12000);
      assert.equal(saved.quantity, before.quantity);
      assert.equal(
        db.prepare("SELECT total FROM orders WHERE id=?").get(id)!.total,
        23500,
      );
      // The next ordinary save preserves the corrected snapshot.
      await saveOrder(db, ctx, input({ items: items(id) }), id);
      assert.equal(items(id)[0].name, "Peça corrigida");
    }
    assert.deepEqual({ ...items(untouched)[0] }, original);
    db.prepare(
      "UPDATE catalog SET name='Outra alteração',cost=9999,price=55555 WHERE id='a-product'",
    ).run();
    await saveOrder(db, ctx, input({ items: items(os) }), os);
    assert.equal(items(os)[0].name, "Peça corrigida");
    assert.equal(items(os)[0].cost, 6500);
    assert.equal(items(os)[0].price, 12000);
  } finally {
    db.close();
  }
});

