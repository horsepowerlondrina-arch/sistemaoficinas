export const workshopModuleKeys = [
  "dashboard",
  "orders",
  "checklists",
  "customers_vehicles",
  "catalog",
  "technical_catalog",
  "external_plate_lookup",
  "professionals",
  "suppliers",
  "inventory",
  "finance",
  "settings",
] as const;

export type WorkshopModuleKey = typeof workshopModuleKeys[number];
export type WorkshopModules = Record<Exclude<WorkshopModuleKey, "external_plate_lookup">, boolean> & { external_plate_lookup?: boolean };

export const workshopModuleLabels: Record<WorkshopModuleKey, string> = {
  dashboard: "Visão geral",
  orders: "Ordens de serviço e orçamentos",
  checklists: "Checklists",
  customers_vehicles: "Clientes e veículos",
  catalog: "Produtos e serviços da oficina",
  technical_catalog: "Catálogo Técnico de Tempos",
  external_plate_lookup: "Consulta externa de placas",
  professionals: "Profissionais",
  suppliers: "Fornecedores",
  inventory: "Estoque",
  finance: "Financeiro",
  settings: "Configurações",
};

export const defaultWorkshopModules: WorkshopModules = Object.fromEntries(
  workshopModuleKeys.filter((key) => key !== "external_plate_lookup").map((key) => [key, true]),
) as WorkshopModules;

const moduleForUiPath = (path: string): WorkshopModuleKey | null => {
  if (path.startsWith("/dashboard")) return "dashboard";
  if (path.startsWith("/ordens") || path.startsWith("/orcamentos")) return "orders";
  if (path.startsWith("/checklists")) return "checklists";
  if (["/cadastros", "/clientes", "/veiculos"].some((prefix) => path.startsWith(prefix))) return "customers_vehicles";
  if (["/catalogo", "/servicos", "/tempos"].some((prefix) => path.startsWith(prefix))) return "catalog";
  if (path.startsWith("/profissionais")) return "professionals";
  if (path.startsWith("/fornecedores")) return "suppliers";
  if (path.startsWith("/estoque")) return "inventory";
  if (path.startsWith("/financeiro")) return "finance";
  if (path.startsWith("/configuracoes")) return "settings";
  return null;
};

export function moduleForApiRequest(path: string, method = "GET"): WorkshopModuleKey[] | null {
  // Express normally strips `/api` from paths mounted through `app.use("/api", ...)`.
  // Normalize both forms because the Vercel adapter can pass the original path.
  const pathname = path.split(/[?#]/, 1)[0] || "/";
  const normalizedPath = pathname.replace(/^\/api(?=\/|$)/, "");
  const p = normalizedPath.replace(/\/+$/, "") || "/";
  if (["/session", "/logout", "/tenant", "/workspace"].includes(p)) return [];
  if (p === "/customers-with-vehicle") return ["orders","customers_vehicles"];
  if (/^\/orders(?:\/|$)/.test(p)) {
    const isCreatingOrEditing = (method === "POST" && p === "/orders") || (method === "PUT" && /^\/orders\/[^/]+$/.test(p));
    return isCreatingOrEditing ? ["orders","customers_vehicles"] : ["orders"];
  }
  if (/^\/checklists(?:\/|$)/.test(p) || /^\/checklist-photos(?:\/|$)/.test(p)) return ["checklists"];
  if (p === "/documents/archives" || p.startsWith("/documents/archives/")) return ["orders", "checklists"];
  if (p.startsWith("/documents/")) {
    const kind = p.split("/")[2];
    return kind === "checklist" ? ["checklists"] : ["orders"];
  }
  if (p === "/repair-services/access" || p === "/repair-services/config") return [];
  if (p === "/repair-services/rates") return ["settings"];
  if (/^\/vehicles\/catalog-(?:review|backfill\/(?:preview|apply))$/.test(p)) return ["customers_vehicles", "technical_catalog"];
  if (/^\/(?:customers|vehicles)(?:\/|$)/.test(p)) return ["customers_vehicles"];
  if (/^\/catalog-capture(?:\/|$)/.test(p)) return ["inventory","catalog"];
  if (/^\/repair-services(?:\/|$)/.test(p)) return ["technical_catalog"];
  if (/^\/(?:catalog|product-categories|catalog-batch|workshop-services|workshop-service-categories)(?:\/|$)/.test(p)) return ["catalog"];
  if (/^\/professionals(?:\/|$)/.test(p)) return ["professionals"];
  if (/^\/suppliers(?:\/|$)/.test(p)) return ["suppliers"];
  if (/^\/stock-invoices(?:\/|$)/.test(p)) return ["inventory","catalog","suppliers"];
  if (/^\/stock(?:\/|$)/.test(p)) return ["inventory"];
  if (/^\/(?:expenses|payables|expense-templates|cash-control|cash-accounts|cash-adjustments|receivables|installments|payment-settings)(?:\/|$)/.test(p)) return ["finance"];
  if (/^\/card-machines(?:\/|$)/.test(p)) return method === "GET" ? ["finance"] : ["finance", "settings"];
  if (p === "/parts-pricing" || p.startsWith("/parts-pricing/") || p.startsWith("/workshop-profile")) return ["settings"];
  return null;
}

export function workspaceForModules<T extends Record<string, unknown>>(workspace: T, modules?: Partial<WorkshopModules>): T {
  const enabled = (key: WorkshopModuleKey) => modules?.[key] !== false;
  const value: Record<string, unknown> = { ...workspace };
  if (!enabled("customers_vehicles")) {
    if (Array.isArray(value.customers)) value.customers = [];
    if (Array.isArray(value.vehicles)) value.vehicles = [];
  }
  if (!enabled("catalog")) {
    if (Array.isArray(value.catalog)) value.catalog = [];
    if (Array.isArray(value.product_categories)) value.product_categories = [];
  }
  if (!enabled("professionals") && Array.isArray(value.professionals)) value.professionals = [];
  if (!enabled("suppliers") && Array.isArray(value.suppliers)) value.suppliers = [];
  if (!enabled("orders") && Array.isArray(value.orders)) value.orders = [];
  if (!enabled("finance")) {
    if (Array.isArray(value.orders)) value.orders = value.orders.map((order) => {
      if (!order || typeof order !== "object") return order;
      const safeOrder = { ...(order as Record<string, unknown>) };
      delete safeOrder.receivable_id;
      if (safeOrder.status === "completed") safeOrder.display_status = "completed";
      return safeOrder;
    });
    value.receipt_accounts = (enabled("orders") && Array.isArray(value.cash_accounts) ? value.cash_accounts : [])
      .filter((account) => account && typeof account === "object" && Boolean((account as Record<string, unknown>).active))
      .map((account) => ({
        id: String((account as Record<string, unknown>).id),
        name: String((account as Record<string, unknown>).name),
      }));
    for (const key of ["receivables", "cash", "installments", "cash_accounts", "card_rates"] as const) {
      if (Array.isArray(value[key])) value[key] = [];
    }
    if ("payment_settings" in value) value.payment_settings = null;
  }
  if (!enabled("inventory") && Array.isArray(value.movements)) value.movements = [];
  if (!enabled("settings")) {
    if ("parts_pricing" in value) delete value.parts_pricing;
    if ("catalog_mode" in value) delete value.catalog_mode;
  }
  return value as T;
}

export function uiModuleForPath(path: string): WorkshopModuleKey | null {
  return moduleForUiPath(path);
}

