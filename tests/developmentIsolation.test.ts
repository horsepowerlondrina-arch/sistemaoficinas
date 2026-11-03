import test from "node:test";
import assert from "node:assert/strict";
import { assertDevelopmentIsolation } from "../server/developmentIsolation";
const env = {
  APP_ENV: "development",
  EXPECTED_DATABASE_PROJECT: "testproject",
  DATABASE_URL:
    "postgresql://horse_power_app.testproject:fake@aws-1-ca-central-1.pooler.supabase.com:6543/postgres",
  APP_ORIGIN: "https://hpdesenvolvimento-horse-power2.vercel.app",
  APP_ORIGINS: "https://hpdesenvolvimento-horse-power2.vercel.app",
  PUBLIC_ORIGIN: "https://hpdesenvolvimento-horse-power2.vercel.app",
};
test("development accepts only its configured database and own origin", () => {
  assert.doesNotThrow(() => assertDevelopmentIsolation(env));
  assert.doesNotThrow(() =>
    assertDevelopmentIsolation({
      ...env,
      ENABLE_PAID_VEHICLE_LOOKUP: "true",
      FIPEPLACA_TOKENS_JSON: '{"hp-centro":"test-key"}',
    }),
  );
  for (const patch of [
    { APP_ENV: "production" },
    { EXPECTED_DATABASE_PROJECT: "cbdwgocofigrdigfgwkp" },
    {
      DATABASE_URL:
        "postgresql://postgres.fake-password@db.testproject.supabase.co:5432/postgres",
    },
    {
      DATABASE_URL:
        "postgresql://horse_power_app.cbdwgocofigrdigfgwkp:fake@aws-1-ca-central-1.pooler.supabase.com:6543/postgres",
    },
    {
      DATABASE_URL:
        "postgresql://horse_power_app.testproject:fake@aws-1-ca-central-1.pooler.supabase.com:5432/postgres",
    },
    { APP_ORIGIN: "https://horse-power.vercel.app" },
    { PUBLIC_ORIGIN: "https://horse-power.vercel.app" },
    { FIPEPLACA_TOKENS_JSON: '{"hp-centro":"production-secret"}' },
  ])
    assert.throws(() => assertDevelopmentIsolation({ ...env, ...patch }));
});

test("OSDrive homologation accepts only the configured custom and Vercel origins", () => {
  const custom = {
    ...env,
    EXPECTED_DATABASE_PROJECT: "vnclahdnirqlcbamodqy",
    DATABASE_URL:
      "postgresql://horse_power_app.vnclahdnirqlcbamodqy:fake@aws-1-ca-central-1.pooler.supabase.com:6543/postgres",
    APP_ORIGIN: "https://osdrive.com.br",
    APP_ORIGINS:
      "https://osdrive.com.br,https://sistema-oficinas-homologacao.vercel.app",
    PUBLIC_ORIGIN: undefined,
  };
  assert.doesNotThrow(() => assertDevelopmentIsolation(custom));
  assert.doesNotThrow(() =>
    assertDevelopmentIsolation({ ...custom, PUBLIC_ORIGIN: custom.APP_ORIGIN }),
  );
  for (const patch of [
    { EXPECTED_DATABASE_PROJECT: "testproject" },
    { APP_ORIGINS: "https://osdrive.com.br" },
    { APP_ORIGINS: custom.APP_ORIGINS + ",https://horse-power.vercel.app" },
    { APP_ORIGIN: "https://other.example.com" },
    { PUBLIC_ORIGIN: "https://horse-power.vercel.app" },
  ])
    assert.throws(() => assertDevelopmentIsolation({ ...custom, ...patch }));
});
