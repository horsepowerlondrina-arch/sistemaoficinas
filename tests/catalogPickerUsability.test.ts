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

import {
  shouldAutoSelectCatalogVehicle,
  serviceDropdownStateAfterAdd,
} from "../shared/catalogPickerUsability";

test("seleção automática do veículo exige correspondência única confiável", () => {
  assert.equal(shouldAutoSelectCatalogVehicle({ status: "matched", model: { id: "model-1" } }), true);
  assert.equal(shouldAutoSelectCatalogVehicle({ status: "needs_confirmation", model: { id: "model-1" } }), false);
  assert.equal(shouldAutoSelectCatalogVehicle({ status: "matched" }), false);
});

test("após incluir serviço a lista permanece fechada sem opção ativa", () => {
  assert.deepEqual(serviceDropdownStateAfterAdd(), { open: false, activeIndex: -1 });
});

import { calculateCatalogDropdownPlacement } from "../shared/catalogPickerUsability";

test("menu de autocomplete abre abaixo do campo em viewport baixo quando cabe a lista rolável", () => {
  const placement = calculateCatalogDropdownPlacement(
    { left: 100, top: 390, right: 550, bottom: 430, width: 450 },
    { width: 1366, height: 608 },
  );
  assert.equal(placement.top, 434);
  assert.equal(placement.left, 100);
  assert.equal(placement.width, 450);
  assert.equal(placement.maxHeight, 114);
});

test("menu abre acima apenas quando não há espaço suficiente abaixo e cabe melhor acima", () => {
  const placement = calculateCatalogDropdownPlacement(
    { left: 100, top: 550, right: 550, bottom: 590, width: 450 },
    { width: 1366, height: 608 },
  );
  assert.ok(placement.top < 550);
  assert.ok(placement.top >= 8);
  assert.ok(placement.maxHeight >= 80);
});
