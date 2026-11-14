import type { Order, Workspace } from "./types";
import { workshopDate } from "./workflow";
import { needsReplenishment } from "../../shared/stockThreshold";
import type { ManagementResultsSettings } from "../../shared/managementResultsSettings";

type Data = Pick<Workspace, "orders" | "receivables" | "cash" | "installments" | "catalog">;
export type ManagementPeriod = { from: string; to: string };
type Period = ManagementPeriod;
const cents = (value: unknown) => Number.isSafeInteger(Number(value)) ? Number(value) : 0;
const day = (value: unknown) => {
  const text = String(value || "");
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : workshopDate(text);
};
const validDay = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const utcDay = (value: string) => Date.parse(value + "T00:00:00Z");
const key = (timestamp: number) => new Date(timestamp).toISOString().slice(0, 10);
const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const range = (value: string, period: Period) => value >= period.from && value <= period.to;

export function previousPeriod(period: Period): Period {
  const days = Math.round((utcDay(period.to) - utcDay(period.from)) / 86400000) + 1;
  const end = utcDay(period.from) - 86400000;
  return { from: key(end - (days - 1) * 86400000), to: key(end) };
}

export function monthPeriod(anchor: string): Period {
  if (!validDay(anchor)) throw new Error("Data inválida.");
  const d = new Date(utcDay(anchor));
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
  return { from: key(start.getTime()), to: key(end.getTime()) };
}

export function weekPeriod(anchor: string): Period {
  if (!validDay(anchor)) throw new Error("Data inválida.");
  const date = new Date(utcDay(anchor));
  const offset = (date.getUTCDay() + 6) % 7;
  const monday = date.getTime() - offset * 86400000;
  return { from: key(monday), to: key(monday + 6 * 86400000) };
}

function orderCost(order: Order) {
  const products = order.items.filter(item => item.kind === "product");
  const services = order.items.filter(item => item.kind === "service");
  const partsSale = products.reduce((sum, item) => sum + cents(item.price) * cents(item.quantity), 0);
  const servicesSale = services.reduce((sum, item) => sum + cents(item.price) * cents(item.quantity), 0);
  const recordedPartsCost = products.reduce((sum, item) => sum + cents(item.cost) * cents(item.quantity), 0);
  const thirdCost = services.reduce((sum, item) => sum + cents(item.cost) * cents(item.quantity), 0);
  const missingItemCost = products.some(item => cents(item.cost) <= 0);
  const aggregate = cents(order.product_cost_total);
  const partsCost = missingItemCost && aggregate <= 0 ? null : aggregate > 0 ? aggregate : recordedPartsCost;
  return { partsSale, servicesSale, recordedPartsCost, partsCost, thirdCost, consolidated: missingItemCost && aggregate > 0,
    aggregateDifference: !missingItemCost && aggregate > 0 && aggregate !== recordedPartsCost };
}

export function managementResults(data: Data, period: Period, settings: ManagementResultsSettings, asOf = workshopDate(new Date().toISOString())) {
  if (!validDay(period.from) || !validDay(period.to) || period.from > period.to)
    throw new Error("Informe datas válidas, com a data inicial anterior ou igual à final.");
  const days = Math.round((utcDay(period.to) - utcDay(period.from)) / 86400000) + 1;
  const receivableById = new Map(data.receivables.map(receivable => [receivable.id, receivable]));
  const installmentById = new Map(data.installments.map(installment => [installment.id, installment]));
  const feesByOrder = new Map<string, number>();
  const cash = { gross: 0, net: 0, fees: 0, orders: new Set<string>(), dateFallbacks: 0 };
  for (const entry of data.cash) {
    const receivable = receivableById.get(entry.receivable_id);
    if (!receivable?.order_id) continue;
    const installment = installmentById.get(entry.installment_id);
    const fee = cents(entry.fee_amount);
    const paidOn = day(installment?.paid_at || entry.created_at);
    if (!paidOn || paidOn > asOf) continue;
    feesByOrder.set(receivable.order_id, (feesByOrder.get(receivable.order_id) || 0) + fee);
    if (!range(paidOn, period)) continue;
    if (!installment?.paid_at) cash.dateFallbacks++;
    cash.gross += cents(entry.gross_amount ?? entry.amount);
    cash.net += cents(entry.amount);
    cash.fees += fee;
    cash.orders.add(receivable.order_id);
  }
  const orders = data.orders.filter(order => order.status === "completed" && range(day(order.completed_on), period))
    .map(order => {
      const cost = orderCost(order);
      const fees = feesByOrder.get(order.id) || 0;
      const result = cost.partsCost === null ? null : cents(order.total) - cost.partsCost - cost.thirdCost - fees;
      return { id: order.id, number: order.number, customer: order.customer_name, completed_on: day(order.completed_on),
        total: cents(order.total), discount: cents(order.discount), fees, result,
        margin: result === null || !cents(order.total) ? null : result / cents(order.total),
        salesMismatch: cost.partsSale + cost.servicesSale - cents(order.discount) !== cents(order.total), ...cost };
    });
  const sum = (field: "total" | "discount" | "fees" | "partsSale" | "servicesSale" | "thirdCost" | "recordedPartsCost") =>
    orders.reduce((total, order) => total + order[field], 0);
  const known = orders.filter(order => order.result !== null);
  const knownSale = known.reduce((total, order) => total + order.total, 0);
  const result = known.reduce((total, order) => total + (order.result || 0), 0);
  const knownParts = orders.filter(order => order.partsCost !== null);
  const partsKnownSale = knownParts.reduce((total, order) => total + order.partsSale, 0);
  const partsCost = knownParts.reduce((total, order) => total + (order.partsCost || 0), 0);
  const servicesSale = sum("servicesSale"), thirdCost = sum("thirdCost");
  const hours = round2((servicesSale - thirdCost) / settings.hourly_rate);
  const capacity = round2(settings.weekly_capacity * days / 7);
  const yellow = round2(settings.yellow_hours * days / 7);
  const green = round2(settings.green_hours * days / 7);
  const sale = sum("total");
  const openReceivables = data.receivables.filter(row => row.status === "open");
  return {
    period: { ...period, days, partial: period.to > asOf },
    orders,
    production: { sale, count: orders.length, ticket: orders.length ? Math.round(sale / orders.length) : null,
      servicesSale, thirdCost, hours, capacity, yellow, green,
      occupancy: capacity ? hours / capacity : null,
      light: hours >= green ? "verde" : hours >= yellow ? "amarelo" : "vermelho" },
    estimated: { result, margin: knownSale ? result / knownSale : null, knownSale,
      missingCostOrders: orders.length - known.length, consolidatedCostOrders: orders.filter(order => order.consolidated).length,
      inconsistentOrders: orders.filter(order => order.salesMismatch).length,
      aggregateDifferenceOrders: orders.filter(order => order.aggregateDifference).length,
      discount: sum("discount"), fees: sum("fees") },
    parts: { sale: sum("partsSale"), knownCost: partsCost, recordedCost: sum("recordedPartsCost"),
      margin: partsKnownSale - partsCost, marginPct: partsKnownSale ? (partsKnownSale - partsCost) / partsKnownSale : null,
      missingCostOrders: orders.length - knownParts.length },
    cash: { gross: cash.gross, net: cash.net, fees: cash.fees, orderCount: cash.orders.size, dateFallbacks: cash.dateFallbacks },
    receivables: { openCount: openReceivables.length, openBalance: openReceivables.reduce((total, row) => total + cents(row.balance ?? row.amount), 0) },
    stock: { lowCount: data.catalog.filter(item => item.kind === "product" && item.active && needsReplenishment(item)).length },
    goals: settings.goals.map(target => ({ target, actual: sale, progress: sale / target,
      remaining: Math.max(0, target - sale), remainingHours: round2(Math.max(0, target - sale) / settings.hourly_rate) })),
  };
}

export function compareManagementPeriods(data: Data, period: Period, settings: ManagementResultsSettings, asOf?: string) {
  const current = managementResults(data, period, settings, asOf);
  const prior = managementResults(data, previousPeriod(period), settings, asOf);
  return { current, prior };
}
