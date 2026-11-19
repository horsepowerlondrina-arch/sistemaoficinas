import {
  ClipboardCheck,
  ClipboardList,
  LayoutDashboard,
  Package,
  Settings,
  Users,
  Wallet,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { uiModuleForPath } from "../../shared/workshopModules";
import {can,canOpenPath} from "./userAccess";
import type { Session } from "./types";

export type WorkshopNavItem = {
  path: string;
  label: string;
  description: string;
  Icon: LucideIcon;
};

type WorkshopNavGroup = {
  title: string;
  items: WorkshopNavItem[];
};

export const workshopNavGroups: WorkshopNavGroup[] = [
  {
    title: "PRINCIPAL",
    items: [
      { path: "/dashboard", label: "Visão geral", description: "Indicadores e resultados da oficina.", Icon: LayoutDashboard },
      { path: "/checklists", label: "Checklists de entrada", description: "Registre fotos, avarias, acessórios e assinatura.", Icon: ClipboardCheck },
      { path: "/ordens", label: "Ordens de Serviço", description: "Acompanhe orçamentos e atendimentos até a entrega.", Icon: ClipboardList },
    ],
  },
  {
    title: "CADASTROS",
    items: [
      { path: "/cadastros", label: "Clientes e veículos", description: "Contatos, placas e histórico em um só lugar.", Icon: Users },
      { path: "/catalogo", label: "Produtos", description: "Consulte e organize as peças da oficina.", Icon: Package },
      { path: "/servicos", label: "Serviços", description: "Consulte os serviços disponíveis para a oficina.", Icon: Wrench },
      { path: "/profissionais", label: "Profissionais", description: "Gerencie os profissionais da oficina.", Icon: Wrench },
      { path: "/fornecedores", label: "Fornecedores", description: "Consulte e mantenha os fornecedores cadastrados.", Icon: Package },
    ],
  },
  {
    title: "GESTÃO",
    items: [
      { path: "/estoque", label: "Estoque", description: "Controle saldos, entradas e saídas de peças.", Icon: Package },
      { path: "/financeiro", label: "Financeiro", description: "Acesse contas a pagar, a receber e caixa.", Icon: Wallet },
    ],
  },
];

const settingsItem: WorkshopNavItem = {
  path: "/configuracoes",
  label: "Configurações",
  description: "Ajuste os dados e as preferências da oficina.",
  Icon: Settings,
};

export function visibleWorkshopNavigation(session: Session) {
  const admin = session.role === "owner" || !!session.access;
  const available = (path: string) => {
    if(!canOpenPath(session,path)) return false;
    const module = path === "/servicos" && !can(session,"catalog.view") && can(session,"technical.view") ? "technical_catalog" : uiModuleForPath(path);
    return !module || session.modules?.[module] !== false;
  };
  const groups = admin
    ? workshopNavGroups.map((group) => ({ ...group, items: group.items.filter((item) => available(item.path)) })).filter((group) => group.items.length)
    : [{ title: "OPERAÇÃO", items: workshopNavGroups[0].items.filter((item) => item.path === "/ordens" && available(item.path)) }];
  const footer = admin && available(settingsItem.path) ? [settingsItem] : [];
  return { groups, footer };
}
