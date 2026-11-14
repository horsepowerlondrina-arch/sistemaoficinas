import test from "node:test";
import assert from "node:assert/strict";
import { createDatabase } from "../server/db/database";
import { digest, hashPassword, type Context } from "../server/auth/session";
import { createApp } from "../server/app";
import { defaultWorkshopModules } from "../shared/workshopModules";
import { readUserAccess } from "../server/services/userAccess";
import { transitionOrder } from "../server/services/workshop";
import {
  createUserInvite,
  acceptEmployeeInvite,
  employeeInviteInfo,
  cancelUserInvite,
  saveUserAccess,
  reauthenticate,
  userCapacity,
} from "../server/services/workshopUsers";
import {
  saveStaff,
  saveAssignments,
  requestDiscount,
  decideDiscount,
} from "../server/services/workshopOperationsAccess";
const password = "Fictitious-access-test-123";
function fixture() {
  const db = createDatabase(":memory:");
  db.exec(
    "INSERT INTO tenants(id,name) VALUES('a','Oficina Fictícia A'),('b','Oficina Fictícia B')",
  );
  for (const [id, role] of [
    ["master", "owner"],
    ["second", "owner"],
    ["advisor", "operator"],
    ["mechanic", "operator"],
    ["manager", "operator"],
  ] as const) {
    db.prepare(
      "INSERT INTO users(id,name,email,password_hash) VALUES(?,?,?,?)",
    ).run(id, "Fictício " + id, id + "@example.test", hashPassword(password));
    db.prepare(
      "INSERT INTO memberships(user_id,tenant_id,role) VALUES(?,?,?)",
    ).run(id, "a", role);
    db.prepare("INSERT INTO sessions VALUES(?,?,?,?)").run(
      digest(id),
      id,
      "a",
      Date.now() + 3600000,
    );
  }
  db.prepare(
    "INSERT INTO memberships(user_id,tenant_id,role) VALUES(?,?,?)",
  ).run("master", "b", "owner");
  db.prepare("INSERT INTO sessions VALUES(?,?,?,?)").run(
    digest("master-b"),
    "master",
    "b",
    Date.now() + 3600000,
  );
  db.exec(
    "INSERT INTO customers(id,tenant_id,name,phone,email,address,document) VALUES('c','a','Cliente Fictício','00000000000','client@example.test','Endereço Fictício','00000000000');INSERT INTO vehicles(id,tenant_id,customer_id,plate,brand,model,year) VALUES('v','a','c','TST1A01','Marca Fictícia','Modelo Fictício',2024);INSERT INTO catalog(id,tenant_id,kind,name,sku,cost,price) VALUES('p','a','product','Peça Fictícia','TST-01',5000,10000);INSERT INTO orders(id,tenant_id,number,status,kind,customer_id,vehicle_id,entered_on,due_on,km,total) VALUES('o1','a',1,'open','order','c','v','2026-11-13','2026-11-14',0,10000),('o2','a',2,'open','order','c','v','2026-11-13','2026-11-14',0,10000);INSERT INTO order_items(id,tenant_id,order_id,catalog_id,kind,name,quantity,price,cost) VALUES('i1','a','o1','p','product','Peça Fictícia',1,10000,5000),('i2','a','o2','p','product','Peça Fictícia',1,10000,5000)",
  );
  for (const [id, profile, scope, bps] of [
    ["advisor", "advisor", "all", 500],
    ["mechanic", "mechanic", "assigned", 0],
    ["manager", "manager", "all", 1000],
  ] as const)
    db.prepare(
      "INSERT INTO workshop_user_access(tenant_id,user_id,profile,order_scope,discount_bps) VALUES(?,?,?,?,?)",
    ).run("a", id, profile, scope, bps);
  return db;
}
async function ctx(
  db: ReturnType<typeof fixture>,
  userId: string,
  tenantId = "a",
): Promise<Context> {
  const c: Context = {
    userId,
    tenantId,
    role: db
      .prepare("SELECT role FROM memberships WHERE user_id=? AND tenant_id=?")
      .get(userId, tenantId)!.role as string,
    modules: { ...defaultWorkshopModules },
  };
  c.access = await readUserAccess(db, c);
  return c;
}
test("employee invites reserve seats, preserve existing accounts, expire, cancel and cannot replay", async () => {
  const db = fixture();
  try {
    const master = await ctx(db, "master");
    let token = "";
    const deliver = async (i: any) => {
      token = i.token;
    };
    const employee = await saveStaff(db, master, null, {
      name: "Funcionário Fictício",
      role: "Mecânico",
      active: true,
      productive: true,
      user_id: null,
    });
    const invite = await createUserInvite(
      db,
      master,
      {
        email: "new@example.test",
        profile: "mechanic",
        professional_id: employee.id,
      },
      digest("master"),
      deliver,
    );
    assert.equal(invite.delivered, true);
    assert.equal((await userCapacity(db, master)).pending, 1);
    assert.equal((await employeeInviteInfo(db, token)).account_exists, false);
    await acceptEmployeeInvite(db, token, "", {
      name: "Novo Fictício",
      password,
    });
    assert.equal((await userCapacity(db, master)).pending, 0);
    assert.equal(
      db
        .prepare("SELECT user_id FROM staff_accounts WHERE professional_id=?")
        .get(employee.id)!.user_id,
      db.prepare("SELECT id FROM users WHERE email='new@example.test'").get()!
        .id,
    );
    await assert.rejects(
      acceptEmployeeInvite(db, token, "", { name: "Replay", password }),
    );
    const b = await ctx(db, "master", "b");
    await createUserInvite(
      db,
      b,
      { email: "advisor@example.test", profile: "advisor" },
      digest("master-b"),
      deliver,
    );
    await assert.rejects(
      acceptEmployeeInvite(db, token, "", { password: "wrong" }),
    );
    await acceptEmployeeInvite(db, token, "", { password });
    assert.equal(
      db
        .prepare(
          "SELECT count(*) n FROM users WHERE email='advisor@example.test'",
        )
        .get()!.n,
      1,
    );
    assert.equal(
      db
        .prepare("SELECT count(*) n FROM memberships WHERE user_id='advisor'")
        .get()!.n,
      2,
    );
    const cancelled = await createUserInvite(
      db,
      master,
      { email: "cancel@example.test", profile: "mechanic" },
      digest("master"),
      deliver,
    );
    await cancelUserInvite(db, master, cancelled.id);
    await assert.rejects(employeeInviteInfo(db, token));
    const expired = await createUserInvite(
      db,
      master,
      { email: "expired@example.test", profile: "mechanic" },
      digest("master"),
      deliver,
    );
    db.prepare("UPDATE workshop_user_invites SET expires_at=? WHERE id=?").run(
      Date.now() - 1,
      expired.id,
    );
    await assert.rejects(employeeInviteInfo(db, token));
    assert.equal((await userCapacity(db, master)).pending, 0);
  } finally {
    db.close();
  }
});
test("Master protection requires recent authentication, denies self-demotion and revokes only the disabled workshop", async () => {
  const db = fixture();
  try {
    const master = await ctx(db, "master");
    const down = {
      confirm_master: true,
      profile: "mechanic",
      active: false,
      permissions: {},
      order_scope: "assigned",
      discount_bps: 0,
      discount_cents: null,
    };
    await assert.rejects(
      saveUserAccess(db, master, "second", down, digest("master")),
      /senha novamente/,
    );
    await reauthenticate(db, master, digest("master"), password);
    await assert.rejects(
      saveUserAccess(
        db,
        master,
        "second",
        { ...down, confirm_master: false },
        digest("master"),
      ),
      /Confirme/,
    );
    await assert.rejects(
      saveUserAccess(db, master, "master", down, digest("master")),
      /próprio acesso Master/,
    );
    await saveUserAccess(db, master, "second", down, digest("master"));
    assert.equal(
      db.prepare("SELECT 1 FROM sessions WHERE user_id=?").get("second"),
      undefined,
    );
    const second: Context = { userId: "second", tenantId: "a", role: "owner" };
    await assert.rejects(
      saveUserAccess(db, second, "master", down, digest("second")),
    );
    const b = await ctx(db, "master", "b");
    assert.equal((await userCapacity(db, b)).active, 1);
    assert.ok(
      db
        .prepare("SELECT 1 FROM sessions WHERE token_hash=?")
        .get(digest("master-b")),
    );
    await saveUserAccess(
      db,
      master,
      "advisor",
      { profile: "advisor", active: false },
      digest("master"),
    );
    assert.equal(
      db.prepare("SELECT 1 FROM sessions WHERE user_id=?").get("advisor"),
      undefined,
    );
    await assert.rejects(
      saveUserAccess(
        db,
        await ctx(db, "mechanic"),
        "manager",
        { profile: "master" },
        digest("mechanic"),
      ),
    );
  } finally {
    db.close();
  }
});
test("discount requests enforce total limits, reject self-approval and invalidate stale amounts", async () => {
  const db = fixture();
  try {
    const advisor = await ctx(db, "advisor"),
      manager = await ctx(db, "manager");
    const request = await requestDiscount(db, advisor, "o1", {
      mode: "percent",
      value: 1000,
      justification: "Desconto fictício solicitado",
    });
    await assert.rejects(
      decideDiscount(db, advisor, request.id, {
        approve: true,
        reason: "Teste de autoaprovação",
      }),
    );
    assert.equal(
      db.prepare("SELECT discount FROM orders WHERE id='o1'").get()!.discount,
      0,
    );
    assert.equal(
      (
        await decideDiscount(db, manager, request.id, {
          approve: true,
          reason: "Autorizado para teste",
        })
      ).status,
      "approved",
    );
    assert.equal(
      db.prepare("SELECT discount FROM orders WHERE id='o1'").get()!.discount,
      1000,
    );
    const stale = await requestDiscount(db, advisor, "o1", {
      mode: "money",
      value: 2000,
      justification: "Pedido que será invalidado",
    });
    db.prepare("UPDATE order_items SET quantity=2 WHERE id='i1'").run();
    assert.equal(
      (
        await decideDiscount(db, manager, stale.id, {
          approve: true,
          reason: "Conferir valores atuais",
        })
      ).status,
      "invalidated",
    );
    const tooMuch = await requestDiscount(db, advisor, "o2", {
      mode: "money",
      value: 3000,
      justification: "Solicitação acima do limite",
    });
    await assert.rejects(
      decideDiscount(db, manager, tooMuch.id, {
        approve: true,
        reason: "Não possui limite suficiente",
      }),
    );
    assert.equal(
      (
        await decideDiscount(db, manager, tooMuch.id, {
          approve: false,
          reason: "Recusado no teste",
        })
      ).status,
      "rejected",
    );
  } finally {
    db.close();
  }
});
test("HTTP assigned OS scope, privacy, live permissions, account revocation and office selection", async () => {
  const db = fixture();
  const master = await ctx(db, "master");
  const professional = await saveStaff(db, master, null, {
    name: "Mecânico Fictício",
    role: "Mecânico",
    active: true,
    productive: true,
    user_id: "mechanic",
  });
  await saveAssignments(db, master, "o1", [professional.id]);
  const server = createApp(db).listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const base = "http://127.0.0.1:" + (server.address() as any).port + "/api";
  const request = (
    path: string,
    method = "GET",
    body?: unknown,
    cookie = "mechanic",
  ) =>
    fetch(base + path, {
      method,
      headers: {
        Cookie: "hp_session=" + cookie,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  try {
    let workspace = await (await request("/workspace")).json();
    assert.deepEqual(
      workspace.orders.map((o: any) => o.id),
      ["o1"],
    );
    assert.equal(workspace.orders[0].total, undefined);
    assert.equal(workspace.orders[0].items[0].cost, undefined);
    assert.equal(
      JSON.stringify(workspace).includes("client@example.test"),
      false,
    );
    assert.equal(
      (await request("/orders/o2/status", "POST", { status: "ready" })).status,
      404,
    );
    assert.equal(
      (await request("/documents/order/o2", "POST", {})).status,
      404,
    );
    assert.equal((await request("/users")).status, 403);
    assert.equal((await request("/orders/o1/status","POST",{status:"quote"})).status,403);
    await assert.rejects(transitionOrder(db,await ctx(db,"mechanic"),"o1","quote"),/permissão/);
    db.prepare("UPDATE orders SET status='quote' WHERE id='o1'").run();
    assert.equal((await request("/orders/o1/status","POST",{status:"working",due_on:"2026-11-14"})).status,403);
    await assert.rejects(transitionOrder(db,await ctx(db,"mechanic"),"o1","working","2026-11-14"),/permissão/);
    db.prepare("UPDATE orders SET status='open' WHERE id='o1'").run();
    await saveAssignments(db, master, "o1", []);
    workspace = await (await request("/workspace")).json();
    assert.equal(workspace.orders.length, 0);
    await saveUserAccess(
      db,
      master,
      "mechanic",
      { profile: "mechanic", active: false },
      digest("master"),
    );
    assert.equal((await request("/session")).status, 401);
    const login = await request(
      "/login",
      "POST",
      { email: "master@example.test", password },
      "",
    );
    assert.equal(login.status, 200);
    const cookie = login.headers
      .get("set-cookie")!
      .match(/hp_session=([^;]+)/)![1];
    assert.equal(
      (await (await request("/session", "GET", undefined, cookie)).json())
        .must_select_office,
      true,
    );
    assert.equal((await request("/orders", "POST", {}, cookie)).status, 409);
    assert.equal(
      (await request("/tenant", "POST", { tenant_id: "b" }, cookie)).status,
      200,
    );
    assert.equal(
      (await (await request("/session", "GET", undefined, cookie)).json())
        .tenant.id,
      "b",
    );
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((e) => (e ? reject(e) : resolve())),
    );
    db.close();
  }
});

test("resend invalidates its old link, and employees without login never consume seats", async () => {
  const db = fixture();
  try {
    const master = await ctx(db, "master");
    const before = await userCapacity(db, master);
    const staff = await saveStaff(db, master, null, {
      name: "Funcionário sem login",
      role: "Auxiliar",
      active: true,
      productive: false,
      user_id: null,
    });
    assert.equal((await userCapacity(db, master)).active, before.active);
    await assert.rejects(
      saveAssignments(db, master, "o1", [staff.id]),
      /produtivos ativos/,
    );
    let current = "";
    const mail = async (value: any) => {
      current = value.token;
    };
    const first = await createUserInvite(
      db,
      master,
      { email: "resend@example.test", profile: "mechanic" },
      digest("master"),
      mail,
    );
    const old = current;
    await createUserInvite(
      db,
      master,
      { email: "resend@example.test", profile: "mechanic" },
      digest("master"),
      mail,
      first.id,
    );
    await assert.rejects(employeeInviteInfo(db, old));
    assert.equal(
      (await employeeInviteInfo(db, current)).email,
      "resend@example.test",
    );
    assert.equal((await userCapacity(db, master)).pending, 1);
    await cancelUserInvite(db, master, first.id);
    assert.equal((await userCapacity(db, master)).pending, 0);
  } finally {
    db.close();
  }
});

test("approved completed-OS discounts reuse the financial rules and paid requests become invalid", async () => {
  const db = fixture();
  try {
    const master = await ctx(db, "master");
    await transitionOrder(db, master, "o1", "completed");
    await saveUserAccess(
      db,
      master,
      "advisor",
      {
        profile: "advisor",
        active: true,
        permissions: {
          "finance.view": true,
          "finance.receive": true,
          "finance.edit": true,
        },
        discount_bps: 500,
      },
      digest("master"),
    );
    const advisor = await ctx(db, "advisor"),
      manager = await ctx(db, "manager");
    const request = await requestDiscount(db, advisor, "o1", {
      mode: "money",
      value: 1000,
      justification: "Desconto para recebimento fictício",
    });
    assert.equal(
      (
        await decideDiscount(db, manager, request.id, {
          approve: true,
          reason: "Aprovação financeira fictícia",
        })
      ).status,
      "approved",
    );
    assert.equal(
      db.prepare("SELECT amount FROM receivables WHERE order_id='o1'").get()!
        .amount,
      9000,
    );
    const next = await requestDiscount(db, advisor, "o1", {
      mode: "money",
      value: 500,
      justification: "Pedido anterior à confirmação",
    });
    db.prepare(
      "UPDATE receivables SET status='paid' WHERE order_id='o1'",
    ).run();
    assert.equal(
      (
        await decideDiscount(db, manager, next.id, {
          approve: true,
          reason: "Estado deve ser revalidado",
        })
      ).status,
      "invalidated",
    );
    assert.equal(
      db.prepare("SELECT discount FROM orders WHERE id='o1'").get()!.discount,
      1000,
    );
  } finally {
    db.close();
  }
});

test("individual access changes are live, restore independently, and preserve the legacy schema fallback", async () => {
  const db = fixture();
  try {
    const master = await ctx(db, "master");
    await saveUserAccess(
      db,
      master,
      "mechanic",
      {
        profile: "mechanic",
        active: true,
        permissions: {
          "orders.prices": true,
          "customers.view": true,
          "personal.contact": true,
        },
      },
      digest("master"),
    );
    assert.equal(
      (await ctx(db, "mechanic")).access!.permissions["orders.prices"],
      true,
    );
    assert.equal(
      (await ctx(db, "advisor")).access!.permissions["finance.costs"],
      false,
    );
    await saveUserAccess(
      db,
      master,
      "mechanic",
      { profile: "mechanic", active: true, permissions: {} },
      digest("master"),
    );
    assert.equal(
      (await ctx(db, "mechanic")).access!.permissions["orders.prices"],
      false,
    );
    Object.assign(db, { hasUserAccessSchema: async () => false });
    const server = createApp(db).listen(0, "127.0.0.1");
    await new Promise<void>((r) => server.once("listening", r));
    try {
      const base =
        "http://127.0.0.1:" + (server.address() as any).port + "/api";
      const headers = { Cookie: "hp_session=master" };
      assert.equal((await fetch(base + "/workspace", { headers })).status, 200);
      assert.equal((await fetch(base + "/users", { headers })).status, 503);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  } finally {
    db.close();
  }
});

test("permission reductions revoke prior share links issued by that account", async () => {
  const db = fixture();
  try {
    const { createShare, readShare } =
      await import("../server/services/sharing");
    const master = await ctx(db, "master"),
      advisor = await ctx(db, "advisor");
    const share = await createShare(
      db,
      { ...advisor, action: "orders.prices" },
      "o1",
    );
    assert.ok(await readShare(db, share.path.slice(3)));
    await saveUserAccess(
      db,
      master,
      "advisor",
      { profile: "mechanic", active: true, order_scope: "assigned" },
      digest("master"),
    );
    assert.equal(await readShare(db, share.path.slice(3)), null);
  } finally {
    db.close();
  }
});
