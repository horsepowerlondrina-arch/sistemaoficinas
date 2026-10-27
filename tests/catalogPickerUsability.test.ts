import assert from "node:assert/strict";
import test from "node:test";
import {
  canAddRepairServiceImmediately,
  initialCatalogOptionIndex,
  nextCatalogOptionIndex,
} from "../shared/catalogPickerUsability";

test("catálogo destaca a primeira opção e limita navegação ao intervalo", () => {
  assert.equal(initialCatalogOptionIndex(3), 0);
  assert.equal(initialCatalogOptionIndex(0), -1);
  assert.equal(nextCatalogOptionIndex(-1, 3, 1), 0);
  assert.equal(nextCatalogOptionIndex(0, 3, 1), 1);
  assert.equal(nextCatalogOptionIndex(2, 3, 1), 2);
  assert.equal(nextCatalogOptionIndex(0, 3, -1), 0);
  assert.equal(nextCatalogOptionIndex(1, 3, -1), 0);
  assert.equal(nextCatalogOptionIndex(0, 0, 1), -1);
});

test("serviço interno é incluído direto somente com tempo e tarifa disponíveis", () => {
  const base = { execution: "internal", cost: 0, minutes: 45, hourlyRate: 12000, price: 0, pricingMode: "time", hasCategory: true };
  assert.equal(canAddRepairServiceImmediately(base), true);
  assert.equal(canAddRepairServiceImmediately({ ...base, minutes: 0 }), false);
  assert.equal(canAddRepairServiceImmediately({ ...base, hourlyRate: 0 }), false);
  assert.equal(canAddRepairServiceImmediately({ ...base, hasCategory: false }), false);
  assert.equal(canAddRepairServiceImmediately({ ...base, minutes: 0, hourlyRate: 0, price: 5000, pricingMode: "price" }), true);
});

test("serviço terceirizado exige custo informado antes da inclusão direta", () => {
  const base = { execution: "outsourced", cost: 0, minutes: 0, hourlyRate: 0, price: 0, pricingMode: "time", hasCategory: true };
  assert.equal(canAddRepairServiceImmediately(base), false);
  assert.equal(canAddRepairServiceImmediately({ ...base, cost: 8000 }), true);
  assert.equal(canAddRepairServiceImmediately({ ...base, cost: 8000, hasCategory: false }), false);
});
