import assert from "node:assert/strict";
import test from "node:test";
import { commercialLiveBilling, commercialPublicSignup } from "../server/osdriveCommercial.js";
import { createStripeGateway, verifiedStripeEvent } from "../server/services/stripeGateway.js";
import { invitationEmail } from "../server/services/invitationEmail.js";
import { createHmac } from "node:crypto";

const commercial = {
  VERCEL_PROJECT_ID: "prj_2VoHx0Sja7OSsWAzhMA1Ww3ZLrza",
  VERCEL_ENV: "production",
  EXPECTED_DATABASE_PROJECT: "fbsydwogucicfjwwbtts",
  APP_ORIGIN: "https://osdrive.com.br",
  OSDRIVE_COMMERCIAL_RESEND_KEY: "fixture",
};

test("public signup and live billing require independent opt-ins in the commercial project", () => {
  assert.equal(commercialPublicSignup(commercial), false);
  assert.equal(commercialLiveBilling(commercial), false);
  const signup = { ...commercial, OSDRIVE_PUBLIC_SIGNUP_ENABLED: "true" };
  assert.equal(commercialPublicSignup(signup), true);
  assert.equal(commercialLiveBilling(signup), false);
  const live = { ...commercial, OSDRIVE_LIVE_BILLING_ENABLED: "true" };
  assert.equal(commercialLiveBilling(live), true);
  assert.equal(commercialPublicSignup(live), false);
  const both = { ...signup, OSDRIVE_LIVE_BILLING_ENABLED: "true" };
  for (const mismatch of [{ VERCEL_ENV: "preview" }, { VERCEL_PROJECT_ID: "other" }, { EXPECTED_DATABASE_PROJECT: "other" }, { APP_ORIGIN: "https://other.example" }]) {
    assert.equal(commercialPublicSignup({ ...both, ...mismatch }), false);
    assert.equal(commercialLiveBilling({ ...both, ...mismatch }), false);
  }
});

test("Stripe rejects keys, responses and signed webhooks from the opposite mode", async () => {
  assert.throws(() => createStripeGateway("rk_live_Fictional"));
  assert.throws(() => createStripeGateway("rk_test_Fictional", fetch, true));
  const live = createStripeGateway("rk_live_Fictional", async () => Response.json({ id: "cus_Fictional", livemode: false }), true);
  await assert.rejects(live("/customers/cus_Fictional"));
  const now = Date.now(), timestamp = Math.floor(now / 1000), secret = "whsec_fixture";
  for (const testMode of [true, false]) {
    const raw = Buffer.from(JSON.stringify({id:"evt_fixture", type:"invoice.paid", livemode:!testMode, data:{object:{id:"in_fixture"}}}));
    const signature = createHmac("sha256", secret).update(timestamp + ".").update(raw).digest("hex");
    assert.equal(verifiedStripeEvent(raw, `t=${timestamp},v1=${signature}`, secret, now, !testMode).livemode, !testMode);
    assert.throws(() => verifiedStripeEvent(raw, `t=${timestamp},v1=${signature}`, secret, now, testMode));
  }
});

test("branded invitations escape workshop names and include the same action in both formats", () => {
  const url = new URL("https://osdrive.com.br/aceitar-convite#ficticio");
  const mail = invitationEmail({ title:"Convite", workshopName:"Oficina <Teste>", instructions:"Use sua conta.", action:"Aceitar", url, expiry:"48 horas" });
  assert.ok(mail.html.includes("Oficina &lt;Teste&gt;"));
  assert.ok(mail.html.includes("osdrive-logo-transparent.png"));
  assert.ok(mail.html.includes(url.href) && mail.text.includes(url.href));
  assert.ok(mail.text.includes("48 horas"));
});
