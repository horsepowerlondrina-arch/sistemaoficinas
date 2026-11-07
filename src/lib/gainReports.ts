import type { Order } from "./types";
import { hasMissingProductCost, revenueBreakdown, workshopDate } from "./workflow";

export type GainKind = "products" | "services" | "both";
export type GainFilters = { from: string; to: string; kind: GainKind };

export function gainReport(orders: Order[], filters: GainFilters) {
  if (filters.from > filters.to) throw new Error("A data inicial deve ser anterior ou igual à final.");
  const rows = orders
    .filter((order) => {
      const day = workshopDate(order.completed_on || "");
      return order.status === "completed" && day >= filters.from && day <= filters.to;
    })
    .map((order) => {
      const values = revenueBreakdown([order], filters.from, filters.to);
      const missingCost = filters.kind !== "services" && hasMissingProductCost(order);
      const sale = filters.kind === "products" ? values.products : filters.kind === "services" ? values.services : values.products + values.services;
      const cost = filters.kind === "products" ? values.productCost : filters.kind === "services" ? values.serviceCost : values.productCost + values.serviceCost;
      const profit = missingCost ? null : filters.kind === "products" ? values.productProfit : filters.kind === "services" ? values.serviceProfit : values.productProfit + values.serviceProfit;
      return { order, day: workshopDate(order.completed_on || ""), sale, cost, profit, missingCost };
    })
    .filter((row) => row.sale !== 0 || row.cost !== 0);
  return {
    filters,
    rows,
    totals: {
      sale: rows.reduce((sum, row) => sum + row.sale, 0),
      cost: rows.filter((row) => !row.missingCost).reduce((sum, row) => sum + row.cost, 0),
      profit: rows.reduce((sum, row) => sum + (row.profit ?? 0), 0),
      missingCostOrders: rows.filter((row) => row.missingCost).length,
    },
  };
}
