export type Entity = Record<string, any> & { id: string };
export type Order = Entity & {
  number: number;
  status: string;
  /** Legacy compatibility metadata. OS behavior is determined only by status. */
  kind: "quote" | "order";
  display_status: string;
  customer_id: string;
  vehicle_id: string;
  customer_name: string;
  plate: string;
  brand: string;
  model: string;
  entered_on: string;
  due_on: string;
  km: number;
  problem: string;
  notes: string;
  discount: number;
  total: number;
  items: Entity[];
};
export interface Workspace {
  modules?: Record<string, boolean>;
  parts_pricing?: {
    mode: "legacy" | "markup" | "margin";
    rate_bps: number;
    service_markup_bps?: number;
    rules: {
      up_to: number | null;
      markup_bps: number;
      minimum_profit: number;
    }[];
  };
  catalog_mode?: "standard" | "extension";
  customers: Entity[];
  vehicles: Entity[];
  catalog: Entity[];
  product_categories?: Entity[];
  suppliers?: Entity[];
  professionals: Entity[];
  orders: Order[];
  receivables: Entity[];
  cash: Entity[];
  movements: Entity[];
  installments: Entity[];
  payment_settings: Entity | null;
  cash_accounts?: Entity[];
  card_rates?: Entity[];
  plate_lookup_enabled?: boolean;
}
export interface Session {
  user: { id: string; name: string; email: string };
  tenant: Entity;
  tenants: Entity[];
  role: string;
  modules?: Record<string, boolean>;
}
export const money = (value: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    value / 100,
  );
export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
export const dateLabel = (date: string) =>
  date
    ? new Date(date.slice(0, 10) + "T12:00:00").toLocaleDateString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
      })
    : "—";
export const statusLabel: Record<string, string> = {
  quote: "Orçamento",
  awaiting_payment: "A receber",
  open: "Aberta",
  working: "Em execução",
  ready: "Pronta para entrega",
  completed: "Finalizada",
  cancelled: "Cancelada",
  paid: "Recebida",
};
export const initials = (name: string) =>
  name
    .split(" ")
    .slice(0, 2)
    .map((n) => n[0])
    .join("");
