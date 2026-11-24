import test from "node:test";
import assert from "node:assert/strict";
import { assertOsdriveCommercial, isCommercialPhotoCandidateRequest } from "../server/osdriveCommercial.js";
test("comercial recusa conexões cruzadas, preview, e-mail real e Stripe live", () => {
  const origin = "https://osdrive.com.br";
  const connection = (role: string) => "postgresql://" + role + ".fbsydwogucicfjwwbtts:fake@aws-0-us-east-1.pooler.supabase.com:6543/postgres";
  const env = { VERCEL_PROJECT_ID:"prj_2VoHx0Sja7OSsWAzhMA1Ww3ZLrza", VERCEL_ENV:"production", APP_ORIGIN:origin, PUBLIC_ORIGIN:origin, APP_ORIGINS:origin, DATABASE_URL:connection("horse_power_app"), PLATFORM_ADMIN_DATABASE_URL:connection("hp_platform_admin_app") };
  assert.doesNotThrow(() => assertOsdriveCommercial(env));
  for (const change of [{ DATABASE_URL:env.DATABASE_URL.replace("fbsydwogucicfjwwbtts","vnclahdnirqlcbamodqy") }, { PLATFORM_ADMIN_DATABASE_URL:env.DATABASE_URL }, { VERCEL_PROJECT_ID:"other" }, { VERCEL_ENV:"preview" }, { APP_ORIGIN:"https://other.example" }, { STRIPE_SECRET_KEY:"sk_live_fake" }, { RESEND_API_KEY:"fake" }])
    assert.throws(() => assertOsdriveCommercial({...env,...change}));
});

test("exceção de fotos exige o host do candidato e tem escopo e prazo limitados", () => {
  const host = "osdrive-comercial-candidate-osd-rive.vercel.app";
  const env = {
    VERCEL_PROJECT_ID: "prj_2VoHx0Sja7OSsWAzhMA1Ww3ZLrza",
    VERCEL_ENV: "production",
    EXPECTED_DATABASE_PROJECT: "fbsydwogucicfjwwbtts",
    APP_ORIGIN: "https://osdrive.com.br",
    VERCEL_URL: host,
    VERCEL_GIT_COMMIT_REF: "fix/osdrive-foto-origem-candidata",
    OSDRIVE_PHOTO_CANDIDATE_UNTIL: String(Date.now() + 60_000),
  };
  const request = { host, origin: `https://${host}`, method: "POST", path: "/login" };
  assert.ok(isCommercialPhotoCandidateRequest(env, request));
  assert.ok(isCommercialPhotoCandidateRequest(env, { ...request, path: "/checklists/test/photos" }));
  for (const change of [
    { host: "osdrive.com.br" }, { origin: "https://other.vercel.app" },
    { path: "/admin-api/login" }, { path: "/billing/checkout" }, { method: "PUT" },
  ]) assert.equal(isCommercialPhotoCandidateRequest(env, { ...request, ...change }), false);
  for (const change of [
    { VERCEL_GIT_COMMIT_REF: "main" }, { OSDRIVE_PHOTO_CANDIDATE_UNTIL: "0" },
    { VERCEL_PROJECT_ID: "other" }, { VERCEL_ENV: "preview" },
  ]) assert.equal(isCommercialPhotoCandidateRequest({ ...env, ...change }, request), false);
});
