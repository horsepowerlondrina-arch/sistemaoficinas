import { Link } from "react-router-dom";
import {
  ArrowUpRight,
  LayoutDashboard,
  ClipboardList,
  ClipboardCheck,
  Users,
  CarFront,
  Package,
  Wrench,
  Wallet,
  Settings,
  ArrowDownLeft,
  ArrowUpRight as Receive,
} from "lucide-react";
import { useApp } from "../lib/context";

const sections = [
  {
    title: "Atendimento",
    items: [
      {
        to: "/checklists",
        title: "Checklists de entrada",
        description: "Fotos, avarias, acessórios e assinatura vinculados ao veículo.",
        Icon: ClipboardCheck,
      },
      {
        to: "/ordens",
        title: "Ordens de Serviço",
        description: "Acompanhe a OS desde o status Orçamento até a entrega.",
        Icon: ClipboardList,
      },
      {
        to: "/dashboard",
        title: "Visão geral",
        description: "Veja os indicadores e os resultados da oficina.",
        Icon: LayoutDashboard,
      },
    ],
  },
  {
    title: "Cadastros e estoque",
    items: [
      {
        to: "/cadastros",
        title: "Clientes e veículos",
        description: "Contatos, placas e histórico em um só lugar.",
        Icon: Users,
      },
      {
        to: "/catalogo",
        title: "Produtos e serviços",
        description: "Organize peças, serviços e preços do catálogo.",
        Icon: Wrench,
      },
      {
        to: "/estoque",
        title: "Estoque",
        description: "Controle saldos, entradas e saídas de peças.",
        Icon: Package,
      },
      {
        to: "/profissionais",
        title: "Profissionais",
        description: "Gerencie os profissionais da oficina.",
        Icon: Users,
      },
    ],
  },
  {
    title: "Financeiro e administração",
    items: [
      {
        to: "/financeiro",
        title: "Contas a pagar",
        description: "Organize despesas, vencimentos e pagamentos.",
        Icon: ArrowDownLeft,
      },
      {
        to: "/financeiro/receber",
        title: "Contas a receber",
        description: "Acompanhe recebimentos e parcelas pendentes.",
        Icon: Receive,
      },
      {
        to: "/financeiro/caixa",
        title: "Caixa",
        description: "Consulte as movimentações financeiras.",
        Icon: Wallet,
      },
      {
        to: "/configuracoes",
        title: "Configurações",
        description: "Ajuste os dados e as preferências da oficina.",
        Icon: Settings,
      },
    ],
  },
];
export function Home() {
  const { session } = useApp();
  const admin = session.role === "owner";
  return (
    <div className="module-home">
      <header className="module-home-heading">
        <span>{session.tenant.name}</span>
        <h1>Por onde vamos começar?</h1>
        <p>Escolha uma área para cuidar da sua oficina.</p>
      </header>
      {sections.map((section) => {
        const items = section.items.filter(
          (item) => admin || item.to === "/ordens",
        );
        if (!items.length) return null;
        return (
          <section
            className="module-section"
            key={section.title}
            aria-label={section.title}
          >
            <h2>{section.title}</h2>
            <div className="module-grid">
              {items.map(({ to, title, description, Icon }) => (
                <Link to={to} className="module-card" key={to}>
                  <div className="module-card-top">
                    <span className="module-icon">
                      <Icon size={23} aria-hidden="true" />
                    </span>
                    <ArrowUpRight
                      className="module-arrow"
                      size={19}
                      aria-hidden="true"
                    />
                  </div>
                  <h3>{title}</h3>
                  <p>{description}</p>
                </Link>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
