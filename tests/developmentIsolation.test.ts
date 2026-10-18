import test from "node:test";
import assert from "node:assert/strict";
import { assertDevelopmentIsolation } from "../server/developmentIsolation";
const env = {
  APP_ENV: "development", EXPECTED_DATABASE_PROJECT: "testproject",
  DATABASE_URL: "postgresql://horse_power_app.testproject:fake@aws-1-ca-central-1.pooler.supabase.com:6543/postgres",
  APP_ORIGIN: "https://hpdesenvolvimento.vercel.app",
  APP_ORIGINS: "https://hpdesenvolvimento.vercel.app",
  PUBLIC_ORIGIN: "https://hpdesenvolvimento.vercel.app",
};
test("development accepts only its configured database and own origin", () => {
  assert.doesNotThrow(() => assertDevelopmentIsolation(env));
  for (const patch of [
    { APP_ENV: "production" },
    { EXPECTED_DATABASE_PROJECT: "cbdwgocofigrdigfgwkp" },
    { DATABASE_URL: "postgresql://horse_power_app.cbdwgocofigrdigfgwkp:fake@aws-1-ca-central-1.pooler.supabase.com:6543/postgres" },
    { APP_ORIGIN: "https://horse-power.vercel.app" },
    { PUBLIC_ORIGIN: "https://horse-power.vercel.app" },
    { FIPEPLACA_TOKENS_JSON: '{"hp-centro":"production-secret"}' },
  ]) assert.throws(() => assertDevelopmentIsolation({ ...env, ...patch }));
});
