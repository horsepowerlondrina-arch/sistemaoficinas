import type { Session } from "./types";
import type { Permission } from "../../shared/userPermissions";
export const can = (session: Session, permission: Permission) =>
  session.access
    ? session.access.permissions[permission]
    : session.role === "owner" ||
      ["orders.view", "orders.status", "orders.notes"].includes(permission);
export function canOpenPath(session: Session, path: string) {
  const p = path.split("?")[0];
  if (p === "/inicio" || p === "/suporte") return true;
  if (p.startsWith("/aprovacoes")) return can(session, "orders.discount");
  if (p.startsWith("/configuracoes"))
    return can(session, "settings.view") || can(session, "users.manage");
  if (p.startsWith("/ordens") || p.startsWith("/orcamentos"))
    return (
      can(session, "orders.view") &&
      (!/nova|novo|editar/.test(p) || can(session, "orders.edit")) &&
      (!p.endsWith("/receber") || can(session, "finance.receive"))
    );
  if (p.startsWith("/checklists")) return can(session, "checklists.view");
  if (
    p.startsWith("/cadastros") ||
    p.startsWith("/clientes") ||
    p.startsWith("/veiculos")
  )
    return can(session, "customers.view");
  if (p.startsWith("/catalogo") || p.startsWith("/servicos"))
    return can(session, "catalog.view") || can(session, "technical.view");
  if (p.startsWith("/profissionais")) return can(session, "staff.view");
  if (p.startsWith("/fornecedores")) return can(session, "catalog.view");
  if (p.startsWith("/estoque")) return can(session, "stock.view");
  if (p.startsWith("/financeiro")) return can(session, "finance.view");
  if (p.startsWith("/resultados")) return can(session, "finance.profit");
  if (p.startsWith("/dashboard")) return can(session, "finance.reports");
  return true;
}
