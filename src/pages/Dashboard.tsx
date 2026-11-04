import { PLATFORM } from "../../shared/platformIdentity";
import { needsReplenishment } from "../../shared/stockThreshold";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Plus,
  ArrowUpRight,
  Wallet,
  ClipboardList,
  Clock3,
  CheckCheck,
  ArrowRight,
  Package,
  CalendarDays,
  ChevronRight,
  Wrench,
} from "lucide-react";
import { useApp } from "../lib/context";
import { money, today, dateLabel, type Order } from "../lib/types";
import { PageHeading, Stat, PanelHeading, Empty } from "../components/ui";
import { revenueBreakdown, displayStatus, workshopDate } from "../lib/workflow";
import { OrderTable } from "../components/OrderTable";
export function Dashboard() {
  const { data, session } = useApp();
  const navigate = useNavigate();
  const [period, setPeriod] = useState(30);
  const [tab, setTab] = useState("active");
  const start = new Date(today() + "T12:00:00");
  start.setDate(start.getDate() - period + 1);
  const startKey = start.toISOString().slice(0, 10);
  const revenue = revenueBreakdown(data.orders, startKey, today());
  const received = data.cash
    .filter((c) => workshopDate(c.created_at) >= startKey && workshopDate(c.created_at) <= today())
    .reduce((s, c) => s + c.amount, 0);
  const open = data.orders.filter((o) =>
    ["open", "working", "ready"].includes(o.status),
  );
  const completed = data.orders.filter(
    (o) =>
      o.status === "completed" &&
      (o.completed_on || "").slice(0, 10) >= startKey,
  );
  const pending = data.receivables.filter((r) => r.status === "open");
  const pendingTotal = pending.reduce((s, r) => s + (r.balance ?? r.amount), 0);
  const low = data.catalog.filter(
    (c) => c.kind === "product" && c.active && needsReplenishment(c),
  );
  const due = [...open]
    .sort((a, b) => a.due_on.localeCompare(b.due_on))
    .slice(0, 3);
  const recent = data.orders
    .filter((o) =>
      tab === "active"
        ? o.status !== "quote" &&
          ["open", "working", "ready", "awaiting_payment"].includes(
            displayStatus(o),
          )
        : tab === "quotes"
          ? o.status === "quote"
          : displayStatus(o) === "completed",
    )
    .slice(0, 5);
  const chart = Array.from({ length: period }, (_, i) => {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    const key = d.toISOString().slice(0, 10);
    return {
      key,
      value: data.cash
        .filter((c) => workshopDate(c.created_at) === key)
        .reduce((s, c) => s + c.amount, 0),
    };
  });
  let accumulated = 0;
  const points = chart.map((c, i) => {
    accumulated += c.value;
    return { x: 40 + (i * 660) / (period - 1), value: accumulated };
  });
  const chartMax = Math.max(accumulated, 10000);
  const line = points
    .map((p) => `${p.x},${175 - (p.value / chartMax) * 135}`)
    .join(" ");
  const group = [
    { status: "open", label: "Aguardando início", color: "var(--amber)" },
    { status: "working", label: "Em execução", color: "var(--blue)" },
    { status: "ready", label: "Prontas para entrega", color: "var(--green)" },
  ];
  return (
    <>
      <PageHeading
        eyebrow="VISÃO GERAL"
        title={`Tudo pronto, ${session.user.name.split(" ")[0]}?`}
        description="Acompanhe sua oficina. Cuide do que realmente importa."
        actions={
          <>
            <select
              className="period-select"
              aria-label="Período do dashboard"
              value={period}
              onChange={(e) => setPeriod(Number(e.target.value))}
            >
              <option value={30}>Últimos 30 dias</option>
              <option value={7}>Últimos 7 dias</option>
            </select>
            <button
              className="button primary"
              onClick={() => navigate("/ordens/nova")}
            >
              <Plus size={18} />
              Nova ordem de serviço
            </button>
          </>
        }
      />
      <div className="stats-grid">
        <Stat
          label="Faturamento de peças"
          value={money(revenue.products)}
          detail="Vendas após descontos"
          icon={<Package size={18} />}
          accent
        />
        <Stat
          label="Lucro bruto das peças"
          value={money(revenue.productProfit)}
          detail={`Somente OS com custos informados · ${revenue.missingCostOrders} OS pendentes de custo`}
          icon={<ArrowUpRight size={18} />}
        />
        <Stat
          label="Faturamento de serviços"
          value={money(revenue.services)}
          detail="Serviços após descontos"
          icon={<Wrench size={18} />}
        />
        <Stat
          label="Recebimentos líquidos"
          value={money(received)}
          detail="Valores recebidos, descontadas as taxas"
          icon={<Wallet size={18} />}
        />
      </div>
      <p className="metric-note">
        Faturamento por conclusão do serviço nos últimos {period} dias.
        Descontos rateados entre peças e serviços. Lucro bruto antes de taxas e
        despesas da oficina.
      </p>
      <div className="dashboard-middle">
        <section className="panel revenue-panel">
          <PanelHeading
            title="Uma visão do seu resultado"
            subtitle="Recebimentos líquidos acumulados no período"
            action="Ver financeiro"
            onAction={() => navigate("/financeiro")}
          />
          <div className="chart-summary">
            <strong>{money(received)}</strong>
            <span>
              <i />
              Recebimentos
            </span>
          </div>
          <div className="chart">
            <svg
              viewBox="0 0 730 218"
              role="img"
              aria-label={`Gráfico de recebimentos acumulados em ${period} dias. Total ${money(received)}.`}
            >
              {[0, 1, 2, 3].map((n) => (
                <g key={n}>
                  <line
                    x1="40"
                    y1={40 + n * 45}
                    x2="708"
                    y2={40 + n * 45}
                    stroke="#edf0f2"
                    strokeDasharray="4 5"
                  />
                  <text x="0" y={44 + n * 45} fill="#91959f" fontSize="10">
                    {Math.round((chartMax / 100) * (1 - n / 3))}
                  </text>
                </g>
              ))}
              <defs>
                <linearGradient id="redFade" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#e32935" stopOpacity=".15" />
                  <stop offset="100%" stopColor="#e32935" stopOpacity="0" />
                </linearGradient>
              </defs>
              <polygon points={`40,180 ${line} 700,180`} fill="url(#redFade)" />
              <polyline
                points={line}
                fill="none"
                stroke="#e32935"
                strokeWidth="2.7"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {[
                0,
                Math.floor((period - 1) / 4),
                Math.floor((period - 1) / 2),
                Math.floor(((period - 1) * 3) / 4),
                period - 1,
              ].map((i) => (
                <text
                  key={i}
                  x={points[i].x}
                  y="208"
                  textAnchor="middle"
                  fill="#91959f"
                  fontSize="11"
                >
                  {dateLabel(chart[i].key)}
                </text>
              ))}
            </svg>
          </div>
          <div className="chart-footer">
            <span>
              <span className="tiny-dot red" />
              Dados atualizados nesta sessão
            </span>
            <span>BRL · R$</span>
          </div>
        </section>
        <section className="panel operation-panel">
          <PanelHeading
            title="O ritmo da oficina"
            subtitle="Ordens em andamento"
          />
          <div className="operation-total">
            <div className="round-icon">
              <Wrench size={25} />
            </div>
            <div>
              <strong>{open.length}</strong>
              <span>veículos em atendimento</span>
            </div>
          </div>
          <div className="stacked-bar">
            {group.map((g) => (
              <span
                key={g.status}
                style={{
                  background: g.color,
                  flex:
                    open.filter((o) => o.status === g.status).length || 0.03,
                }}
              />
            ))}
          </div>
          <div className="operation-rows">
            {group.map((g) => (
              <button
                key={g.status}
                onClick={() => navigate(`/ordens?status=${g.status}`)}
              >
                <span>
                  <i style={{ background: g.color }} />
                  {g.label}
                </span>
                <strong>
                  {String(
                    open.filter((o) => o.status === g.status).length,
                  ).padStart(2, "0")}
                  <ChevronRight size={15} />
                </strong>
              </button>
            ))}
          </div>
          <div className="operation-tip">
            <Clock3 size={16} />
            <span>
              {open.filter((o) => o.due_on < today()).length} ordens com entrega
              em atraso
            </span>
          </div>
        </section>
      </div>
      <div className="dashboard-lower">
        <section className="panel orders-panel">
          <PanelHeading
            title="Ordens de serviço"
            action="Ver todas"
            onAction={() => navigate("/ordens")}
          />
          <div className="tabs compact">
            {[
              ["active", "Em andamento e a receber"],
              ["quotes", "Em orçamento"],
              ["completed", "Finalizadas"],
            ].map(([key, label]) => (
              <button
                className={tab === key ? "active" : ""}
                onClick={() => setTab(key)}
                key={key}
              >
                {label}
                {key === "active" && (
                  <span>
                    {
                      data.orders.filter(
                        (o) =>
                          o.status !== "quote" &&
                          [
                            "open",
                            "working",
                            "ready",
                            "awaiting_payment",
                          ].includes(displayStatus(o)),
                      ).length
                    }
                  </span>
                )}
              </button>
            ))}
          </div>
          <OrderTable orders={recent} />
          <div className="panel-foot">
            {recent.length} ordens exibidas
            <button
              className="text-button"
              onClick={() => navigate("/ordens/nova")}
            >
              Criar nova ordem
              <Plus size={14} />
            </button>
          </div>
        </section>
        <aside className="side-panels">
          <section className="panel delivery-panel">
            <PanelHeading title="Próximas entregas" />
            <div className="delivery-date">
              <CalendarDays size={15} />
              {new Date().toLocaleDateString("pt-BR", {
                day: "numeric",
                month: "long",
              })}
            </div>
            {due.length ? (
              due.map((o: Order) => (
                <button
                  className="delivery-item"
                  key={o.id}
                  onClick={() => navigate(`/ordens/${o.id}`)}
                >
                  <span
                    className={`delivery-marker ${o.status === "ready" ? "green" : ""}`}
                  />
                  <div>
                    <strong>
                      {o.brand} {o.model}
                    </strong>
                    <small>{o.customer_name}</small>
                    <span>
                      {dateLabel(o.due_on)} <b>·</b> {o.plate}
                    </span>
                  </div>
                  <ArrowUpRight size={16} />
                </button>
              ))
            ) : (
              <Empty
                title="Nenhuma entrega pendente"
                description="As novas ordens aparecerão aqui."
              />
            )}
          </section>
          <button
            className="stock-alert"
            onClick={() => navigate("/estoque?low=1")}
          >
            <span className="alert-icon">
              <Package size={20} />
            </span>
            <div>
              <strong>Atenção ao estoque</strong>
              <p>{low.length} produtos no estoque mínimo</p>
              <span>
                Conferir produtos
                <ArrowRight size={14} />
              </span>
            </div>
          </button>
        </aside>
      </div>
      <div className="workspace-footer">
        <span>
          {PLATFORM.name} <i /> {PLATFORM.description}
        </span>
        <span>Ambiente de demonstração · dados fictícios</span>
      </div>
    </>
  );
}
