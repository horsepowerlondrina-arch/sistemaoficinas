import assert from "node:assert/strict";
import test from "node:test";
import { gainReport } from "../src/lib/gainReports";
import type { Order } from "../src/lib/types";

const order = (id: string, completed_on: string, productCost: number): Order => ({
  id, number: id, status: "completed", completed_on, total: 15000, discount: 1000,
  items: [
    { id: id + "-p", kind: "product", name: "Peça", quantity: 1, price: 10000, cost: productCost },
    { id: id + "-s", kind: "service", name: "Serviço", quantity: 1, price: 6000, cost: 2000 },
  ],
} as unknown as Order);

test("ganhos por finalização separam peças, serviços e lucro bruto", () => {
  const orders = [order("1", "2026-11-05T15:00:00Z", 4000), order("2", "2026-10-31T15:00:00Z", 4000)];
  const base = { from: "2026-11-01", to: "2026-11-30" };
  const products = gainReport(orders, { ...base, kind: "products" });
  const services = gainReport(orders, { ...base, kind: "services" });
  const both = gainReport(orders, { ...base, kind: "both" });
  assert.equal(products.rows.length, 1);
  assert.equal(products.totals.sale, 9375);
  assert.equal(products.totals.profit, 5375);
  assert.equal(services.totals.sale, 5625);
  assert.equal(services.totals.profit, 3625);
  assert.equal(both.totals.profit, 9000);
});

test("custo de peça ausente não vira lucro conhecido", () => {
  const report = gainReport([order("1", "2026-11-05T15:00:00Z", 0)], { from: "2026-11-01", to: "2026-11-30", kind: "both" });
  assert.equal(report.rows[0].profit, null);
  assert.equal(report.totals.missingCostOrders, 1);
  assert.equal(report.totals.profit, 0);
});

test("custo consolidado positivo de OS importada substitui detalhe de peça ausente", () => {
  const imported = { ...order("77", "2026-11-05T15:00:00Z", 0), product_cost_total: 3500 };
  const report = gainReport([imported], { from: "2026-11-01", to: "2026-11-30", kind: "both" });
  assert.equal(report.rows[0].missingCost, false);
  assert.equal(report.rows[0].cost, 5500);
  assert.equal(report.rows[0].profit, imported.total - 5500);
});

test("período invertido é recusado", () => {
  assert.throws(() => gainReport([], { from: "2026-11-30", to: "2026-11-01", kind: "both" }));
});
