import test from "node:test";
import assert from "node:assert/strict";
import { sendWorkshopRetentionNotice } from "../server/services/workshopRetentionMail.js";

const notice = {
  tenantId: "8b32ca14-6042-43a7-a486-2383e57dfaae",
  workshopName: "Oficina <Fictícia>",
  email: "ficticia@example.test",
  coverageEnd: "2026-01-01",
  removalDate: "2026-04-01",
  daysLate: 89 as const,
};

test("aviso do dia 89 usa destinatário da oficina, texto seguro e chave idempotente", async () => {
  const calls: { headers: Headers; body: Record<string, unknown> }[] = [];
  const fetchImpl = async (_url: unknown, init: RequestInit) => {
    calls.push({ headers: new Headers(init.headers), body: JSON.parse(String(init.body)) });
    return new Response(null, { status: 200 });
  };
  const config = { apiKey: "chave-ficticia", from: "OSDrive <noreply@osdrive.com.br>", origin: "https://sistema-oficinas-homologacao.vercel.app/", fetchImpl: fetchImpl as typeof fetch };
  await sendWorkshopRetentionNotice(notice, config);
  await sendWorkshopRetentionNotice(notice, config);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].body.to, [notice.email]);
  assert.match(String(calls[0].body.text), /15 dias/);
  assert.match(String(calls[0].body.html), /&lt;Fictícia&gt;/);
  assert.equal(calls[0].headers.get("Idempotency-Key"), calls[1].headers.get("Idempotency-Key"));
  assert.ok(!JSON.stringify(calls[0].body).includes("chave-ficticia"));
});

test("falha do provedor e dados inválidos interrompem o aviso", async () => {
  const config = { apiKey: "chave-ficticia", from: "noreply@osdrive.com.br", origin: "https://sistema-oficinas-homologacao.vercel.app/", fetchImpl: (async () => new Response(null, { status: 503 })) as typeof fetch };
  await assert.rejects(sendWorkshopRetentionNotice(notice, config), /Falha/);
  await assert.rejects(sendWorkshopRetentionNotice({ ...notice, email: "invalido" }, config), /inválido/);
  await assert.rejects(sendWorkshopRetentionNotice(notice, { ...config, origin: "http://inseguro.example.test/" }), /Origem/);
});
