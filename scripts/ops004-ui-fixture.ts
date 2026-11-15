import { randomBytes, randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { adminClient } from "./local-admin";
import { createLocalDatabase } from "../server/db/local";
import { createUserInvite } from "../server/services/workshopUsers";
import { defaultWorkshopModules } from "../shared/workshopModules";
import { hashPassword } from "../server/auth/session";

// Only disposable loopback PostgreSQL is accepted. These offices are separate
// from local-a/local-b, which remain the baseline of other regression suites.
const db = adminClient();
await db.connect();
try {
  const prefix = randomUUID(),
    tenantA = `ops004-ui-${prefix}-a`,
    tenantB = `ops004-ui-${prefix}-b`;
  const id = randomUUID(),
    ownerA = randomUUID(),
    ownerB = randomUUID();
  const email = "ops004-colaborador-ui@example.test",
    activationEmail = "ops004-ativacao-ui@example.test";
  const ownerEmail = "ops004-master-ui@example.test";
  const password = randomBytes(24).toString("base64url"),
    ownerPassword = randomBytes(24).toString("base64url");
  const customer = randomUUID(),
    vehicle = randomUUID(),
    product = randomUUID(),
    order = randomUUID();
  await db.query("BEGIN");
  for (const [tenant, owner, suffix, mail] of [
    [tenantA, ownerA, "A", ownerEmail],
    [tenantB, ownerB, "B", "ops004-outro-master-ui@example.test"],
  ]) {
    await db.query("INSERT INTO horse_power.tenants(id,name) VALUES($1,$2)", [
      tenant,
      `Oficina Fictícia ${suffix}`,
    ]);
    await db.query(
      "INSERT INTO horse_power.users(id,name,email,password_hash) VALUES($1,$2,$3,$4)",
      [
        owner,
        `Administrador Fictício ${suffix}`,
        mail,
        hashPassword(ownerPassword),
      ],
    );
    await db.query(
      "INSERT INTO horse_power.memberships(user_id,tenant_id,role) VALUES($1,$2,'owner')",
      [owner, tenant],
    );
    await db.query(
      "INSERT INTO platform_admin.workshops(tenant_id,source,name,responsible_name,responsible_email,status,email_verified_at,plan_code,plan_policy_activated_at) VALUES($1,'admin',$2,'Responsável Fictício',$3,'active',now(),'premium',now())",
      [tenant, `Oficina Fictícia ${suffix}`, mail],
    );
    await db.query(
      "INSERT INTO service_catalog.tenant_access(tenant_id,enabled,grant_reason) VALUES($1,$2,'Fixture OPS004 isolada')",
      [tenant, tenant === tenantA],
    );
  }
  await db.query(
    "INSERT INTO horse_power.users(id,name,email,password_hash) VALUES($1,'Colaborador Fictício OPS004',$2,$3)",
    [id, email, hashPassword(password)],
  );
  for (const [tenant, profile] of [
    [tenantA, "finance"],
    [tenantB, "mechanic"],
  ]) {
    await db.query(
      "INSERT INTO horse_power.memberships(user_id,tenant_id,role) VALUES($1,$2,'operator')",
      [id, tenant],
    );
    await db.query(
      "INSERT INTO horse_power.workshop_user_access(tenant_id,user_id,profile,permissions) VALUES($1,$2,$3,$4)",
      [
        tenant,
        id,
        profile,
        JSON.stringify({
          "personal.contact": false,
          "personal.email": false,
          "personal.address": false,
        }),
      ],
    );
  }
  await db.query(
    "INSERT INTO horse_power.customers(id,tenant_id,name,email) VALUES($1,$2,'Cliente Fictício OPS004','cliente-ficticio@example.test')",
    [customer, tenantA],
  );
  await db.query(
    "INSERT INTO horse_power.vehicles(id,tenant_id,customer_id,plate,brand,model,year,model_year) VALUES($1,$2,$3,'OPS0A04','Marca Fictícia','Modelo Fictício',2024,2025)",
    [vehicle, tenantA, customer],
  );
  await db.query(
    "INSERT INTO horse_power.catalog(id,tenant_id,kind,name,sku,cost,price,stock) VALUES($1,$2,'product','Peça Fictícia OPS004','OPS004-UI',1000,10000,10)",
    [product, tenantA],
  );
  await db.query(
    "INSERT INTO horse_power.orders(id,tenant_id,number,status,kind,customer_id,vehicle_id,entered_on,due_on,km,total) VALUES($1,$2,1,'open','order',$3,$4,'2026-11-13','2026-11-14',0,10000)",
    [order, tenantA, customer, vehicle],
  );
  await db.query(
    "INSERT INTO horse_power.order_items(id,tenant_id,order_id,catalog_id,kind,name,quantity,price,cost) VALUES($1,$2,$3,$4,'product','Peça Fictícia OPS004',1,10000,1000)",
    [randomUUID(), tenantA, order, product],
  );
  await db.query("COMMIT");
  let inviteToken = "";
  const app = await createLocalDatabase();
  try {
    await app.withRequestContext!(
      { "app.tenant_id": tenantA, "app.user_id": ownerA },
      async () => {
        await createUserInvite(
          app,
          {
            tenantId: tenantA,
            userId: ownerA,
            role: "owner",
            modules: { ...defaultWorkshopModules },
          },
          { email: activationEmail, profile: "mechanic", order_scope: "assigned" },
          "",
          async (i) => {
            inviteToken = i.token;
          },
        );
      },
    );
  } finally {
    await app.close();
  }
  // Never upload this private identity file as a CI artifact.
  writeFileSync(
    resolve(process.env.RUNNER_TEMP || "/tmp", "ops004-ui-identity.json"),
    JSON.stringify({
      email,
      password,
      inviteToken,
      activationEmail,
      ownerEmail,
      ownerPassword,
      tenantA,
      tenantB,
    }),
    { mode: 0o600 },
  );
} catch (error) {
  await db.query("ROLLBACK");
  throw error;
} finally {
  await db.end();
}
