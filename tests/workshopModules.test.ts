import test from "node:test";
import assert from "node:assert/strict";
import { defaultWorkshopModules, moduleForApiRequest, uiModuleForPath, workspaceForModules, workshopModuleLabels } from "../shared/workshopModules.js";

test("permissões por oficina usam compatibilidade habilitada e rotas conhecidas exigem módulo", () => {
  assert.equal(Object.values(defaultWorkshopModules).every(Boolean), true);
  assert.equal(defaultWorkshopModules.technical_catalog, true);
  assert.equal(workshopModuleLabels.technical_catalog, "Catálogo Técnico de Tempos");
  assert.deepEqual(moduleForApiRequest("/orders/123/status"), ["orders"]);
  assert.deepEqual(moduleForApiRequest("/orders", "POST"), ["orders","customers_vehicles"]);
  assert.deepEqual(moduleForApiRequest("/catalog-capture/123/start", "POST"), ["inventory","catalog"]);
  assert.deepEqual(moduleForApiRequest("/stock-invoices/import", "POST"), ["inventory","catalog","suppliers"]);
  assert.deepEqual(moduleForApiRequest("/repair-services/models"), ["technical_catalog"]);
  assert.deepEqual(moduleForApiRequest("/repair-services/access"), []);
  assert.deepEqual(moduleForApiRequest("/repair-services/rates", "PUT"), ["settings"]);
  assert.deepEqual(moduleForApiRequest("/vehicles/catalog-review"), ["customers_vehicles", "technical_catalog"]);
  assert.deepEqual(moduleForApiRequest("/workshop-services"), ["catalog"]);
  assert.deepEqual(moduleForApiRequest("/api/workshop-services/preview", "POST"), ["catalog"]);
  assert.deepEqual(moduleForApiRequest("/api/repair-services/preview", "POST"), ["technical_catalog"]);
  assert.deepEqual(moduleForApiRequest("/workshop-service-categories"), ["catalog"]);
  assert.deepEqual(moduleForApiRequest("/workshop-service-categories/00000000-0000-4000-8000-000000000001", "PUT"), ["catalog"]);
  assert.deepEqual(moduleForApiRequest("/api/workshop-services"), ["catalog"]);
  assert.deepEqual(moduleForApiRequest("/api/workshop-services?status=active"), ["catalog"]);
  assert.deepEqual(moduleForApiRequest("/payables/123/pay"), ["finance"]);
  assert.deepEqual(moduleForApiRequest("/documents/archives"), ["orders", "checklists"]);
  assert.deepEqual(moduleForApiRequest("/session"), []);
  assert.equal(moduleForApiRequest("/unknown-sensitive-route"), null);
});

test("rotas da interface reconhecem as funcionalidades desabilitadas", () => {
  assert.equal(uiModuleForPath("/ordens/123"), "orders");
  assert.equal(uiModuleForPath("/cadastros?aba=clientes"), "customers_vehicles");
  assert.equal(uiModuleForPath("/configuracoes?aba=dados"), "settings");
  assert.equal(uiModuleForPath("/inicio"), null);
});

test("workspace não devolve dados de funcionalidades desabilitadas", () => {
  const workspace = {
    customers: [{ id: "customer-fake" }], vehicles: [{ id: "vehicle-fake" }],
    catalog: [{ id: "item-fake" }], product_categories: [{ id: "category-fake" }],
    professionals: [{ id: "professional-fake" }], suppliers: [{ id: "supplier-fake" }],
    orders: [{ id: "order-fake" }], receivables: [{ id: "receivable-fake" }],
    cash: [{ id: "cash-fake" }], installments: [{ id: "installment-fake" }],
    cash_accounts: [{ id: "account-fake" }], card_rates: [{ id: "rate-fake" }],
    movements: [{ id: "movement-fake" }], payment_settings: { credit_fee_bps: 100 },
    parts_pricing: { rate_bps: 2000 }, catalog_mode: "extension",
  };
  const filtered = workspaceForModules(workspace, {
    customers_vehicles: false, catalog: false, professionals: false, suppliers: false,
    orders: false, finance: false, inventory: false, settings: false,
  });
  for (const key of ["customers","vehicles","catalog","product_categories","professionals","suppliers","orders","receivables","cash","installments","cash_accounts","card_rates","movements"])
    assert.deepEqual(filtered[key as keyof typeof filtered], []);
  assert.equal(filtered.payment_settings, null);
  assert.equal("parts_pricing" in filtered, false);
  assert.equal("catalog_mode" in filtered, false);
  assert.equal(workspace.customers.length, 1, "filtering must not mutate the caller's payload");
});
