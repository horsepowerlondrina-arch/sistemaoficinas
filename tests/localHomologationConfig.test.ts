import test from "node:test";
import assert from "node:assert/strict";
import {
  configureLocalHomologation,
  assertLocalHomologation,
  homologationConnection,
  localPorts,
} from "../server/localHomologationConfig.js";
import { assertDevelopmentIsolation } from "../server/developmentIsolation.js";
const project = "vnclahdnirqlcbamodqy";
function credentials() {
  return {
    DATABASE_URL: `postgresql://horse_power_app.${project}:fictional@aws-0-sa-east-1.pooler.supabase.com:6543/postgres`,
    PLATFORM_ADMIN_DATABASE_URL: `postgresql://hp_platform_admin_app.${project}:fictional@aws-0-sa-east-1.pooler.supabase.com:6543/postgres`,
    PLATFORM_ADMIN_TOTP_ENCRYPTION_KEY: "a".repeat(64),
  };
}
test("INF-010 accepts only scoped homologation and preserves separate admin MFA", () => {
  const env = credentials();
  configureLocalHomologation(env);
  assert.doesNotThrow(() => assertDevelopmentIsolation(env));
  assert.equal(env.PLATFORM_ADMIN_TOTP_ENCRYPTION_KEY, "a".repeat(64));
});
test("INF-010 rejects production, role confusion, malicious URL options and privileged logins", () => {
  const good = credentials().DATABASE_URL;
  for (const value of [
    good.replace(project, "rvlovjpquozbrsszsxwe"),
    good.replace(project, "cbdwgocofigrdigfgwkp"),
    good.replace("horse_power_app.", "postgres."),
    good + "?sslmode=disable",
    good.replace("/postgres", "/other"),
    good.replace(
      "aws-0-sa-east-1.pooler.supabase.com",
      "evil.pooler.supabase.com.evil.test",
    ),
  ])
    assert.throws(() => homologationConnection(value, "horse_power_app"));
  const env = credentials();
  configureLocalHomologation(env);
  for (const overrides of [
    { VERCEL: "1" },
    { NODE_ENV: "production" },
    { PGOPTIONS: "-c role=postgres" },
    { APP_ORIGIN: "https://osdrive.com.br" },
    { PLATFORM_ADMIN_DATABASE_URL: env.DATABASE_URL },
    { PLATFORM_ADMIN_TOTP_ENCRYPTION_KEY: "" },
  ])
    assert.throws(() => assertLocalHomologation({ ...env, ...overrides }));
});
test("INF-010 separate slots and custom ports never bind a public interface", () => {
  assert.deepEqual(localPorts({ DEV_SLOT: "2" }), {
    web: 5174,
    api: 3011,
    slot: "2",
  });
  assert.deepEqual(localPorts({ DEV_WEB_PORT: "6000", DEV_API_PORT: "6001" }), {
    web: 6000,
    api: 6001,
    slot: "1",
  });
  for (const env of [
    { DEV_SLOT: "3" },
    { DEV_WEB_PORT: "80" },
    { DEV_WEB_PORT: "5173", DEV_API_PORT: "5173" },
    { DEV_API_PORT: "NaN" },
  ])
    assert.throws(() => localPorts(env));
});
test("INF-010 strips payment/mail/provider credentials and old MFA bypass", () => {
  const env: Record<string, string> = {
    ...credentials(),
    STRIPE_SECRET_KEY: "sk_live_fake",
    STRIPE_BILLING_ENABLED: "true",
    RESEND_API_KEY: "fake",
    FIPEPLACA_PLATFORM_TOKEN: "fake",
    PLATFORM_ADMIN_TEST_MFA_BYPASS_EMAIL: "fake",
    CRON_SECRET: "fake",
  };
  configureLocalHomologation(env);
  for (const key of [
    "STRIPE_SECRET_KEY",
    "STRIPE_BILLING_ENABLED",
    "RESEND_API_KEY",
    "FIPEPLACA_PLATFORM_TOKEN",
    "PLATFORM_ADMIN_TEST_MFA_BYPASS_EMAIL",
    "CRON_SECRET",
  ])
    assert.equal(env[key], undefined);
  assert.equal(env.ENABLE_PAID_VEHICLE_LOOKUP, "false");
});
