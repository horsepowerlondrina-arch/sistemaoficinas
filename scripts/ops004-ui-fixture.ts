import { randomBytes, randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { adminClient } from "./local-admin";
import { createLocalDatabase } from "../server/db/local";
import { createUserInvite } from "../server/services/workshopUsers";
import { defaultWorkshopModules } from "../shared/workshopModules";
import { hashPassword } from "../server/auth/session";

// adminClient refuses remote hosts and production; this identity exists only in
// the disposable fictional database used by the UI regression.
const db = adminClient();
await db.connect();
try {
  const id = randomUUID(),
    password = randomBytes(24).toString("base64url");
  const email = "ops004-colaborador-ui@example.test",
    activationEmail = "ops004-ativacao-ui@example.test";
  await db.query("BEGIN");
  await db.query(
    "INSERT INTO horse_power.users(id,name,email,password_hash) VALUES($1,'Colaborador Fictício OPS004',$2,$3)",
    [id, email, hashPassword(password)],
  );
  for (const [tenant, profile] of [
    ["local-a", "finance"],
    ["local-b", "mechanic"],
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
  const product = randomUUID(),
    order = randomUUID();
  await db.query(
    "INSERT INTO horse_power.catalog(id,tenant_id,kind,name,sku,cost,price,stock) VALUES($1,'local-a','product','Peça Fictícia OPS004','OPS004-UI',1000,10000,10)",
    [product],
  );
  await db.query(
    "INSERT INTO horse_power.orders(id,tenant_id,number,status,kind,customer_id,vehicle_id,entered_on,due_on,km,total) VALUES($1,'local-a',(SELECT coalesce(max(number),0)+1 FROM horse_power.orders WHERE tenant_id='local-a'),'open','order','local-a-customer','local-a-vehicle','2026-11-13','2026-11-14',0,10000)",
    [order],
  );
  await db.query(
    "INSERT INTO horse_power.order_items(id,tenant_id,order_id,catalog_id,kind,name,quantity,price,cost) VALUES($1,'local-a',$2,$3,'product','Peça Fictícia OPS004',1,10000,1000)",
    [randomUUID(), order, product],
  );
  await db.query("COMMIT");
  let inviteToken = "";
  const app = await createLocalDatabase();
  try {
    await app.withRequestContext!(
      { "app.tenant_id": "local-a", "app.user_id": "local-owner-a" },
      async () => {
        await createUserInvite(
          app,
          {
            tenantId: "local-a",
            userId: "local-owner-a",
            role: "owner",
            modules: { ...defaultWorkshopModules },
          },
          {
            email: activationEmail,
            profile: "mechanic",
          },
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
  // Keep credentials outside every uploaded screenshot directory and repository.
  writeFileSync(
    resolve(process.env.RUNNER_TEMP || "/tmp", "ops004-ui-identity.json"),
    JSON.stringify({ email, password, inviteToken, activationEmail }),
    { mode: 0o600 },
  );
} catch (error) {
  await db.query("ROLLBACK");
  throw error;
} finally {
  await db.end();
}
