import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { adminClient } from "../scripts/local-admin";
import { createLocalDatabase } from "../server/db/local";
import { digest, hashPassword, type Context } from "../server/auth/session";
import {
  createUserInvite,
  acceptEmployeeInvite,
  userCapacity,
  saveUserAccess,
} from "../server/services/workshopUsers";
import { readUserAccess } from "../server/services/userAccess";
import { defaultWorkshopModules } from "../shared/workshopModules";

test("OPS-004 PostgreSQL17: concurrent seats, invitations, reactivation, last Master and restricted RLS", async () => {
  const admin = adminClient();
  await admin.connect();
  const t = randomUUID(),
    other = randomUUID(),
    owner = randomUUID(),
    newA = randomUUID(),
    newB = randomUUID(),
    password = "Fictitious-ci-password-123";
  await admin.query(
    "INSERT INTO horse_power.tenants(id,name) VALUES($1,$2),($3,$4)",
    [t, "OPS004 Oficina Fictícia", other, "OPS004 Outra Oficina"],
  );
  for (const id of [owner, newA, newB])
    await admin.query(
      "INSERT INTO horse_power.users(id,name,email,password_hash) VALUES($1,$2,$3,$4)",
      [id, "Usuário Fictício", id + "@example.test", hashPassword(password)],
    );
  await admin.query(
    "INSERT INTO horse_power.memberships(user_id,tenant_id,role) VALUES($1,$2,'owner'),($1,$3,'owner')",
    [owner, t, other],
  );
  await admin.query(
    "INSERT INTO platform_admin.workshop_entitlements(tenant_id,max_users_override) VALUES($1,2)",
    [t],
  );
  const db = await createLocalDatabase(),
    parallel = await createLocalDatabase();
  const settings = (user = owner) => ({
    "app.tenant_id": t,
    "app.user_id": user,
    "app.session_hash": digest(user),
  });
  const context = async (
    database: typeof db,
    user = owner,
  ): Promise<Context> => {
    const c: Context = {
      userId: user,
      tenantId: t,
      role: "owner",
      modules: { ...defaultWorkshopModules },
    };
    c.access = await readUserAccess(database, c);
    return c;
  };
  try {
    const tokens: string[] = [];
    const results = await Promise.allSettled(
      [db, parallel].map((database, i) =>
        database.withRequestContext!(settings(), async () =>
          createUserInvite(
            database,
            await context(database),
            { email: `ops004-${t}-${i}@example.test`, profile: "mechanic" },
            digest(owner),
            async (value) => {
              tokens.push(value.token);
            },
          ),
        ),
      ),
    );
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(results.filter((r) => r.status === "rejected").length, 1);
    await db.withRequestContext!(settings(), async () => {
      const capacity = await userCapacity(db, await context(db));
      assert.equal(capacity.active, 1);
      assert.equal(capacity.pending, 1);
      assert.equal(capacity.available, 0);
    });
    await acceptEmployeeInvite(db, tokens[0], "", {
      name: "Convidado Fictício",
      password,
    });
    await assert.rejects(
      acceptEmployeeInvite(db, tokens[0], "", {
        name: "Replay Fictício",
        password,
      }),
    );
    const joined = (
      await admin.query(
        "SELECT user_id FROM horse_power.memberships WHERE tenant_id=$1 AND user_id<>$2",
        [t, owner],
      )
    ).rows[0].user_id;
    await admin.query(
      "UPDATE horse_power.workshop_user_access SET active=0 WHERE tenant_id=$1 AND user_id=$2",
      [t, joined],
    );
    for (const id of [newA, newB]) {
      await admin.query(
        "INSERT INTO horse_power.memberships(user_id,tenant_id,role) VALUES($1,$2,'operator')",
        [id, t],
      );
      await admin.query(
        "INSERT INTO horse_power.workshop_user_access(tenant_id,user_id,profile,active) VALUES($1,$2,'mechanic',0)",
        [t, id],
      );
    }
    const activated = await Promise.allSettled(
      [db, parallel].map((database, i) =>
        database.withRequestContext!(settings(), async () => {
          await database
            .prepare(
              "UPDATE workshop_user_access SET active=1 WHERE tenant_id=? AND user_id=?",
            )
            .run(t, [newA, newB][i]);
        }),
      ),
    );
    assert.equal(activated.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(
      (
        await admin.query(
          "SELECT horse_power.workshop_occupied_seats($1)::int n",
          [t],
        )
      ).rows[0].n,
      2,
    );
    // Two Masters cannot concurrently demote one another and leave no administrator.
    await admin.query(
      "UPDATE platform_admin.workshop_entitlements SET max_users_override=5 WHERE tenant_id=$1",
      [t],
    );
    await admin.query(
      "UPDATE horse_power.memberships SET role='owner' WHERE tenant_id=$1 AND user_id=$2",
      [t, newA],
    );
    await admin.query(
      "UPDATE horse_power.workshop_user_access SET profile='master',active=1 WHERE tenant_id=$1 AND user_id=$2",
      [t, newA],
    );
    for (const user of [owner, newA]) {
      await admin.query(
        "INSERT INTO horse_power.sessions(token_hash,user_id,tenant_id,expires_at) VALUES($1,$2,$3,$4)",
        [digest(user), user, t, Date.now() + 3600000],
      );
      await admin.query(
        "INSERT INTO horse_power.session_reauthentication(token_hash,authenticated_at) VALUES($1,$2)",
        [digest(user), Date.now()],
      );
    }
    const demoted = await Promise.allSettled(
      [db, parallel].map((database, i) =>
        database.withRequestContext!(settings([owner, newA][i]), async () =>
          saveUserAccess(
            database,
            await context(database, [owner, newA][i]),
            [newA, owner][i],
            { profile: "mechanic", active: true },
            digest([owner, newA][i]),
          ),
        ),
      ),
    );
    assert.equal(demoted.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(
      (
        await admin.query(
          "SELECT count(*)::int n FROM horse_power.memberships m LEFT JOIN horse_power.workshop_user_access a ON a.tenant_id=m.tenant_id AND a.user_id=m.user_id WHERE m.tenant_id=$1 AND m.role='owner' AND coalesce(a.active,1)=1",
          [t],
        )
      ).rows[0].n,
      1,
    );
    await db.withRequestContext!(settings(), async () => {
      assert.equal(
        (
          await db
            .prepare("SELECT * FROM workshop_user_access WHERE tenant_id=?")
            .all(other)
        ).length,
        0,
      );
      assert.equal(
        (
          await db
            .prepare("SELECT * FROM workshop_user_invites WHERE tenant_id=?")
            .all(other)
        ).length,
        0,
      );
      const role = await db
        .prepare(
          "SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user",
        )
        .get();
      assert.equal(role!.rolsuper, false);
      assert.equal(role!.rolbypassrls, false);
    });
    const scopedUser = randomUUID(),
      professional = randomUUID(),
      customer = randomUUID(),
      vehicle = randomUUID(),
      visible = randomUUID(),
      hidden = randomUUID();
    await admin.query(
      "INSERT INTO horse_power.users(id,name,email,password_hash) VALUES($1,'Mecânico Fictício',$2,$3)",
      [scopedUser, scopedUser + "@example.test", hashPassword(password)],
    );
    await admin.query(
      "INSERT INTO horse_power.memberships(user_id,tenant_id,role) VALUES($1,$2,'operator')",
      [scopedUser, t],
    );
    await admin.query(
      "INSERT INTO horse_power.workshop_user_access(tenant_id,user_id,profile,order_scope) VALUES($1,$2,'mechanic','assigned')",
      [t, scopedUser],
    );
    await admin.query(
      "INSERT INTO horse_power.professionals(id,tenant_id,name,role) VALUES($1,$2,'Mecânico Fictício','Mecânico')",
      [professional, t],
    );
    await admin.query(
      "INSERT INTO horse_power.staff_accounts(tenant_id,professional_id,user_id) VALUES($1,$2,$3)",
      [t, professional, scopedUser],
    );
    await admin.query(
      "INSERT INTO horse_power.customers(id,tenant_id,name) VALUES($1,$2,'Cliente Fictício')",
      [customer, t],
    );
    await admin.query(
      "INSERT INTO horse_power.vehicles(id,tenant_id,customer_id,plate,brand,model,year) VALUES($1,$2,$3,'TST1A01','Fictícia','Fictício',2024)",
      [vehicle, t, customer],
    );
    for (const [number, order] of [visible, hidden].entries()) {
      await admin.query(
        "INSERT INTO horse_power.orders(id,tenant_id,number,status,kind,customer_id,vehicle_id,entered_on,due_on,km) VALUES($1,$2,$3,'open','order',$4,$5,'2026-11-13','2026-11-14',0)",
        [order, t, number + 1, customer, vehicle],
      );
      await admin.query(
        "INSERT INTO horse_power.order_items(id,tenant_id,order_id,kind,name,quantity,price,cost,service_snapshot) VALUES($1,$2,$3,'service','Serviço Fictício',1,10000,1000,'{}')",
        [randomUUID(), t, order],
      );
    }
    await admin.query(
      "INSERT INTO horse_power.order_assignments(tenant_id,order_id,professional_id,assigned_by,assigned_at) VALUES($1,$2,$3,$4,$5)",
      [t, visible, professional, owner, Date.now()],
    );
    await db.withRequestContext!(settings(scopedUser), async () => {
      assert.deepEqual(
        (
          await db.prepare("SELECT id FROM orders WHERE tenant_id=?").all(t)
        ).map((o) => o.id),
        [visible],
      );
      assert.equal(
        (
          await db
            .prepare(
              "SELECT * FROM order_items WHERE tenant_id=? AND order_id=?",
            )
            .all(t, hidden)
        ).length,
        0,
      );
      assert.equal(
        (
          await db
            .prepare("SELECT * FROM workshop_user_access WHERE tenant_id=?")
            .all(t)
        ).length,
        1,
      );
      assert.equal(
        (
          await db
            .prepare("SELECT * FROM workshop_user_invites WHERE tenant_id=?")
            .all(t)
        ).length,
        0,
      );
    });
    await admin.query(
      "UPDATE horse_power.order_assignments SET removed_at=$1 WHERE tenant_id=$2 AND order_id=$3",
      [Date.now(), t, visible],
    );
    await db.withRequestContext!(settings(scopedUser), async () =>
      assert.equal(
        (await db.prepare("SELECT id FROM orders WHERE tenant_id=?").all(t))
          .length,
        0,
      ),
    );
    await Promise.all(
      Array.from({ length: 3 }, () =>
        db.withRequestContext!(settings(scopedUser), async () => {
          assert.equal(await db.hasUserAccessSchema!(), true);
        }),
      ),
    );
    const grants = await admin.query(
      "SELECT EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid='horse_power.accept_employee_invite(text,text,text,text)'::regprocedure AND a.grantee=0 AND a.privilege_type='EXECUTE') allowed",
    );
    assert.equal(grants.rows[0].allowed, false);
    assert.equal(
      (
        await admin.query(
          "SELECT count(*)::int n FROM horse_power.audit_events WHERE tenant_id=$1 AND action LIKE $2",
          [t, "users.%"],
        )
      ).rows[0].n >= 3,
      true,
    );
  } finally {
    await db.close();
    await parallel.close();
    await admin.end();
  }
});
