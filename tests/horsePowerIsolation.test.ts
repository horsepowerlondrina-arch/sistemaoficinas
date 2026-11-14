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

test("preview de login aceita somente o host exato e o banco do projeto definitivo", () => {
  const ref = "rvlovjpquozbrsszsxwe";
  const host = "horse-power-definitivo-example-horse-power2.vercel.app";
  const preview = { ...env, VERCEL: "1", VERCEL_ENV: "preview", VERCEL_URL: host,
    VERCEL_PROJECT_ID: "prj_RJGlxZbbO3Wl4Vm3CdreT60G3FST", EXPECTED_DATABASE_PROJECT: ref,
    DATABASE_URL: `postgresql://hp_definitivo_app_login.${ref}:fixture@aws-1-ca-central-1.pooler.supabase.com:6543/postgres`,
    APP_ORIGIN: `https://${host}`, APP_ORIGINS: `https://${host}`, PUBLIC_ORIGIN: `https://${host}`,
  };
  assert.doesNotThrow(() => assertHorsePowerIsolation(preview));
  for (const patch of [
    { VERCEL_ENV: "production" }, { VERCEL_PROJECT_ID: "outro" }, { VERCEL_URL: host + ".example.org" },
    { APP_ORIGINS: "*" }, { EXPECTED_DATABASE_PROJECT: "vnclahdnirqlcbamodqy" },
    { DATABASE_URL: preview.DATABASE_URL.replace("hp_definitivo_app_login", "postgres") },
  ]) assert.throws(() => assertHorsePowerIsolation({ ...preview, ...patch }));
});
