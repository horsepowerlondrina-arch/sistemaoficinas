import test from "node:test";
import assert from "node:assert/strict";
import { compareManagementPeriods, monthPeriod, managementResults, previousPeriod, weekPeriod } from "../src/lib/managementResults.js";
import { defaultManagementResultsSettings as settings } from "../shared/managementResultsSettings.js";
import type { Order, Workspace } from "../src/lib/types.js";
import { orderResult } from "../src/lib/orderReports.js";

const order = (id: string, completed_on: string, cost: number, aggregate?: number): Order => ({
  id, number: Number(id), status: "completed", completed_on, customer_name: "Cliente",
  total: 18001, discount: 1999, product_cost_total: aggregate,
  items: [
    { id: id + "-p", kind: "product", price: 12000, cost, quantity: 1 },
    { id: id + "-s", kind: "service", price: 8000, cost: 2000, quantity: 1 },
  ],
} as unknown as Order);
const source = (orders: Order[]): Pick<Workspace, "orders" | "receivables" | "cash" | "installments" | "catalog"> => ({
  orders,
  receivables: [{ id: "r1", order_id: "1", status: "open", balance: 8001 }, { id: "r2", order_id: "2", status: "paid", balance: 0 }],
  installments: [{ id: "i1", paid_at: "2026-11-06T13:00:00Z" }, { id: "i2", paid_at: "2026-11-12T13:00:00Z" }],
  cash: [
    { id: "c1", receivable_id: "r1", installment_id: "i1", gross_amount: 10000, fee_amount: 101, amount: 9899 },
    { id: "c2", receivable_id: "r1", installment_id: "i2", gross_amount: 8001, fee_amount: 80, amount: 7921 },
    { id: "foreign", receivable_id: "outside", gross_amount: 999999, fee_amount: 999, amount: 999000 },
  ],
  catalog: [{ id: "p", kind: "product", active: 1, stock: 2, minimum_stock: 3, stock_verified: 1 }],
});

test("Resultados separa finalização, resultado estimado e caixa por data efetiva", () => {
  const data = source([order("1", "2026-11-05T13:00:00Z", 4000), order("2", "2026-10-30T13:00:00Z", 4000)]);
  const r = managementResults(data, { from: "2026-11-01", to: "2026-11-10" }, settings, "2026-11-13");
  assert.equal(r.production.count, 1);
  assert.equal(r.production.sale, 18001);
  assert.equal(r.production.ticket, 18001);
  assert.equal(r.estimated.result, 11820); // 18001 − 4000 − 2000 − 181
  assert.equal(r.estimated.discount, 1999);
  assert.equal(r.estimated.fees, 181); // Both realized payments belong to the selected OS
  assert.equal(r.cash.gross, 10000); // Payment on November 12 stays out of the selected interval
  assert.equal(r.cash.net, 9899);
  assert.equal(r.cash.fees, 101);
  assert.equal(r.receivables.openBalance, 8001); // Current snapshot, not period revenue
  assert.equal(r.stock.lowCount, 1);
  assert.equal(r.production.hours, 0.35); // (8000 − 2000) / 17000
  assert.equal(r.production.capacity, 114.29); // 80 * 10/7
  assert.equal(r.goals[0].remaining, 3981999);
  const beforeSecondPayment = managementResults(data, { from: "2026-11-01", to: "2026-11-10" }, settings, "2026-11-10");
  assert.equal(beforeSecondPayment.estimated.fees, 101);
  assert.equal(beforeSecondPayment.estimated.result, 11900);
});

test("custo zero de peça fica desconhecido; custo consolidado positivo cobre detalhe legado", () => {
  const period = { from: "2026-11-01", to: "2026-11-30" };
  const unknown = managementResults(source([order("1", "2026-11-05T13:00:00Z", 0)]), period, settings);
  assert.equal(unknown.production.sale, 18001);
  assert.equal(unknown.orders[0].result, null);
  assert.equal(unknown.estimated.result, 0);
  assert.equal(unknown.estimated.margin, null);
  assert.equal(unknown.parts.missingCostOrders, 1);
  const consolidated = managementResults(source([order("1", "2026-11-05T13:00:00Z", 0, 3500)]), period, settings);
  assert.equal(consolidated.orders[0].consolidated, true);
  assert.equal(consolidated.orders[0].partsCost, 3500);
  assert.equal(consolidated.estimated.consolidatedCostOrders, 1);
  assert.equal(consolidated.estimated.missingCostOrders, 0);
  const existingReport = orderResult(order("1", "2026-11-05T13:00:00Z", 0, 3500), source([]));
  assert.equal(existingReport.missingCost, false);
  assert.equal(existingReport.productCost, 3500);
  const divergent = { ...order("3", "2026-11-05T13:00:00Z", 4000, 4500), total: 17000 };
  const checked = managementResults(source([divergent]), period, settings, "2026-11-13");
  assert.equal(checked.estimated.inconsistentOrders, 1);
  assert.equal(checked.estimated.aggregateDifferenceOrders, 1);
});

test("datas livres, mês e comparação usam dias inclusivos iguais", () => {
  assert.deepEqual(monthPeriod("2026-11-14"), { from: "2026-11-01", to: "2026-11-30" });
  assert.deepEqual(monthPeriod("2026-02-15"), { from: "2026-02-01", to: "2026-02-28" });
  assert.deepEqual(monthPeriod("2028-02-15"), { from: "2028-02-01", to: "2028-02-29" });
  assert.deepEqual(monthPeriod("2026-12-31"), { from: "2026-12-01", to: "2026-12-31" });
  assert.deepEqual(weekPeriod("2026-11-11"), { from: "2026-11-09", to: "2026-11-15" });
  assert.deepEqual(previousPeriod({ from: "2026-11-01", to: "2026-11-10" }), { from: "2026-10-22", to: "2026-10-31" });
  const comparison = compareManagementPeriods(source([order("1", "2026-11-05T13:00:00Z", 4000), order("2", "2026-10-28T13:00:00Z", 4000)]), { from: "2026-11-01", to: "2026-11-10" }, settings);
  assert.equal(comparison.current.production.count, 1);
  assert.equal(comparison.prior.production.count, 1);
  assert.equal(comparison.current.production.capacity, comparison.prior.production.capacity);
  assert.throws(() => managementResults(source([]), { from: "2026-11-30", to: "2026-11-01" }, settings), /datas válidas/);
  assert.throws(() => managementResults(source([]), { from: "2026-02-30", to: "2026-03-01" }, settings), /datas válidas/);
});
