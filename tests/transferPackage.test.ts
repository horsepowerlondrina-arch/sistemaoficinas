import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createTransferPayload,
  openTransferPackage,
  sealTransferPackage,
} from "../shared/transferPackage.js";

const passphrase = "teste-ficticio-transferencia-2026";

function sample() {
  return createTransferPayload("fixture", { id: "source-tenant", name: "Oficina Fictícia" }, {
    tenant: { id: "source-tenant", name: "Oficina Fictícia" },
    users: [{ id: "user-1", name: "Pessoa Fictícia", email: "pessoa@example.invalid" }],
    memberships: [{ user_id: "user-1", tenant_id: "source-tenant", role: "owner" }],
    customers: [{ id: "customer-1", tenant_id: "source-tenant", name: "Cliente de Teste", amount: 12345 }],
  }, "2026-10-24T12:00:00.000Z");
}

test("pacote criptografado abre e mantém manifesto, IDs e valores em centavos", () => {
  const file = sealTransferPackage(sample(), passphrase);
  const reopened = openTransferPackage(file, passphrase);
  assert.equal(reopened.source.tenant.id, "source-tenant");
  assert.equal(reopened.records.customers?.[0].id, "customer-1");
  assert.equal(reopened.records.customers?.[0].amount, 12345);
  assert.equal(reopened.entities.customers?.count, 1);
});

test("senha incorreta e arquivo alterado são rejeitados", () => {
  const file = sealTransferPackage(sample(), passphrase);
  assert.throws(() => openTransferPackage(file, "senha-incorreta-123"), /Não foi possível abrir/);
  const tampered = Buffer.from(file);
  tampered[tampered.length - 5] = tampered[tampered.length - 5] === 65 ? 66 : 65;
  assert.throws(() => openTransferPackage(tampered, passphrase));
});

test("não permite empacotar credenciais ou entidades fora da allowlist", () => {
  const bad = sample() as unknown as { records: Record<string, unknown> };
  bad.records.users = [{ id: "user-1", password_hash: "não exportar" }];
  assert.throws(() => sealTransferPackage(bad as never, passphrase), /campos de autenticação/);
  const unknown = sample() as unknown as { records: Record<string, unknown> };
  unknown.records.sessions = [];
  assert.throws(() => sealTransferPackage(unknown as never, passphrase), /entidade não permitida/);
});

test("exige hash e contagem para toda entidade e recusa segredos aninhados", () => {
  const incomplete = sample() as unknown as { entities: Record<string, unknown> };
  delete incomplete.entities.customers;
  assert.throws(() => sealTransferPackage(incomplete as never, passphrase), /manifesto/i);
  const nested = createTransferPayload("fixture", { id: "source-tenant", name: "Oficina Fictícia" }, {
    tenant: { id: "source-tenant", name: "Oficina Fictícia" }, users: [], memberships: [],
    customers: [{ id: "customer-1", tenant_id: "source-tenant", metadata: { api_key: "fake-secret" } }],
  });
  assert.throws(() => sealTransferPackage(nested, passphrase), /campos de autenticação/);
});
