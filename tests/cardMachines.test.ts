import test from "node:test";
import assert from "node:assert/strict";
import { createDatabase } from "../server/db/database";
import {
  saveCardMachine,
  listCardMachines,
  resolveCardPayments,
} from "../server/services/cardMachines";
import { configurePlan } from "../server/services/payments";
import { calculatePlan } from "../server/domain/payments";
import { createApp } from "../server/app";
import { digest } from "../server/auth/session";
import { defaultWorkshopModules } from "../shared/workshopModules";
import { selectCardMachine } from "../shared/cardMachines";
const ctx = { tenantId: "a", userId: "u", role: "owner" };
const terms = {
  method: "Cartão de crédito",
  installments: 3,
  card_fee_bps: 350,
  interest_bps: 0,
  first_due_on: "2026-10-01",
  pass_card_fee: false,
};
const machine = (name = "Máquina A") => ({
  name,
  operator: "Operadora fictícia",
  active: true,
  is_default: true,
  max_installments: 12,
  rates: [
    { method: "Cartão de crédito", installments: 3, fee_bps: 350 },
    { method: "Cartão de débito", installments: 1, fee_bps: 0 },
  ],
});
function fixture() {
  const db = createDatabase(":memory:");
  db.exec(
    "INSERT INTO tenants(id,name) VALUES('a','Fictícia A'),('b','Fictícia B'); INSERT INTO users VALUES('u','Admin','a@example.test','disabled'),('m','Operador','m@example.test','disabled'); INSERT INTO memberships VALUES('u','a','owner'),('m','a','operator'); INSERT INTO customers(id,tenant_id,name) VALUES('c','a','Cliente'); INSERT INTO vehicles(id,tenant_id,customer_id,plate,brand,model,year) VALUES('v','a','c','ABC1D23','Fictícia','Modelo',2020); INSERT INTO orders(id,tenant_id,number,status,customer_id,vehicle_id,entered_on,due_on,km,total) VALUES('o','a',1,'completed','c','v','2026-10-01','2026-10-01',0,10001); INSERT INTO receivables(id,tenant_id,order_id,customer_id,description,amount,due_on) VALUES('r','a','o','c','OS fictícia',10001,'2026-10-01')",
  );
  return db;
}
test("OPS-002 machines, unique default, disabled history, missing rates and tenant isolation", async () => {
  const db = fixture();
  try {
    await assert.rejects(resolveCardPayments(db, ctx, terms), /máquina ativa/);
    const a = await saveCardMachine(db, ctx, machine());
    const b = await saveCardMachine(db, { ...ctx, tenantId: "b" }, machine());
    assert.equal((await listCardMachines(db, ctx)).length, 1);
    await assert.rejects(
      resolveCardPayments(db, ctx, { ...terms, machine_id: b.id }),
      /máquina ativa/,
    );
    await assert.rejects(
      saveCardMachine(db, ctx, machine(), b.id),
      /nesta oficina/,
    );
    await assert.rejects(
      saveCardMachine(db, ctx, machine(" MÁQUINA A ")),
      /existe/,
    );
    await assert.rejects(
      saveCardMachine(db, ctx, {
        ...machine(),
        rates: [...machine().rates, machine().rates[0]],
      }),
      /duplicadas/,
    );
    await assert.rejects(
      resolveCardPayments(db, ctx, { ...terms, installments: 2 }),
      /não têm taxa/,
    );
    await assert.rejects(
      resolveCardPayments(db, ctx, { ...terms, card_fee_bps: 1 }),
      /taxa.*mudou/,
    );
    const resolved = await resolveCardPayments(db, ctx, {
      ...terms,
      method: "Cartão de débito",
      installments: 1,
      card_fee_bps: 0,
    });
    assert.equal("machine_id" in resolved && resolved.machine_id, a.id);
    const c = await saveCardMachine(db, ctx, machine("Máquina C"));
    assert.equal(
      (await listCardMachines(db, ctx)).filter((m) => m.is_default).length,
      1,
    );
    assert.equal(
      (await listCardMachines(db, ctx)).find((m) => m.is_default)?.id,
      c.id,
    );
    await saveCardMachine(
      db,
      ctx,
      { ...machine("Máquina C"), active: false, is_default: false },
      c.id,
    );
    assert.equal((await listCardMachines(db, ctx)).length, 2);
    await assert.rejects(
      resolveCardPayments(db, ctx, { ...terms, machine_id: c.id }),
      /máquina ativa/,
    );
    await assert.rejects(
      saveCardMachine(db, { ...ctx, role: "operator" }, machine()),
      /administrador/,
    );
    await assert.rejects(
      saveCardMachine(
        db,
        { ...ctx, modules: { ...defaultWorkshopModules, settings: false } },
        machine(),
      ),
      /habilitado/,
    );
    assert.equal(
      (
        (await resolveCardPayments(
          db,
          { ...ctx, modules: { ...defaultWorkshopModules, settings: false } },
          { ...terms, machine_id: a.id },
        )) as any
      ).machine_id,
      a.id,
    );
  } finally {
    db.close();
  }
});
test("OPS-002 installment snapshots survive machine edits and disabling; failed plan preserves old rows", async () => {
  const db = fixture();
  try {
    const a = await saveCardMachine(db, ctx, machine());
    const plan = await configurePlan(db, ctx, "r", {
      ...terms,
      machine_id: a.id,
      pass_card_fee: true,
    });
    assert.equal(plan.net, 10001);
    const before = db
      .prepare("SELECT * FROM payment_installments ORDER BY sequence")
      .all();
    assert.equal(before.length, 3);
    assert.equal(before[0].machine_name, "Máquina A");
    assert.equal(before[0].card_fee_bps, 350);
    assert.equal(before[0].pass_card_fee, 1);
    await saveCardMachine(
      db,
      ctx,
      { ...machine("Nome novo"), active: false, is_default: false, rates: [] },
      a.id,
    );
    assert.deepEqual(
      db.prepare("SELECT * FROM payment_installments ORDER BY sequence").all(),
      before,
    );
    await assert.rejects(
      configurePlan(db, ctx, "r", { ...terms, machine_id: a.id }),
      /máquina ativa/,
    );
    assert.deepEqual(
      db.prepare("SELECT * FROM payment_installments ORDER BY sequence").all(),
      before,
    );
  } finally {
    db.close();
  }
});
test("OPS-002 exact operation fee and passed net conserve cents across rates and installments", () => {
  for (const base of [1, 17, 10001, 99999999])
    for (const rate of [0, 1, 199, 350, 9999])
      for (const n of [1, 3, 12].filter((n) => n <= base)) {
        const p = calculatePlan(base, {
          ...terms,
          installments: n,
          card_fee_bps: rate,
          pass_card_fee: true,
        });
        assert.equal(p.net, base);
        assert.equal(p.gross - p.fee, p.net);
        assert.equal(
          p.installments.reduce((s, p) => s + p.fee, 0),
          p.fee,
        );
        assert.equal(
          p.installments.reduce((s, p) => s + p.net, 0),
          p.net,
        );
      }
  assert.throws(
    () =>
      calculatePlan(Number.MAX_SAFE_INTEGER, { ...terms, pass_card_fee: true }),
    /limite/,
  );
  const machines = [
    {
      id: "a",
      name: "A",
      operator: "A",
      active: 1,
      is_default: 1,
      max_installments: 3,
      rates: machine().rates,
    },
  ];
  assert.equal(selectCardMachine(terms, machines).machine_id, "a");
  assert.equal(
    selectCardMachine({ ...terms, installments: 2 }, machines).card_fee_bps,
    0,
  );
});
test("OPS-002 API denies unauthorized finance/settings access and does not trust tenant or rate payloads", async () => {
  const db = fixture();
  let modules = { ...defaultWorkshopModules };
  Object.assign(db, { getTenantModuleAccess: async () => modules });
  for (const [token, user] of [
    ["owner", "u"],
    ["operator", "m"],
  ])
    db.prepare("INSERT INTO sessions VALUES(?,?,?,?)").run(
      digest(token),
      user,
      "a",
      Date.now() + 60000,
    );
  const server = createApp(db).listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const base = "http://127.0.0.1:" + (server.address() as any).port + "/api";
  const call = (
    path: string,
    method = "GET",
    body?: unknown,
    token = "owner",
  ) =>
    fetch(base + path, {
      method,
      headers: {
        Cookie: "hp_session=" + token,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  try {
    assert.equal(
      (await call("/card-machines", "POST", machine(), "operator")).status,
      403,
    );
    modules = { ...modules, finance: false };
    assert.equal((await call("/card-machines")).status, 403);
    modules = { ...modules, finance: true, settings: false };
    assert.equal((await call("/card-machines", "POST", machine())).status, 403);
    assert.equal((await call("/card-machines")).status, 200);
    modules = { ...modules, settings: true };
    const created = await call("/card-machines", "POST", {
      ...machine(),
      tenant_id: "b",
    });
    assert.equal(created.status, 201);
    const { id } = await created.json();
    assert.equal(
      db.prepare("SELECT tenant_id FROM card_machines WHERE id=?").get(id)!
        .tenant_id,
      "a",
    );
    const preview = await call("/receivables/r/preview", "POST", {
      ...terms,
      machine_id: id,
    });
    assert.equal(preview.status, 200);
    assert.equal(
      db.prepare("SELECT count(*) n FROM payment_installments").get()!.n,
      0,
    );
    assert.equal(
      (
        await call("/receivables/r/plan", "POST", {
          ...terms,
          machine_id: id,
          card_fee_bps: 0,
        })
      ).status,
      400,
    );
    assert.equal(
      (await call("/receivables/r/plan", "POST", { ...terms, machine_id: id }))
        .status,
      200,
    );
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    db.close();
  }
});
