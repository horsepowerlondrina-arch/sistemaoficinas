import test from "node:test";
import assert from "node:assert/strict";
import { assertOsdriveCommercial } from "../server/osdriveCommercial.js";
test("comercial recusa conexões cruzadas, preview, e-mail real e Stripe live", () => {
  const origin = "https://osdrive.com.br";
  const connection = (role: string) => "postgresql://" + role + ".fbsydwogucicfjwwbtts:fake@aws-0-us-east-1.pooler.supabase.com:6543/postgres";
  const env = { VERCEL_PROJECT_ID:"prj_2VoHx0Sja7OSsWAzhMA1Ww3ZLrza", VERCEL_ENV:"production", APP_ORIGIN:origin, PUBLIC_ORIGIN:origin, APP_ORIGINS:origin, DATABASE_URL:connection("horse_power_app"), PLATFORM_ADMIN_DATABASE_URL:connection("hp_platform_admin_app") };
  assert.doesNotThrow(() => assertOsdriveCommercial(env));
  for (const change of [{ DATABASE_URL:env.DATABASE_URL.replace("fbsydwogucicfjwwbtts","vnclahdnirqlcbamodqy") }, { PLATFORM_ADMIN_DATABASE_URL:env.DATABASE_URL }, { VERCEL_PROJECT_ID:"other" }, { VERCEL_ENV:"preview" }, { APP_ORIGIN:"https://other.example" }, { STRIPE_SECRET_KEY:"sk_live_fake" }, { RESEND_API_KEY:"fake" }])
    assert.throws(() => assertOsdriveCommercial({...env,...change}));
});
