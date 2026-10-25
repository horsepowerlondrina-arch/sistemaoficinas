import assert from "node:assert/strict";
import { test } from "node:test";
import { compareTransferRecord } from "../server/services/dataTransferVerification.js";

test("a conferência ignora tenant_id remapeado e identifica autoria transformada", () => {
  const result = compareTransferRecord("stock_movements", {
    id: "movement-fake-1", tenant_id: "source-tenant", catalog_id: "catalog-fake-1",
    quantity: -1, user_id: "source-user-fake", reason: "teste fictício",
  }, {
    id: "movement-fake-1", tenant_id: "destination-tenant", catalog_id: "catalog-fake-1",
    quantity: -1, user_id: "destination-owner-fake", reason: "teste fictício",
  }, "source-tenant", "destination-tenant", new Set(["id", "tenant_id", "catalog_id", "quantity", "user_id", "reason"]));
  assert.deepEqual(result.differingFields, []);
  assert.deepEqual(result.transformedFields, ["user_id"]);
  assert.deepEqual(result.notVerifiableFields, []);
});

test("a conferência compara centavos sem diferença de representação numérica", () => {
  const result = compareTransferRecord("receivables", {
    id: "receivable-fake-1", tenant_id: "source-tenant", amount: 12345,
  }, {
    id: "receivable-fake-1", tenant_id: "destination-tenant", amount: "12345",
  }, "source-tenant", "destination-tenant", new Set(["id", "tenant_id", "amount"]));
  assert.deepEqual(result.differingFields, []);
  assert.deepEqual(result.notVerifiableFields, []);
});

test("uma divergência financeira informa somente o nome do campo", () => {
  const result = compareTransferRecord("cash_entries", {
    id: "cash-fake-1", tenant_id: "source-tenant", amount: 10000,
  }, {
    id: "cash-fake-1", tenant_id: "destination-tenant", amount: 10050,
  }, "source-tenant", "destination-tenant", new Set(["id", "tenant_id", "amount"]));
  assert.deepEqual(result.differingFields, ["amount"]);
  assert.deepEqual(result.transformedFields, []);
});

test("campos exclusivos do destino permanecem não verificáveis", () => {
  const result = compareTransferRecord("customers", {
    id: "customer-fake-1", tenant_id: "source-tenant", name: "Cliente Fictício",
  }, {
    id: "customer-fake-1", tenant_id: "destination-tenant", name: "Cliente Fictício", local_flag: true,
  }, "source-tenant", "destination-tenant", new Set(["id", "tenant_id", "name", "local_flag"]));
  assert.deepEqual(result.differingFields, []);
  assert.deepEqual(result.notVerifiableFields, ["local_flag"]);
});


test("normaliza timestamps ISO e Date do PostgreSQL para a mesma data", () => {
  const result = compareTransferRecord("customers", {
    id: "customer-date-fake", tenant_id: "source-tenant", created_at: "2026-10-24T12:00:00.000Z",
  }, {
    id: "customer-date-fake", tenant_id: "destination-tenant", created_at: new Date("2026-10-24T12:00:00.000Z"),
  }, "source-tenant", "destination-tenant", new Set(["id", "tenant_id", "created_at"]));
  assert.deepEqual(result.differingFields, []);
  assert.deepEqual(result.notVerifiableFields, []);
});

test("preserva comparação literal de códigos numéricos com zeros à esquerda", () => {
  const result = compareTransferRecord("catalog", {
    id: "catalog-code-fake", tenant_id: "source-tenant", sku: "00123",
  }, {
    id: "catalog-code-fake", tenant_id: "destination-tenant", sku: "123",
  }, "source-tenant", "destination-tenant", new Set(["id", "tenant_id", "sku"]));
  assert.deepEqual(result.differingFields, ["sku"]);
});
