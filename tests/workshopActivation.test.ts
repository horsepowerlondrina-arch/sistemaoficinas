import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  newWorkshopActivationToken,
  workshopActivationTtlHours,
  sendWorkshopActivationEmail,
  workshopActivationUrl,
} from "../server/services/workshopActivation.js";

test("new activation invitations expire after 48 hours", () => {
  assert.equal(workshopActivationTtlHours,48);
});

test("workshop activation links use a 256-bit token in the URL fragment", () => {
  const token = newWorkshopActivationToken();
  assert.match(token, /^[a-f0-9]{64}$/);
  assert.equal(createHash("sha256").update(token).digest("hex").length, 64);
  assert.equal(workshopActivationUrl("https://sistema.example", token), `https://sistema.example/ativar-oficina#${token}`);
  assert.equal(workshopActivationUrl("http://127.0.0.1:5173", token), `http://127.0.0.1:5173/ativar-oficina#${token}`);
  assert.throws(() => workshopActivationUrl("http://sistema.example", token), /activation_origin_invalid/);
  assert.throws(() => workshopActivationUrl("https://user:pass@sistema.example", token), /activation_origin_invalid/);
});

test("Resend message escapes workshop input and uses a stable idempotency key", async () => {
  let request: RequestInit | undefined;
  const result = await sendWorkshopActivationEmail({
    inviteId: "invite-1", token: "a".repeat(64), email: "owner@example.test",
    workshopName: "<Oficina & Exemplo>", expiresAt: new Date("2026-10-27T12:00:00Z"),
  }, {
    apiKey: "not-a-real-key", from: "Sistema <teste@example.test>", appOrigin: "https://sistema.example",
    fetchImpl: async (_input, init) => {
      request = init;
      return new Response(JSON.stringify({ id: "mail-1" }), { status: 200 });
    },
  });
  assert.equal(result.tokenHash, createHash("sha256").update("a".repeat(64)).digest("hex"));
  assert.equal(new Headers(request?.headers).get("Idempotency-Key"), "workshop-activation/invite-1");
  const body = JSON.parse(String(request?.body));
  assert.equal(body.to[0], "owner@example.test");
  assert.match(body.html, /&lt;Oficina &amp; Exemplo&gt;/);
  assert.match(body.html, /\/ativar-oficina#aaaaaaaa/);
});

test("missing email configuration or provider errors fail without exposing provider details", async () => {
  const input = { inviteId: "invite-2", token: "b".repeat(64), email: "owner@example.test", workshopName: "Oficina Teste", expiresAt: new Date() };
  let calls = 0;
  await assert.rejects(sendWorkshopActivationEmail(input, { fetchImpl: async () => { calls++; return new Response(); } }), /activation_mail_not_configured/);
  assert.equal(calls, 0);
  await assert.rejects(sendWorkshopActivationEmail(input, {
    apiKey: "key", from: "Sistema <teste@example.test>", appOrigin: "https://sistema.example",
    fetchImpl: async () => new Response("secret provider response", { status: 403 }),
  }), /activation_mail_delivery_failed/);
});
