import test from "node:test";
import assert from "node:assert/strict";
import { sendWorkshopActivationEmail } from "../server/services/workshopActivation.js";

test("convite comercial usa chave exclusiva e apenas a caixa de validação", async () => {
  const oldEnv = process.env;
  process.env = { ...oldEnv, APP_ENV: "osdrive_comercial", OSDRIVE_TEST_INVITE_KEY: "pilot-test" };
  try {
    const email = "validacao-comercial@testes.osdrive.com.br";
    const input = { email, workshopName: "Teste", inviteId: "fake", token: "test", expiresAt: new Date() };
    let calls = 0;
    const config = { from: "OSDrive <noreply@osdrive.com.br>", appOrigin: "https://osdrive.com.br", fetchImpl: async (_url: RequestInfo | URL, init?: RequestInit) => {
      calls++;
      assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer pilot-test");
      assert.deepEqual(JSON.parse(String(init?.body)).to, [email]);
      return new Response("{}", { status: 200 });
    } };
    await assert.rejects(sendWorkshopActivationEmail({...input,email:"outra@testes.osdrive.com.br"},config), /recipient_not_allowed/);
    assert.equal(calls,0);
    await sendWorkshopActivationEmail(input,config);
    assert.equal(calls,1);
  } finally { process.env = oldEnv; }
});
