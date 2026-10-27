import type { Order } from "./types";
import { displayStatus, workshopDate } from "./workflow";

export type OrderListSortKey =
  | "number"
  | "vehicle"
  | "opening"
  | "due"
  | "status"
  | "total";
export type SortDirection = "asc" | "desc";

export function sortOrderList(
  orders: Order[],
  key: OrderListSortKey,
  direction: SortDirection,
): Order[] {
  const directionFactor = direction === "asc" ? 1 : -1;
  return orders
    .map((order, index) => ({ order, index }))
    .sort(({ order: a, index: aIndex }, { order: b, index: bIndex }) => {
      let comparison = 0;
      if (key === "number") {
        comparison = Number(a.number || 0) - Number(b.number || 0);
        if (!comparison)
          comparison = String(a.customer_name || "").localeCompare(
            String(b.customer_name || ""),
            "pt-BR",
            { sensitivity: "base" },
          );
      } else if (key === "vehicle") {
        comparison = vehicleLabel(a).localeCompare(vehicleLabel(b), "pt-BR", {
          numeric: true,
          sensitivity: "base",
        });
      } else if (key === "opening" || key === "due") {
        const aDate = String(key === "opening" ? a.entered_on || "" : a.due_on || "").slice(0, 10);
        const bDate = String(key === "opening" ? b.entered_on || "" : b.due_on || "").slice(0, 10);
        if (!aDate || !bDate) {
          if (aDate !== bDate) return aDate ? -1 : 1;
        } else {
          comparison = aDate.localeCompare(bDate);
        }
      } else if (key === "status") {
        comparison = displayStatus(a).localeCompare(displayStatus(b), "pt-BR", {
          sensitivity: "base",
        });
      } else {
        comparison = Number(a.total || 0) - Number(b.total || 0);
      }
      return comparison ? comparison * directionFactor : aIndex - bIndex;
    })
    .map(({ order }) => order);
}

function vehicleLabel(order: Order) {
  return [order.brand, order.model, order.plate]
    .map((value) => String(value || ""))
    .join(" ");
}

export function isOrderOverdue(
  order: Pick<Order, "status" | "display_status" | "due_on">,
  workshopToday = workshopDate(new Date().toISOString()),
): boolean {
  const finishedStatuses = new Set(["completed", "cancelled"]);
  if (
    finishedStatuses.has(String(order.status || "")) ||
    finishedStatuses.has(String(order.display_status || ""))
  )
    return false;
  const dueDate = String(order.due_on || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(dueDate) && !!workshopToday && dueDate < workshopToday;
}

export function orderListDateLabel(day: string) {
  const value = String(day || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return "—";
  const [year, month, date] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "UTC",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(Date.UTC(year, month - 1, date)));
}
