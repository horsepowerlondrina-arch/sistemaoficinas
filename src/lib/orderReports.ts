import { today, type Entity, type Order, type Workspace } from "./types";
import { displayStatus, workshopDate, hasMissingProductCost } from "./workflow";

export type OrderFilters = {
  from: string;
  to: string;
  basis: "opening" | "completion" | "payment";
  statuses: string[];
};
export const dateBasisLabel = {
  opening: "Data de abertura",
  completion: "Data de finalização",
  payment: "Data de pagamento",
};
export const reportNote =
  "Resultado estimado = valor da OS após desconto − custos registrados de peças e serviços de terceiros − taxas dos pagamentos realizados. Não inclui mão de obra interna, impostos ou despesas gerais. Peças com custo zero ou ausente são marcadas como custo não informado; essas OS ficam fora do total de resultado e da margem. Custos apresentados somam apenas os valores registrados. Peças e serviços são apresentados antes do desconto e das taxas, que são descontados uma única vez no total. O período seleciona as OS; os valores e pagamentos apresentados abrangem toda a OS, inclusive fora do período. Juros de parcelamento não são adicionados ao valor da OS. OS abertas ou canceladas não representam receita realizada.";
const number = (value: unknown) => Number(value || 0);
const date = (value: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value || "") ? value : workshopDate(value || "");

/** The cash ledger is authoritative for realized fees; installments supply the actual payment date. */
export function orderPayments(
  order: Order,
  data: Pick<Workspace, "receivables" | "cash" | "installments">,
) {
  const receipts = new Set(
    data.receivables.filter((r) => r.order_id === order.id).map((r) => r.id),
  );
  const installments = new Map(data.installments.map((i) => [i.id, i]));
  return data.cash
    .filter((c) => receipts.has(c.receivable_id) && date(installments.get(c.installment_id)?.paid_at || c.created_at) <= today())
    .map((c) => ({
      ...c,
      method: String(c.method || "—"),
      day: date(installments.get(c.installment_id)?.paid_at || c.created_at),
      gross: number(c.gross_amount ?? c.amount),
      fee: number(c.fee_amount),
      net: number(c.amount),
    }));
}

export function selectReportOrders(
  orders: Order[],
  filters: OrderFilters,
  data: Pick<Workspace, "receivables" | "cash" | "installments">,
  search = "",
  includeQuotes = false,
) {
  const inRange = (day: string) =>
    Boolean(day) &&
    (!filters.from || day >= filters.from) &&
    (!filters.to || day <= filters.to);
  return orders.filter((o) => {
    if (
      (!includeQuotes && o.status === "quote") ||
      (filters.statuses.length && !filters.statuses.includes(displayStatus(o)))
    )
      return false;
    if (
      !`${o.number} ${o.customer_name} ${o.plate} ${o.brand} ${o.model}`
        .toLowerCase()
        .includes(search.toLowerCase())
    )
      return false;
    return filters.basis === "payment"
      ? orderPayments(o, data).some((p) => inRange(p.day))
      : inRange(
          date(filters.basis === "opening" ? o.entered_on : o.completed_on),
        );
  });
}

export function resultItem(item: Entity) {
  const quantity = number(item.quantity),
    price = number(item.price),
    cost = number(item.cost);
  const sale = Math.round(price * quantity),
    totalCost = Math.round(cost * quantity);
  return {
    ...item,
    name: String(item.name || ""),
    duration_seconds: item.duration_seconds as number | undefined,
    quantity,
    price,
    cost,
    sale,
    totalCost,
    missingCost: item.kind === "product" && !(cost > 0),
    result: item.kind === "product" && !(cost > 0) ? null : sale - totalCost,
  };
}
export function orderResult(
  order: Order,
  data: Pick<Workspace, "receivables" | "cash" | "installments">,
) {
  const products = order.items
    .filter((i) => i.kind === "product")
    .map(resultItem);
  const services = order.items
    .filter((i) => i.kind === "service")
    .map(resultItem);
  const sum = (
    items: ReturnType<typeof resultItem>[],
    key: "sale" | "totalCost",
  ) => items.reduce((s, i) => s + i[key], 0);
  const payments = orderPayments(order, data);
  const productSale = sum(products, "sale"),
    serviceSale = sum(services, "sale");
  const productCost = number(order.product_cost_total) > 0 ? number(order.product_cost_total) : sum(products, "totalCost"),
    serviceCost = sum(services, "totalCost");
  const fees = payments.reduce((s, p) => s + p.fee, 0);
  const total = number(order.total),
    result = hasMissingProductCost(order) ? null : total - productCost - serviceCost - fees;
  return {
    order,
    missingCost: hasMissingProductCost(order),
    products,
    services,
    payments,
    productSale,
    serviceSale,
    productCost,
    serviceCost,
    fees,
    total,
    discount: number(order.discount),
    result,
    margin: total && result !== null ? result / total : null,
  };
}
export type OrderResult = ReturnType<typeof orderResult>;
export function reportTotals(results: OrderResult[]) {
  return results.reduce(
    (s, r) => ({
      total: s.total + r.total,
      cost: s.cost + r.productCost + r.serviceCost,
      fees: s.fees + r.fees,
      result: s.result + (r.result ?? 0),
    }),
    { total: 0, cost: 0, fees: 0, result: 0 },
  );
}
export const reportDate = (day: string) =>
  day ? date(day).split("-").reverse().join("/") : "—";
export const durationLabel = (seconds: number | undefined) =>
  seconds
    ? `${Number((seconds / 3600).toFixed(2)).toLocaleString("pt-BR")} h`
    : "—";
