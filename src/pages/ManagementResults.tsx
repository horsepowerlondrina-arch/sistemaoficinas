import { useEffect, useMemo, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { BarChart3, Wallet } from "lucide-react";
import { api, send } from "../lib/api";
import { useApp } from "../lib/context";
import { money } from "../lib/types";
import { workshopDate } from "../lib/workflow";
import { compareManagementPeriods, monthPeriod, weekPeriod, type ManagementPeriod } from "../lib/managementResults";
import { defaultManagementResultsSettings, type ManagementResultsSettings } from "../../shared/managementResultsSettings";
import { Field, PageHeading, Stat } from "../components/ui";
import "./managementResults.css";

const decimal = (value: number, digits = 2) => value.toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
const percent = (value: number | null) => value === null ? "—" : decimal(value * 100, 1) + "%";
const date = (value: string) => value.split("-").reverse().join("/");
const difference = (current: number, prior: number) => prior ? `${current >= prior ? "+" : ""}${percent(current / prior - 1)}` : "Sem base anterior";

function ResultsContent({ report, company, configured }: { report: ReturnType<typeof compareManagementPeriods>; company: string; configured: boolean }) {
  const { current, prior } = report;
  const { production, estimated, parts, cash, receivables, stock } = current;
  return <div className="management-results-content">
    <header className="management-results-report-head">
      <h2>Resultados · {company}</h2>
      <p>De {date(current.period.from)} até {date(current.period.to)} · {current.period.days} dias inclusivos</p>
      <p className="muted">Valor das OS pela finalização; recebimentos pela data do pagamento. São bases de tempo diferentes.</p>
    </header>
    {current.period.partial && <p className="management-results-notice" role="status">O intervalo ainda está em andamento. Os totais e o semáforo refletem apenas os lançamentos feitos até hoje.</p>}
    {!configured && <p className="management-results-notice" role="status">Valor da hora, capacidade e metas usam valores iniciais de referência. Ajuste a configuração para refletir esta oficina.</p>}
    {estimated.missingCostOrders > 0 && <p className="management-results-notice" role="status">{estimated.missingCostOrders} OS com custo de peça não informado ficaram fora do resultado e da margem. A venda permanece no total de OS.</p>}
    {estimated.inconsistentOrders > 0 && <p className="management-results-notice" role="status">{estimated.inconsistentOrders} OS com diferença entre itens, desconto e valor final. Confira o detalhamento antes de interpretar o resultado.</p>}
    {cash.dateFallbacks > 0 && <p className="management-results-notice" role="status">{cash.dateFallbacks} pagamento(s) sem data na parcela usaram a data do lançamento.</p>}
    <section className="management-results-section" aria-label="Visão geral">
      <h3>Visão geral</h3>
      <div className="stats-grid">
        <Stat label="Valor das OS" value={money(production.sale)} detail={`${production.count} OS finalizadas · ${difference(production.sale, prior.production.sale)} ante período anterior`} icon={<BarChart3 size={18} />} accent />
        <Stat label="Ticket médio" value={production.ticket === null ? "—" : money(production.ticket)} detail="Valor das OS ÷ quantidade finalizada" icon={<Wallet size={18} />} />
        <Stat label="Resultado estimado conhecido" value={money(estimated.result)} detail={`${percent(estimated.margin)} de margem nas OS com custo completo`} icon={<BarChart3 size={18} />} />
        <Stat label="Caixa recebido bruto" value={money(cash.gross)} detail={`${cash.orderCount} OS com pagamento no intervalo`} icon={<Wallet size={18} />} />
      </div>
      <p className="muted">Resultado estimado = valor da OS após desconto − custo das peças − custo de terceiros − taxas realizadas. Não inclui mão de obra interna, impostos ou despesas gerais.</p>
    </section>
    <div className="management-results-grid">
      <section className="panel management-results-section">
        <h3>Produção e mão de obra</h3>
        <dl>
          <div><dt>Serviços vendidos</dt><dd>{money(production.servicesSale)}</dd></div>
          <div><dt>Custo de terceiros</dt><dd>{money(production.thirdCost)}</dd></div>
          <div><dt>Horas equivalentes</dt><dd>{decimal(production.hours)} h</dd></div>
          <div><dt>Capacidade no intervalo</dt><dd>{decimal(production.capacity)} h</dd></div>
          <div><dt>Ocupação</dt><dd>{percent(production.occupancy)}</dd></div>
          <div><dt>Semáforo</dt><dd><span className={`management-light ${production.light}`}>{production.light}</span></dd></div>
        </dl>
        <p className="muted">Horas = (serviços vendidos − custo de terceiros) ÷ valor da hora. Limites semanais proporcionais aos {current.period.days} dias; não dependem da duração cadastrada.</p>
      </section>
      <section className="panel management-results-section">
        <h3>Peças</h3>
        <dl>
          <div><dt>Venda antes dos descontos</dt><dd>{money(parts.sale)}</dd></div>
          <div><dt>Custo conhecido com frete</dt><dd>{money(parts.knownCost)}</dd></div>
          <div><dt>Margem conhecida</dt><dd>{money(parts.margin)} · {percent(parts.marginPct)}</dd></div>
          <div><dt>OS sem custo completo</dt><dd>{parts.missingCostOrders}</dd></div>
          <div><dt>OS com custo consolidado</dt><dd>{estimated.consolidatedCostOrders}</dd></div>
        </dl>
        <p className="muted">Custo zero de peça significa custo não informado. Custo consolidado positivo da OS pode suprir itens antigos sem detalhe. Compra de estoque não é descontada novamente.</p>
      </section>
      <section className="panel management-results-section">
        <h3>Recebimentos e valores em aberto</h3>
        <dl>
          <div><dt>Descontos das OS</dt><dd>{money(estimated.discount)}</dd></div>
          <div><dt>Taxas realizadas dessas OS</dt><dd>{money(estimated.fees)}</dd></div>
          <div><dt>Recebido bruto no intervalo</dt><dd>{money(cash.gross)}</dd></div>
          <div><dt>Taxas dos pagamentos no intervalo</dt><dd>{money(cash.fees)}</dd></div>
          <div><dt>Recebido líquido no intervalo</dt><dd>{money(cash.net)}</dd></div>
          <div><dt>Contas a receber agora</dt><dd>{money(receivables.openBalance)} · {receivables.openCount} contas</dd></div>
        </dl>
        <p className="muted">Recebimento e taxas do caixa seguem a data efetiva do pagamento, mesmo quando a OS foi finalizada em outro período. Contas a receber são a posição atual.</p>
      </section>
      <section className="panel management-results-section">
        <h3>Metas e estoque</h3>
        <p className="muted">Metas configuradas originalmente para ciclo 15→14, comparadas aqui com o intervalo escolhido. Horas faltantes supõem 100% de mão de obra; não são previsão do mix de vendas.</p>
        <dl>{current.goals.map(goal => <div key={goal.target}><dt>{money(goal.target)}</dt><dd>{percent(goal.progress)} · faltam {money(goal.remaining)} ({decimal(goal.remainingHours, 1)} h)</dd></div>)}</dl>
        <p>Produtos no estoque mínimo: <strong>{stock.lowCount}</strong> <span className="muted">(posição atual)</span></p>
      </section>
    </div>
    <section className="panel management-results-section">
      <h3>Comparação e OS</h3>
      <p>Período anterior com os mesmos {current.period.days} dias: {date(prior.period.from)} a {date(prior.period.to)} · {money(prior.production.sale)} em OS · {prior.production.count} finalizadas · {money(prior.estimated.result)} de resultado conhecido.</p>
      <p className="muted">Comparação baseada nos registros disponíveis. Média de quatro períodos indisponível enquanto a cobertura histórica não puder ser confirmada.</p>
      <div className="report-table-scroll"><table>
        <thead><tr><th>OS</th><th>Cliente</th><th>Finalização</th><th>Valor</th><th>Resultado</th><th>Margem</th></tr></thead>
        <tbody>{[...current.orders].sort((a, b) => (b.result ?? -Infinity) - (a.result ?? -Infinity)).map(order => <tr key={order.id}>
          <td><Link to={`/ordens/${order.id}`}>#{order.number}</Link></td><td>{order.customer}</td><td>{date(order.completed_on)}</td>
          <td>{money(order.total)}</td><td>{order.result === null ? "Custo não informado" : money(order.result)}</td><td>{percent(order.margin)}</td>
        </tr>)}
        {!current.orders.length && <tr><td colSpan={6}>Nenhuma OS finalizada no intervalo.</td></tr>}</tbody>
      </table></div>
    </section>
    <details className="panel management-results-section"><summary>Conferência dos cálculos</summary>
      <dl>
        <div><dt>OS com custo completo</dt><dd>{current.orders.length - estimated.missingCostOrders}</dd></div>
        <div><dt>OS com custo consolidado</dt><dd>{estimated.consolidatedCostOrders}</dd></div>
        <div><dt>OS com custo consolidado diferente do detalhe</dt><dd>{estimated.aggregateDifferenceOrders}</dd></div>
        <div><dt>OS com diferença entre itens e valor</dt><dd>{estimated.inconsistentOrders}</dd></div>
        <div><dt>Venda dessas OS</dt><dd>{money(estimated.knownSale)}</dd></div>
        <div><dt>Custo registrado nas peças</dt><dd>{money(parts.recordedCost)}</dd></div>
        <div><dt>Limite amarelo no intervalo</dt><dd>{decimal(production.yellow)} h</dd></div>
        <div><dt>Limite verde no intervalo</dt><dd>{decimal(production.green)} h</dd></div>
      </dl>
    </details>
  </div>;
}

export function ManagementResults() {
  const { data, session, notify } = useApp();
  const todayKey = workshopDate(new Date().toISOString());
  const [draft, setDraft] = useState<ManagementPeriod>({ from: todayKey.slice(0, 7) + "-01", to: todayKey });
  const [period, setPeriod] = useState(draft);
  const [settings, setSettings] = useState<ManagementResultsSettings>(defaultManagementResultsSettings);
  const [configured, setConfigured] = useState(false);
  const [editable, setEditable] = useState(settings);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [printOpen, setPrintOpen] = useState(false);
  useEffect(() => { void api<ManagementResultsSettings & { configured: boolean }>("/management-results/settings")
    .then(value => { setSettings(value); setEditable(value); setConfigured(value.configured); }).catch(e => setError((e as Error).message)); }, []);
  useEffect(() => { if (!printOpen) return; document.body.classList.add("printing-os-results"); return () => document.body.classList.remove("printing-os-results"); }, [printOpen]);
  const report = useMemo(() => compareManagementPeriods(data, period, settings), [data, period, settings]);
  const apply = (event: FormEvent) => {
    event.preventDefault();
    try { compareManagementPeriods(data, draft, settings); setPeriod(draft); setError(""); }
    catch (e) { setError((e as Error).message); }
  };
  const selectCurrentPeriod = (shortcut: typeof weekPeriod) => {
    const selected = shortcut(workshopDate(new Date().toISOString()));
    setDraft(selected);
    setPeriod(selected);
    setError("");
  };
  const saveSettings = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const value = await send("/management-results/settings", editable, "PUT") as ManagementResultsSettings & { configured: boolean };
      setSettings(value); setEditable(value); setConfigured(true); notify("Configuração dos resultados atualizada.");
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  const setCurrency = (key: "hourly_rate", value: string) => setEditable(current => ({ ...current, [key]: Math.round(Number(value) * 100) }));
  return <>
    <PageHeading title="Resultados" description="Produção, resultado estimado e recebimentos da sua oficina no intervalo escolhido." />
    {error && <div className="error-box" role="alert">{error}</div>}
    <section className="panel management-results-filter">
      <form onSubmit={apply}>
        <div className="report-filter-dates">
          <Field label="Data inicial"><input type="date" required value={draft.from} onChange={e => setDraft({ ...draft, from: e.target.value })} /></Field>
          <Field label="Data final"><input type="date" required min={draft.from} value={draft.to} onChange={e => setDraft({ ...draft, to: e.target.value })} /></Field>
        </div>
        <div className="report-actions">
          <button className="button primary" type="submit">Aplicar período</button>
          <button className="button" type="button" title="Aplicar a semana atual, de segunda a domingo" onClick={() => selectCurrentPeriod(weekPeriod)}>Semana</button>
          <button className="button" type="button" title="Aplicar o mês atual, do primeiro ao último dia" onClick={() => selectCurrentPeriod(monthPeriod)}>Mês</button>
          <button className="button" type="button" onClick={() => setPrintOpen(true)}>Relatório / PDF</button>
        </div>
      </form>
    </section>
    <ResultsContent report={report} company={session.tenant.name} configured={configured} />
    <details className="panel management-results-section management-results-settings">
      <summary>Configurar metas e capacidade</summary>
      <form onSubmit={saveSettings}>
        <p className="muted">Valores iniciais de referência. Ajuste para a capacidade e as metas desta oficina.</p>
        <div className="management-settings-grid">
          <Field label="Valor da hora (R$)"><input type="number" min="0.01" max="100000" step="0.01" value={editable.hourly_rate / 100} onChange={e => setCurrency("hourly_rate", e.target.value)} required /></Field>
          <Field label="Capacidade semanal (h)"><input type="number" min="0.01" max="10000" step="0.01" value={editable.weekly_capacity} onChange={e => setEditable({ ...editable, weekly_capacity: Number(e.target.value) })} required /></Field>
          <Field label="Amarelo a partir de (h/semana)"><input type="number" min="0" max="10000" step="0.01" value={editable.yellow_hours} onChange={e => setEditable({ ...editable, yellow_hours: Number(e.target.value) })} required /></Field>
          <Field label="Verde a partir de (h/semana)"><input type="number" min="0.01" max="10000" step="0.01" value={editable.green_hours} onChange={e => setEditable({ ...editable, green_hours: Number(e.target.value) })} required /></Field>
          {editable.goals.map((goal, index) => <Field key={index} label={`Meta ${index + 1} (R$)`}><input type="number" min="0.01" max="10000000" step="0.01" value={goal / 100} onChange={e => setEditable(current => ({ ...current, goals: current.goals.map((item, i) => i === index ? Math.round(Number(e.target.value) * 100) : item) }))} required /></Field>)}
        </div>
        <button className="button primary" type="submit" disabled={busy}>{busy ? "Salvando..." : "Salvar configuração"}</button>
      </form>
    </details>
    {printOpen && createPortal(<div className="os-results-print"><ResultsContent report={report} company={session.tenant.name} configured={configured} /></div>, document.body)}
    {printOpen && <div className="management-print-actions no-print" role="dialog" aria-label="Exportar resultados"><button className="button primary" onClick={() => window.print()}>Imprimir / salvar PDF</button><button className="button" onClick={() => setPrintOpen(false)}>Fechar</button></div>}
  </>;
}
