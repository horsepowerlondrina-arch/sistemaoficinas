import { stripeBillingService } from "./services/stripeBilling.js";
import { createStripeGateway } from "./services/stripeGateway.js";
import { stripePublicRoutes } from "./stripeBillingRoutes.js";
import { createApp } from "./app.js";
import { createPostgresDatabase } from "./db/postgres.js";
import pg from "pg";
import { assertDevelopmentIsolation } from "./developmentIsolation.js";
import { assertPlatformAdminDatabase, createPlatformAdminApp } from "./platformAdminApp.js";
import { createPlatformAdminDataTransfer } from "./services/platformAdminDataTransfer.js";
import { readFileSync } from "node:fs";
assertDevelopmentIsolation(process.env);
const productionHost = process.env.VERCEL_PROJECT_PRODUCTION_URL;
if (!process.env.APP_ORIGIN && productionHost)
  process.env.APP_ORIGIN = `https://${productionHost}`;
if (!process.env.PUBLIC_ORIGIN)
  process.env.PUBLIC_ORIGIN = process.env.APP_ORIGIN;
if (!process.env.APP_ORIGIN) throw new Error("Configure APP_ORIGIN.");
const db = createPostgresDatabase();
const adminKey = process.env.PLATFORM_ADMIN_TOTP_ENCRYPTION_KEY || "";
if (!/^[a-f0-9]{64}$/i.test(adminKey))
  throw new Error("A chave MFA da administração central não está configurada.");
const adminUrl = process.env.PLATFORM_ADMIN_DATABASE_URL;
if (!adminUrl) throw new Error("A conexão isolada da administração central não está configurada.");
const adminPool = new pg.Pool({
  connectionString: adminUrl,
  max: 2,
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 20000,
  query_timeout: 15000,
  ssl: { rejectUnauthorized: true, ca: readFileSync(new URL("./db/certs/supabase-ca.crt", import.meta.url), "utf8") },
});
await assertPlatformAdminDatabase(adminPool);
const transfer = createPlatformAdminDataTransfer(db, adminPool);
const billing = process.env.STRIPE_BILLING_ENABLED === "true"
 ? stripeBillingService(adminPool,createStripeGateway(process.env.STRIPE_SECRET_KEY||""),process.env.APP_ORIGIN!, (process.env.STRIPE_TEST_TENANT_IDS||"").split(",").map(v=>v.trim()).filter(Boolean)) : undefined;
if (billing && !process.env.STRIPE_WEBHOOK_SECRET?.startsWith("whsec_")) throw new Error("Configure o webhook Stripe de teste.");
const app = createApp(db, createPlatformAdminApp(adminPool, adminKey, transfer,billing),{},billing,
 billing?stripePublicRoutes(billing,process.env.STRIPE_WEBHOOK_SECRET!,process.env.STRIPE_CRON_SECRET||"",process.env.CRON_SECRET):undefined);
export default app;
