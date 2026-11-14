import {can} from '../lib/userAccess';
import {WorkshopUsers} from '../components/WorkshopUsers';
import { CardMachines, InstallmentInterestSettings } from "../components/CardMachines";
import { workshopDate } from "../lib/workflow";
import { NumericInput } from "../components/NumericInput";
import { PartsPricing } from "./PartsPricing";
import { LaborRates } from '../components/RepairServicePicker';
import { WorkshopProfile } from "../components/WorkshopProfile";
import { AccountSettings } from "../components/AccountSettings";
import { WorkshopBilling } from "../components/StripeBilling";
import { StockEntry } from "../components/StockEntry";
import { StockInvoiceImport } from "../components/StockInvoiceImport";
import { horsePowerExtensionEnabled } from "../../shared/horsePowerExtension";
import { needsReplenishment } from "../../shared/stockThreshold";
import { useState, useEffect } from "react";
import { useUnsavedSettings } from "../lib/useUnsavedSettings";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Package,
  ArrowDownLeft,
  ArrowUpRight,
  Wallet,
  Clock3,
  Check,
  ShieldCheck,
  Building2,
  Layers3,
  Download,
} from "lucide-react";
import { useApp } from "../lib/context";
import { send } from "../lib/api";
import { money, dateLabel, today, type Entity } from "../lib/types";
import {
  PageHeading,
  Stat,
  SearchBox,
  Empty,
  Modal,
  Field,
  Submit,
  Badge,
} from "../components/ui";
export function Stock() {
  const { data, refresh, notify } = useApp();
  const [params] = useSearchParams();
  const [entry, setEntry] = useState<Entity | null | undefined>(undefined);
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [low, setLow] = useState(params.has("low"));
  const [tab, setTab] = useState("balance");
  const [editing, setEditing] = useState<Entity | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const products = data.catalog.filter((c) => c.kind === "product" && c.active);
  const rows = products.filter(
    (c) =>
      (!low || needsReplenishment(c)) &&
      `${c.name} ${c.sku}`.toLowerCase().includes(search.toLowerCase()),
  );
  const adjust = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await send(`/stock/${editing!.id}`, { quantity, reason });
      await refresh();
      setEditing(null);
      notify("Estoque ajustado e movimentação registrada.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <PageHeading
        eyebrow="GESTÃO"
        title="Estoque"
        actions={
          <>
            <button className="button" onClick={() => setInvoiceOpen(true)}>Importar nota fiscal</button>
            <button className="button primary" onClick={() => setEntry(null)}>
              Entrada em estoque
            </button>
          </>
        }
        description="As peças certas, na quantidade certa. Sem perder o controle."
      />
      <div className="stats-grid three">
        <Stat
          label="Produtos cadastrados"
          value={products.length}
          detail="Itens ativos no catálogo"
          icon={<Package size={18} />}
        />
        <Stat
          label="Valor em estoque"
          value={money(products.reduce((s, p) => s + p.cost * p.stock, 0))}
          detail="Somente saldos e custos cadastrados; itens importados aguardam conferência."
          icon={<Wallet size={18} />}
        />
        <Stat
          label="Precisam de reposição"
          value={
            products.filter(needsReplenishment).length
          }
          detail="Somente produtos com estoque mínimo de 1 ou mais"
          icon={<Clock3 size={18} />}
        />
      </div>
      <section className="panel stock-panel">
        <div className="tabs">
          <button
            className={tab === "balance" ? "active" : ""}
            onClick={() => setTab("balance")}
          >
            Saldo dos produtos
          </button>
          <button
            className={tab === "history" ? "active" : ""}
            onClick={() => setTab("history")}
          >
            Movimentações
          </button>
        </div>
        <div className="table-toolbar">
          <SearchBox
            value={search}
            onChange={setSearch}
            placeholder="Buscar produto ou referência..."
          />
          {tab === "balance" && (
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={low}
                onChange={(e) => setLow(e.target.checked)}
              />
              Somente estoque mínimo
            </label>
          )}
        </div>
        {tab === "balance" ? (
          rows.length ? (
            <div className="table-scroll stock-table-scroll" role="region" aria-label="Saldos de estoque" tabIndex={0}>
              <table className="stock-balance-table">
                <colgroup><col className="stock-col-product" /><col className="stock-col-reference" /><col className="stock-col-available" /><col className="stock-col-minimum" /><col className="stock-col-prices" /><col className="stock-col-value" /><col className="stock-col-action" /></colgroup>
                <thead>
                  <tr>
                    <th>Produto</th>
                    <th>Referência</th>
                    <th>Disponível</th>
                    <th>Mínimo</th>
                    <th>Custo / venda unitários</th>
                    <th>Valor em estoque</th>
                    <th>Ação</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <strong>{p.name}</strong>
                        <small>{p.category}</small>
                      </td>
                      <td>{p.sku}</td>
                      <td>
                        <span
                          className={
                            needsReplenishment(p) ? "low-stock" : ""
                          }
                        >
                          {p.stock_verified === 0
                            ? "A conferir"
                            : `${p.stock} un.`}
                        </span>
                      </td>
                      <td>{p.minimum_stock > 0 ? `${p.minimum_stock} un.` : "Sob demanda"}</td>
                      <td>
                        {money(p.cost)} / {money(p.price)}
                        <small>Ganho bruto: {money(p.price - p.cost)}</small>
                      </td>
                      <td>
                        {p.stock_verified === 0 || p.cost_known === 0
                          ? "A conferir"
                          : money(p.stock * p.cost)}
                      </td>
                      <td>
                        <button
                          className="button small"
                          onClick={() => {
                            setEditing(p);
                            setQuantity(1);
                            setReason("");
                            setError("");
                          }}
                        >
                          Ajustar estoque
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty title={low ? "Nenhum produto precisa de reposição" : "Nenhum produto encontrado"} description={low ? "Produtos com estoque mínimo igual a zero não geram alerta." : "Tente outro termo de pesquisa ou cadastre produtos na área Produtos."} />
          )
        ) : (
          <div className="table-scroll stock-table-scroll" role="region" aria-label="Movimentações de estoque" tabIndex={0}>
            <table className="stock-history-table">
              <thead>
                <tr>
                  <th>Movimento</th>
                  <th>Produto</th>
                  <th>Quantidade</th>
                  <th>Referência / motivo</th>
                  <th>Data</th>
                  <th>Responsável</th>
                </tr>
              </thead>
              <tbody>
                {data.movements
                  .filter((m) =>
                    m.product_name.toLowerCase().includes(search.toLowerCase()),
                  )
                  .map((m) => (
                    <tr key={m.id}>
                      <td>
                        <span
                          className={`movement-type ${m.quantity > 0 ? "positive" : "negative"}`}
                        >
                          {m.quantity > 0 ? (
                            <ArrowDownLeft size={16} />
                          ) : (
                            <ArrowUpRight size={16} />
                          )}{" "}
                          {m.quantity > 0 ? "Entrada" : "Saída"}
                        </span>
                      </td>
                      <td>{m.product_name}</td>
                      <td>{Math.abs(m.quantity)} un.</td>
                      <td>{m.reason}</td>
                      <td>{dateLabel(m.created_at)}</td>
                      <td>{m.user_name}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="panel-foot">
          {tab === "balance"
            ? rows.length + " produtos"
            : "Movimentações registradas com responsável e origem"}
        </div>
      </section>
      {invoiceOpen && <StockInvoiceImport onClose={() => setInvoiceOpen(false)} />}
      {entry !== undefined && (
        <StockEntry
          initial={entry || undefined}
          onClose={() => setEntry(undefined)}
        />
      )}
      {editing && (
        <Modal
          title="Ajustar estoque"
          description={`${editing.name} · Saldo atual: ${editing.stock} unidades`}
          onClose={() => setEditing(null)}
        >
          <form onSubmit={adjust}>
            <div className="modal-body form-grid">
              <Field label="Quantidade a movimentar" full>
                <NumericInput
                  type="number"
                  required
                  step="1"
                  min={-editing.stock}
                  value={quantity}
                  onChange={(e) => setQuantity(Number(e.target.value))}
                />
                <small>
                  Positivo para entrada, negativo para saída. Novo saldo:{" "}
                  {editing.stock + quantity}.
                </small>
              </Field>
              <Field label="Motivo do ajuste" full>
                <textarea
                  required
                  minLength={5}
                  maxLength={200}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Ex.: reposição de peças ou correção de inventário"
                />
              </Field>
              {error && (
                <div className="error-box full" role="alert">
                  {error}
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="button"
                onClick={() => setEditing(null)}
              >
                Cancelar
              </button>
              <Submit busy={busy}>Confirmar ajuste</Submit>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
export function Finance() {
  const { data } = useApp();
  const navigate = useNavigate();
  const [tab, setTab] = useState("open");
  const [search, setSearch] = useState("");
  const open = data.receivables.filter((r) => r.status === "open");
  const rows = data.receivables.filter(
    (r) =>
      (tab === "all" || r.status === tab) &&
      `${r.description} ${r.customer_name}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  return (
    <>
      <PageHeading
        title="Contas a receber"
        description="Clareza sobre os recebimentos e os próximos passos da oficina."
      />
      <div className="stats-grid three">
        <Stat
          label="Total a receber"
          value={money(open.reduce((s, r) => s + r.balance, 0))}
          detail={`${open.length} contas em aberto`}
          icon={<Clock3 size={18} />}
        />
        <Stat
          label="Recebimentos registrados"
          value={money(data.cash.filter((c) => workshopDate(c.created_at)<=today()).reduce((s, c) => s + c.amount, 0))}
          detail="Total de entradas no caixa"
          icon={<Wallet size={18} />}
          accent
        />
        <Stat
          label="Recebíveis vencidos"
          value={money(
            open
              .filter((r) => (!r.plan_configured || r.method === "Cartão de crédito") && r.due_on < today())
              .reduce((sum, r) => sum + (r.balance ?? r.amount), 0) +
              data.installments
                .filter((p) => p.method !== "Cartão de crédito" && p.status === "open" && p.due_on < today())
                .reduce((sum, p) => sum + p.gross, 0),
          )}
          detail="Contas em aberto anteriores a hoje"
          icon={<Clock3 size={18} />}
        />
      </div>
      <section className="panel">
        <div className="tabs">
          {[
            ["open", "A receber"],
            ["paid", "Recebidas"],
            ["all", "Todas as contas"],
            ["cash", "Entradas no caixa"],
          ].map(([key, label]) => (
            <button
              key={key}
              className={tab === key ? "active" : ""}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="table-toolbar">
          <SearchBox
            value={search}
            onChange={setSearch}
            placeholder="Buscar cliente ou número da OS..."
          />
          <span className="muted">
            Recebíveis gerados pelas ordens finalizadas
          </span>
        </div>
        {tab === "cash" ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Origem</th>
                  <th>Forma de pagamento</th>
                  <th>Cliente pagou</th>
                  <th>Taxa da oficina</th>
                  <th>Líquido recebido</th>
                </tr>
              </thead>
              <tbody>
                {data.cash
                  .filter((c) => {
                    const r = data.receivables.find(
                      (r) => r.id === c.receivable_id,
                    );
                    return `${r?.description} ${r?.customer_name}`
                      .toLowerCase()
                      .includes(search.toLowerCase());
                  })
                  .map((c) => (
                    <tr key={c.id}>
                      <td>{dateLabel(c.created_at)}{workshopDate(c.created_at)>today() && <small>Crédito agendado</small>}</td>
                      <td>
                        {
                          data.receivables.find((r) => r.id === c.receivable_id)
                            ?.description
                        }
                      </td>
                      <td>{c.method}</td>
                      <td>{money(c.gross_amount)}</td>
                      <td>{money(c.fee_amount)}</td>
                      <td className="positive money">+ {money(c.amount)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        ) : rows.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Origem / cliente</th>
                  <th>Vencimento</th>
                  <th>Total / saldo</th>
                  <th>Situação</th>
                  <th>Forma de pagamento</th>
                  <th>Ação</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <button
                        className="cell-link"
                        onClick={() => navigate(`/ordens/${r.order_id}`)}
                      >
                        {r.description}
                      </button>
                      <small>{r.customer_name}</small>
                    </td>
                    <td>
                      <span
                        className={
                          r.status === "open" && r.due_on < today()
                            ? "negative"
                            : ""
                        }
                      >
                        {dateLabel(r.due_on)}
                        {r.status === "open" && r.due_on < today()
                          ? " · Vencida"
                          : ""}
                      </span>
                    </td>
                    <td className="money">
                      {money(r.gross_total)}
                      <small>Saldo: {money(r.balance)}</small>
                    </td>
                    <td>
                      <Badge
                        status={r.status === "paid" ? "paid" : "A receber"}
                      />
                    </td>
                    <td>{r.method || "A definir"}</td>
                    <td>
                      {r.status === "open" ? (
                        <button
                          className="button small"
                          onClick={() => {
                            navigate(`/ordens/${r.order_id}/receber`);
                          }}
                        >
                          <Check size={15} />
                          Receber
                        </button>
                      ) : (
                        <span className="muted">
                          {(r.paid_at || "").slice(0,10)>today() ? "Crédito agendado para " : "Baixada em "}{dateLabel(r.paid_at)}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title="Nenhuma conta nesta consulta"
            description="Finalize uma OS para gerar seu recebível."
          />
        )}
        <div className="panel-foot">
          {tab === "cash"
            ? "Cada recebimento gera uma única entrada no caixa."
            : `${rows.length} contas · ${money(rows.reduce((s, r) => s + r.balance, 0))}`}
        </div>
      </section>
    </>
  );
}
export function Settings() {
  const [params, setParams] = useSearchParams();
  const { session, data, refresh, notify } = useApp();
  const tabs = [["oficina","Dados da oficina"],["geral","Taxas e parcelamento"],["servicos","Mão de obra por porte"],["pecas","Lucro de peças e terceiros"],["assinatura","Assinatura e pagamentos"],["conta","Conta"],["usuarios","Usuários e funcionários"]].filter(([id])=>id==="usuarios"?!!session.access&&can(session,"users.manage"):id==="assinatura"?session.role==="owner":["geral","servicos","pecas"].includes(id)?can(session,id==="geral"?"settings.finance":"settings.manage"):can(session,"settings.view"));
  const requestedTab = params.get("aba");
  const activeTab = tabs.some(([id]) => id === requestedTab) ? requestedTab! : "oficina";
  useEffect(() => {
    if (requestedTab && requestedTab !== activeTab) setParams({aba: activeTab}, {replace: true});
  }, [requestedTab, activeTab, setParams]);
  const financeEnabled = session.modules?.finance !== false;
  return <>
    <PageHeading eyebrow="ADMINISTRAÇÃO" title="Configurações" description="Dados, documentos e regras comerciais da sua oficina." />
    <div className="tabs settings-tabs" aria-label="Seções de configurações">
      {tabs.map(([id,label]) => <button key={id} type="button" data-settings-tab={id} aria-current={activeTab === id ? "page" : undefined} className={activeTab === id ? "active" : ""} onClick={() => setParams({aba:id})}>{label}</button>)}
    </div>
    {activeTab === "oficina" ? <WorkshopProfile key={session.tenant.id} /> :
      activeTab === "usuarios" ? <WorkshopUsers/> :
      activeTab === "servicos" ? <LaborRates /> :
      activeTab === "pecas" ? <PartsPricing /> :
      activeTab === "assinatura" ? <WorkshopBilling tenantId={session.tenant.id}/> :
      activeTab === "conta" ? <div className="settings-grid">
        <AccountSettings />
        {horsePowerExtensionEnabled(session.tenant.id) && (
          <section className="panel settings-card">
            <Download size={23} />
            <h2>Extensão Horse Power · Sky Peças</h2>
            <p>Conecte a extensão da Horse Power para capturar peças do Sky Peças e revisar os itens antes de concluir a captura.</p>
            <a className="button primary" href="https://chromewebstore.google.com/detail/ddmnjpmldgnjefjkachlpicngaphlobf" target="_blank" rel="noopener noreferrer">
              <Download size={16} />
              Abrir Chrome Web Store
            </a>
          </section>
        )}

      </div> :
      !financeEnabled ? <section className="panel work-order-section"><h2>Financeiro não habilitado</h2><p>As taxas pertencem ao módulo Financeiro. Solicite a habilitação à administração da plataforma para consultar ou alterar estas configurações.</p></section> :
      <><CardMachines /><InstallmentInterestSettings /></>}
  </>;
}

