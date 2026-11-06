import test from "node:test";
import assert from "node:assert/strict";
import { assertDevelopmentIsolation } from "../server/developmentIsolation.js";
test("Stripe Preview requires dedicated connections in the same staging project", () => {
  const origin = "https://billing-preview.vercel.app";
  const project = "vnclahdnirqlcbamodqy";
  const connection = (user: string) => `postgresql://${user}.${project}@aws-1-ca-central-1.pooler.supabase.com:6543/postgres`;
  const env = { APP_ENV: "development", EXPECTED_DATABASE_PROJECT: project, APP_ORIGIN: origin, APP_ORIGINS: origin,
    VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "feat/admin-billing-stripe",
    DATABASE_URL: connection("hp_stripe_preview_app"), PLATFORM_ADMIN_DATABASE_URL: connection("hp_stripe_preview_admin") };
  assert.doesNotThrow(() => assertDevelopmentIsolation(env));
  for (const change of [{ VERCEL_ENV: "production" }, { VERCEL_GIT_COMMIT_REF: "main" },
    { EXPECTED_DATABASE_PROJECT: "other" }, { DATABASE_URL: connection("horse_power_app") },
    { PLATFORM_ADMIN_DATABASE_URL: connection("hp_platform_admin_app") },
    { PLATFORM_ADMIN_DATABASE_URL: connection("hp_stripe_preview_admin").replace(project, "other") }])
    assert.throws(() => assertDevelopmentIsolation({ ...env, ...change }));
});
