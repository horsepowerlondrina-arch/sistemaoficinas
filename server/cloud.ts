import { createApp } from "./app.js";
import { createPostgresDatabase } from "./db/postgres.js";
import pg from "pg";
import { assertDevelopmentIsolation } from "./developmentIsolation.js";
import { assertPlatformAdminDatabase, createPlatformAdminApp } from "./platformAdminApp.js";
import { createPlatformAdminDataTransfer } from "./services/platformAdminDataTransfer.js";
import { createWorkshopBilling } from "./services/workshopBilling.js";
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
const billing = process.env.BILLING_CHECKOUT_ENABLED === "true"
  && process.env.MERCADO_PAGO_ACCESS_TOKEN
  && process.env.MERCADO_PAGO_WEBHOOK_SECRET
  && (process.env.VERCEL_ENV !== "preview" || process.env.BILLING_TEST_TENANT_ID)
  ? createWorkshopBilling(adminPool, {
      accessToken: process.env.MERCADO_PAGO_ACCESS_TOKEN,
      testTenantId: process.env.VERCEL_ENV === "preview"
        ? process.env.BILLING_TEST_TENANT_ID : undefined,
      testPriceCents: process.env.VERCEL_ENV === "preview" &&
        process.env.BILLING_TEST_TENANT_ID && process.env.BILLING_TEST_PRICE_CENTS
        ? Number(process.env.BILLING_TEST_PRICE_CENTS) : undefined,
      testPayerEmail: process.env.VERCEL_ENV === "preview" &&
        process.env.VERCEL_GIT_COMMIT_REF === "feat/admin-billing-mercadopago" &&
        process.env.BILLING_TEST_TENANT_ID
        ? process.env.BILLING_TEST_PAYER_EMAIL : undefined,
      returnOrigin: process.env.VERCEL_ENV === "preview" && process.env.VERCEL_BRANCH_URL
        ? `https://${process.env.VERCEL_BRANCH_URL}`
        : process.env.APP_ORIGIN!,
    })
  : undefined;
const app = createApp(db, createPlatformAdminApp(adminPool, adminKey, transfer), {}, billing);
export default app;
