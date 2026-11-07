import test from "node:test";
import assert from "node:assert/strict";
import { assertHorsePowerIsolation } from "../server/horsePowerIsolation";

const project = "abcdefghijklmnopqrst";
const env = {
  APP_ENV: "horse_power",
  EXPECTED_DATABASE_PROJECT: project,
  DATABASE_URL: `postgresql://horse_power_app.${project}:fixture@aws-1-ca-central-1.pooler.supabase.com:6543/postgres`,
  APP_ORIGIN: "https://oficinahorsepower.com.br",
  APP_ORIGINS: "https://oficinahorsepower.com.br",
  PUBLIC_ORIGIN: "https://oficinahorsepower.com.br",
};

test("Horse Power accepts only its definitive project and domain", () => {
  assert.doesNotThrow(() => assertHorsePowerIsolation(env));
  assert.doesNotThrow(() => assertHorsePowerIsolation({ ...env,
    DATABASE_URL: `postgresql://horse_power_app:fixture@db.${project}.supabase.co:5432/postgres`,
  }));
  for (const patch of [
    { APP_ENV: "development" },
    { EXPECTED_DATABASE_PROJECT: "vnclahdnirqlcbamodqy" },
    { EXPECTED_DATABASE_PROJECT: "cbdwgocofigrdigfgwkp" },
    { DATABASE_URL: "postgresql://horse_power_app.vnclahdnirqlcbamodqy:fixture@aws-1-ca-central-1.pooler.supabase.com:6543/postgres" },
    { DATABASE_URL: `postgresql://postgres.${project}:fixture@aws-1-ca-central-1.pooler.supabase.com:6543/postgres` },
    { APP_ORIGIN: "https://sistema-oficinas-homologacao.vercel.app" },
    { APP_ORIGINS: "https://oficinahorsepower.com.br,https://sistema-oficinas-homologacao.vercel.app" },
    { PUBLIC_ORIGIN: "https://osdrive.com.br" },
    { PLATFORM_ADMIN_DATABASE_URL: "configured" },
    { PLATFORM_ADMIN_TOTP_ENCRYPTION_KEY: "configured" },
    { STRIPE_BILLING_ENABLED: "true" },
    { VITE_PLATFORM_ADMIN_ENABLED: "true" },
  ]) assert.throws(() => assertHorsePowerIsolation({ ...env, ...patch }));
});
