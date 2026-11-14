import { isCloudflareHomologation, isCloudflareDatabaseRole } from "./cloudflarePolicy.js";
import { URL as NodeURL } from "node:url";
import {
  integrationFailureRecorder,
  observeIntegration,
} from "./services/integrationMonitoring.js";
import { stripeBillingService } from "./services/stripeBilling.js";
import { createStripeGateway } from "./services/stripeGateway.js";
import { stripePublicRoutes } from "./stripeBillingRoutes.js";
import { createApp } from "./app.js";
import { createPostgresDatabase } from "./db/postgres.js";
import pg from "pg";
import { assertDevelopmentIsolation } from "./developmentIsolation.js";
import { assertHorsePowerIsolation } from "./horsePowerIsolation.js";
import {
  assertPlatformAdminDatabase,
  createPlatformAdminApp,
} from "./platformAdminApp.js";
import { createPlatformAdminDataTransfer } from "./services/platformAdminDataTransfer.js";
import { readFileSync } from "node:fs";
import { selfServiceTestEmails } from "./services/selfServicePolicy.js";
export async function createCloudRuntime(options: { ca?: string; onStage?: (stage: string) => void } = {}) {
  const standaloneHorsePower = process.env.APP_ENV === "horse_power";
  if (standaloneHorsePower) assertHorsePowerIsolation(process.env);
  else assertDevelopmentIsolation(process.env);
  const productionHost = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (!process.env.APP_ORIGIN && productionHost)
    process.env.APP_ORIGIN = `https://${productionHost}`;
  if (!process.env.PUBLIC_ORIGIN)
    process.env.PUBLIC_ORIGIN = process.env.APP_ORIGIN;
  if (!process.env.APP_ORIGIN) throw new Error("Configure APP_ORIGIN.");
  options.onStage?.("operational_pool");
  const db = createPostgresDatabase(process.env.DATABASE_URL, { ca: options.ca });
  let app: ReturnType<typeof createApp>;
  let adminPoolForClose: pg.Pool | undefined;
  try {
    if (process.env.LOCAL_HOMOLOGATION === "true" || isCloudflareHomologation(process.env)) {
      options.onStage?.("operational_role");
      const role = await db
        .prepare(
          "SELECT current_user AS name, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb,pg_has_role(current_user,'horse_power_app','MEMBER') AS expected_group FROM pg_roles WHERE rolname=current_user",
        )
        .get();
      if (
        !role ||
        !(isCloudflareHomologation(process.env) ? isCloudflareDatabaseRole(role.name,"horse_power_app") && role.expected_group : role.name === "horse_power_app") ||
        role.rolsuper ||
        role.rolbypassrls ||
        role.rolcreaterole ||
        role.rolcreatedb
      )
        throw new Error("A conexão operacional exige papel restrito com RLS.");
    }
    if (standaloneHorsePower) {
      // The definitive Horse Power site has no central administration or billing routes.
      options.onStage?.("application");
      app = createApp(db);
    } else {
      const adminKey = process.env.PLATFORM_ADMIN_TOTP_ENCRYPTION_KEY || "";
      if (!/^[a-f0-9]{64}$/i.test(adminKey))
        throw new Error(
          "A chave MFA da administração central não está configurada.",
        );
      const adminUrl = process.env.PLATFORM_ADMIN_DATABASE_URL;
      if (!adminUrl)
        throw new Error(
          "A conexão isolada da administração central não está configurada.",
        );
      options.onStage?.("administrative_pool");
      const adminPool = new pg.Pool({
        connectionString: adminUrl,
        max: 2,
        connectionTimeoutMillis: 10000,
        idleTimeoutMillis: 20000,
        query_timeout: 15000,
        ssl: {
          rejectUnauthorized: true,
          ca: options.ca ?? readFileSync(
            new NodeURL("./db/certs/supabase-ca.crt", import.meta.url),
            "utf8",
          ),
        },
      });
      adminPoolForClose = adminPool;
      options.onStage?.("administrative_role");
      await assertPlatformAdminDatabase(adminPool);
      const transfer = createPlatformAdminDataTransfer(db, adminPool);
      const recordFailure = integrationFailureRecorder(adminPool);
      const stripeRequest =
        process.env.STRIPE_BILLING_ENABLED === "true"
          ? createStripeGateway(process.env.STRIPE_SECRET_KEY || "")
          : undefined;
      const billing =
        process.env.STRIPE_BILLING_ENABLED === "true"
          ? stripeBillingService(
              adminPool,
              (...args) =>
                observeIntegration("stripe", recordFailure, () =>
                  stripeRequest!(...args),
                ),
              process.env.APP_ORIGIN!,
              (process.env.STRIPE_TEST_TENANT_IDS || "")
                .split(",")
                .map((v) => v.trim())
                .filter(Boolean),
              selfServiceTestEmails(),
            )
          : undefined;
      if (billing && !process.env.STRIPE_WEBHOOK_SECRET?.startsWith("whsec_"))
        throw new Error("Configure o webhook Stripe de teste.");
      options.onStage?.("application");
      app = createApp(
        db,
        createPlatformAdminApp(adminPool, adminKey, transfer, billing),
        {},
        billing,
        billing
          ? stripePublicRoutes(
              billing,
              process.env.STRIPE_WEBHOOK_SECRET!,
              process.env.STRIPE_CRON_SECRET || "",
              process.env.CRON_SECRET,
            )
          : undefined,
        recordFailure,
      );
    }
    return {
      app,
      close: async () => {
        await db.close();
        if (adminPoolForClose) await adminPoolForClose.end();
      },
    };
  } catch (error) {
    await db.close();
    if (adminPoolForClose) await adminPoolForClose.end();
    throw error;
  }
}
