import type { WorkshopModuleKey } from "./workshopModules";

export const permissionDefinitions = {
  "checklists.view": ["checklists", "Visualizar checklists"],
  "checklists.create": ["checklists", "Criar checklists"],
  "checklists.edit": ["checklists", "Editar checklists"],
  "checklists.finalize": ["checklists", "Finalizar checklists"],
  "orders.basic_receive": ["orders", "Registrar recebimento simples da OS"],
  "orders.view": ["orders", "Visualizar OS"],
  "orders.notes": ["orders", "Editar observações operacionais"],
  "orders.edit": ["orders", "Criar e editar OS"],
  "orders.items": ["orders", "Adicionar peças e serviços"],
  "orders.status": ["orders", "Alterar status"],
  "orders.assign": ["orders", "Atribuir funcionários"],
  "orders.admin": ["orders", "Ações administrativas da OS"],
  "orders.finalize": ["orders", "Finalizar OS"],
  "orders.reopen": ["orders", "Reabrir OS"],
  "orders.prices": ["orders", "Visualizar valores comerciais"],
  "orders.discount": ["orders", "Aplicar descontos"],
  "orders.approve": ["orders", "Aprovar descontos"],
  "customers.view": ["customers_vehicles", "Consultar clientes e veículos"],
  "customers.create": ["customers_vehicles", "Cadastrar clientes e veículos"],
  "customers.edit": ["customers_vehicles", "Editar clientes e veículos"],
  "customers.remove": ["customers_vehicles", "Inativar clientes e veículos"],
  "personal.contact": ["customers_vehicles", "Telefone e WhatsApp"],
  "personal.email": ["customers_vehicles", "E-mail"],
  "personal.address": ["customers_vehicles", "Endereço"],
  "personal.full": ["customers_vehicles", "Cadastro completo"],
  "personal.history": ["orders", "Histórico do cliente"],
  "catalog.view": ["catalog", "Consultar produtos e serviços"],
  "catalog.create": ["catalog", "Cadastrar produtos e serviços"],
  "catalog.edit": ["catalog", "Editar produtos e serviços"],
  "catalog.remove": ["catalog", "Inativar produtos e serviços"],
  "catalog.prices": ["catalog", "Alterar preços e custos"],
  "stock.view": ["inventory", "Consultar estoque"],
  "stock.manage": ["inventory", "Movimentar estoque"],
  "technical.view": ["technical_catalog", "Consultar tempos e aplicações"],
  "technical.rates": ["technical_catalog", "Consultar tarifas"],
  "settings.view": ["settings", "Consultar configurações"],
  "settings.manage": ["settings", "Administrar configurações operacionais"],
  "settings.finance": ["settings", "Administrar configurações financeiras"],
  "users.manage": ["settings", "Gerenciar usuários e permissões"],
  "staff.view": ["professionals", "Consultar funcionários"],
  "staff.manage": ["professionals", "Administrar funcionários"],
  "finance.view": ["finance", "Consultar financeiro"],
  "finance.receive": ["finance", "Registrar recebimentos"],
  "finance.edit": ["finance", "Editar recebimentos"],
  "finance.reverse": ["finance", "Cancelar e estornar"],
  "finance.expenses": ["finance", "Administrar despesas"],
  "finance.costs": ["finance", "Visualizar custos e margens"],
  "finance.profit": ["finance", "Consultar lucratividade"],
  "finance.reports": ["finance", "Visualizar e exportar relatórios"],
  "finance.policies": ["finance", "Administrar máquinas, taxas e políticas"],
} as const satisfies Record<string, readonly [WorkshopModuleKey, string]>;
export type Permission = keyof typeof permissionDefinitions;
export type PermissionMap = Record<Permission, boolean>;
export const profileLabels = {
  master: "Master",
  manager: "Gerente",
  advisor: "Consultor de Serviços",
  mechanic: "Mecânico",
  finance: "Financeiro",
} as const;
export type UserProfile = keyof typeof profileLabels;
export const permissionKeys = Object.keys(
  permissionDefinitions,
) as Permission[];
const profiles: Record<UserProfile, Permission[]> = {
  master: permissionKeys,
  manager: permissionKeys.filter(
    (p) =>
      ![
        "users.manage",
        "settings.finance",
        "finance.policies",
        "finance.reverse",
        "orders.reopen",
      ].includes(p),
  ),
  advisor: [
    "orders.view",
    "orders.notes",
    "orders.edit",
    "orders.items",
    "orders.status",
    "orders.assign",
    "orders.prices",
    "orders.discount",
    "customers.view",
    "customers.create",
    "customers.edit",
    "personal.contact",
    "personal.email",
    "personal.address",
    "personal.full",
    "personal.history",
    "catalog.view",
    "technical.view",
    "technical.rates",
    "checklists.view",
    "checklists.create",
    "checklists.edit",
    "checklists.finalize",
    "staff.view",
  ],
  mechanic: [
    "orders.view",
    "orders.notes",
    "orders.status",
    "checklists.view",
    "technical.view",
  ],
  finance: [
    "orders.view",
    "orders.prices",
    "orders.discount",
    "finance.view",
    "finance.receive",
    "finance.edit",
    "finance.expenses",
    "finance.costs",
    "finance.profit",
    "finance.reports",
    "customers.view",
    "personal.contact",
    "personal.email",
  ],
};
export const dependencies: Partial<Record<Permission, Permission[]>> = {
  "orders.notes": ["orders.view"],
  "orders.edit": ["orders.view"],
  "orders.items": ["orders.edit", "orders.prices"],
  "orders.status": ["orders.view"],
  "orders.assign": ["orders.view", "staff.view"],
  "orders.finalize": ["orders.status"],
  "orders.reopen": ["orders.status"],
  "orders.prices": ["orders.view"],
  "orders.discount": ["orders.view", "orders.prices"],
  "orders.approve": ["orders.discount"],
  "checklists.create": ["checklists.view"],
  "checklists.edit": ["checklists.view"],
  "checklists.finalize": ["checklists.edit"],
  "customers.create": ["customers.view"],
  "customers.edit": ["customers.view"],
  "customers.remove": ["customers.edit"],
  "catalog.create": ["catalog.view"],
  "catalog.edit": ["catalog.view"],
  "catalog.remove": ["catalog.edit"],
  "catalog.prices": ["catalog.edit"],
  "stock.manage": ["stock.view"],
  "technical.rates": ["technical.view"],
  "settings.manage": ["settings.view"],
  "settings.finance": ["settings.view", "finance.policies"],
  "finance.receive": ["finance.view"],
  "finance.edit": ["finance.receive"],
  "finance.reverse": ["finance.edit"],
  "finance.expenses": ["finance.view"],
  "finance.costs": ["finance.view"],
  "finance.profit": ["finance.costs"],
  "finance.reports": ["finance.view"],
  "finance.policies": ["finance.view"],
  "staff.manage": ["staff.view"],
};
export function profileDefaults(profile: UserProfile): PermissionMap {
  if (!Object.hasOwn(profiles, profile)) throw new Error("Perfil inválido.");
  return Object.fromEntries(
    permissionKeys.map((key) => [key, profiles[profile].includes(key)]),
  ) as PermissionMap;
}
export function effectivePermissions(
  profile: UserProfile,
  overrides: Partial<PermissionMap> = {},
  modules?: Record<string, boolean>,
): PermissionMap {
  if (
    Object.keys(overrides).some(
      (key) =>
        !permissionKeys.includes(key as Permission) ||
        typeof overrides[key as Permission] !== "boolean",
    )
  )
    throw new Error("Permissão inválida.");
  const result = { ...profileDefaults(profile), ...overrides };
  // Master is an administrative role, never a partly customized model.
  if (profile === "master") Object.assign(result, profileDefaults("master"));
  for (const key of permissionKeys)
    if (modules?.[permissionDefinitions[key][0]] === false) result[key] = false;
  for (let i = 0; i < permissionKeys.length; i++)
    for (const key of permissionKeys)
      if (dependencies[key]?.some((dep) => !result[dep])) result[key] = false;
  // User administration remains reserved to Masters regardless of overrides.
  result["users.manage"] = profile === "master" && modules?.settings !== false;
  return result;
}
export function discountAllowed(
  subtotal: number,
  discount: number,
  limitBps: number,
  limitCents: number | null,
): boolean {
  if (
    ![subtotal, discount, limitBps].every(Number.isSafeInteger) ||
    subtotal < 0 ||
    discount < 0 ||
    discount > subtotal ||
    limitBps < 0 ||
    limitBps > 10000 ||
    (limitCents !== null &&
      (!Number.isSafeInteger(limitCents) || limitCents < 0))
  )
    return false;
  // Integer arithmetic avoids a fractional-cent increase in the user's allowance.
  return (
    BigInt(discount) * 10000n <= BigInt(subtotal) * BigInt(limitBps) &&
    (limitCents === null || discount <= limitCents)
  );
}
