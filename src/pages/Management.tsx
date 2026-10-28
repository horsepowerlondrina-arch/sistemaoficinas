import { workshopDate } from "../lib/workflow";
import { NumericInput } from "../components/NumericInput";
import { PartsPricing } from "./PartsPricing";
import { LaborRates } from '../components/RepairServicePicker';
import { WorkshopProfile } from "../components/WorkshopProfile";
import { RegisterModal } from "./Registers";
import { CapturePanel } from "../components/CapturePanel";
import { StockEntry } from "../components/StockEntry";
import { StockInvoiceImport } from "../components/StockInvoiceImport";
import { useState } from "react";
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
  const [adding, setAdding] = useState(false),
    [capture, setCapture] = useState(false);
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
      (!low || (c.stock_verified !== 0 && c.stock <= c.minimum_stock)) &&
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
            <button className="button" onClick={() => setCapture(true)}>
              Importar do Sky
            </button>
            <button className="button" onClick={() => setAdding(true)}>
              Novo produto
            </button>
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
            products.filter(
              (p) => p.stock_verified !== 0 && p.stock <= p.minimum_stock,
            ).length
          }
          detail="Produtos no estoque mínimo ou abaixo"
          icon={<Clock3 size={18} />}
        />
      </div>
      <section className="panel">
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
            <div className="table-scroll">
              <table>
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
                            p.stock <= p.minimum_stock ? "low-stock" : ""
                          }
                        >
                          {p.stock_verified === 0
                            ? "A conferir"
                            : `${p.stock} un.`}
                        </span>
                      </td>
                      <td>{p.minimum_stock} un.</td>
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
            <Empty />
          )
        ) : (
          <div className="table-scroll">
            <table>
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
      {adding && (
        <RegisterModal
          kind="catalog"
          initial={{ kind: "product" }}
          record={null}
          onClose={() => setAdding(false)}
        />
      )}
      {invoiceOpen && <StockInvoiceImport onClose={() => setInvoiceOpen(false)} />}
      {entry !== undefined && (
        <StockEntry
          initial={entry || undefined}
          onClose={() => setEntry(undefined)}
        />
      )}
      {capture && (
        <CapturePanel
          catalog
          source="sky"
          onClose={async (items) => {
            await refresh();
            setCapture(false);
            if (items.length)
              notify(
                "Produtos importados. Use Entrada em estoque para confirmar as quantidades recebidas.",
              );
          }}
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
        eyebrow="GESTÃO"
        title="Financeiro"
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
  const requestedTab = params.get("aba");
  const activeTab = requestedTab === "transferencia" ? "oficina" : requestedTab || "oficina";
  const { session, data, refresh, notify } = useApp();
  const [rates, setRates] = useState({
    debit_fee_bps: data.payment_settings?.debit_fee_bps || 0,
    credit_fee_bps: data.payment_settings?.credit_fee_bps || 0,
    interest_bps: data.payment_settings?.interest_bps || 0,
  });
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <>
      <PageHeading
        eyebrow="ADMINISTRAÇÃO"
        title="Configurações"
        description="Sua oficina e a base para os próximos passos."
      />
      <div className="tabs">
        <button className={activeTab === "oficina" ? "active" : ""} onClick={() => setParams({aba:"oficina"})}>Dados da oficina</button>
        <button
          className={activeTab === "geral" ? "active" : ""}
          onClick={() => setParams({aba:"geral"})}
        >
          Geral e taxas
        </button>

        <button className={params.get('aba')==='servicos'?'active':''} onClick={()=>setParams({aba:'servicos'})}>Mão de obra por porte</button>
        <button
          className={params.get("aba") === "pecas" ? "active" : ""}
          onClick={() => setParams({ aba: "pecas" })}
        >
          Lucro de peças e terceiros
        </button>
      </div>
      {params.get('aba')==='servicos'?<LaborRates/>:activeTab === "oficina" ? <WorkshopProfile key={session.tenant.id} /> : params.get("aba") === "pecas" ? (
        <PartsPricing />
      ) : (
        <>
          <form
            className="panel work-order-section"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              try {
                await send("/payment-settings", rates, "PUT");
                await refresh();
                notify("Taxas padrão salvas para esta oficina.");
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <h2>Taxas e parcelamento</h2>
            <p className="muted">
              Valores padrão da oficina. Você pode ajustá-los ao definir cada
              recebimento.
            </p>
            <div className="form-grid">
              {(
                [
                  ["debit_fee_bps", "Taxa da oficina — débito (%)"],
                  ["credit_fee_bps", "Taxa da oficina — crédito (%)"],
                  [
                    "interest_bps",
                    "Juros totais do cliente — parcelamento (%)",
                  ],
                ] as const
              ).map(([key, label]) => (
                <Field key={key} label={label}>
                  <NumericInput
                    type="number"
                    min={0}
                    max={100}
                    step="0.01"
                    required
                    value={rates[key] / 100}
                    onChange={(e) =>
                      setRates({
                        ...rates,
                        [key]: Math.round(Number(e.target.value) * 100),
                      })
                    }
                  />
                </Field>
              ))}
            </div>
            {error && (
              <div role="alert" className="error-box">
                {error}
              </div>
            )}
            <button className="button primary" disabled={busy}>
              Salvar taxas
            </button>
          </form>
          {!!data.card_rates?.length && (
            <section className="panel work-order-section">
              <h2>Taxas Banco Inter por parcela</h2>
              <p className="muted">
                Tabela configurada para a oficina. No recebimento, a taxa é
                aplicada conforme o número de parcelas. O repasse usa a taxa
                real para preservar o líquido, evitando a diferença dos fatores
                arredondados do PDF.
              </p>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Modalidade</th>
                      <th>Parcelas</th>
                      <th>Taxa da operadora</th>
                      <th>Fator de referência do PDF</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.card_rates.map((r) => (
                      <tr key={r.method + r.installments}>
                        <td>{r.method}</td>
                        <td>{r.installments}x</td>
                        <td>{(r.fee_bps / 100).toFixed(2)}%</td>
                        <td>{(r.factor_bps / 10000).toFixed(4)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
          <div className="settings-grid">
            <section className="panel settings-card">
              <Building2 size={23} />
              <h2>{session.tenant.name}</h2>
              <p>{session.tenant.address}</p>
              <p>{session.tenant.phone}</p>
              <div className="info-box">
                Edite o nome, contatos e logotipo em Dados da oficina. Essas
                informações identificam os documentos e a página do cliente.
              </div>
            </section>
            <section className="panel settings-card">
              <ShieldCheck size={23} />
              <h2>Acesso e conta</h2>
              <p>{session.user.name} · Administrador</p>
              <p>{session.user.email}</p>
              <p className="muted">
                Convites e permissões detalhadas serão adicionados em uma próxima etapa.
              </p>
            </section>
            <section className="panel settings-card">
              <Download size={23} />
              <h2>Extensão Horse Power — versão comercial</h2>
              <p>
                A extensão existente continua disponível na Chrome Web Store e mantém identidade, dados e conexões próprios. A extensão de teste do Sistema Oficinas é separada e não a substitui.
              </p>
              <a className="button" href="https://chromewebstore.google.com/detail/ddmnjpmldgnjefjkachlpicngaphlobf" target="_blank" rel="noopener noreferrer">
                <Download size={16} />
                Abrir Chrome Web Store
              </a>
            </section>
            {window.location.hostname === "sistema-oficinas-homologacao.vercel.app" && (
              <section className="panel settings-card">
                <Download size={23} />
                <h2>Extensão de teste INT-015</h2>
                <p>
                  Capture peças do Sky Peças e revise os itens antes de concluir a captura. Esta versão de teste conecta somente à homologação.
                </p>
                <a className="button primary" href="/downloads/sistema-oficinas-test-extension.zip" download>
                  <Download size={16} />
                  Baixar extensão de teste (.zip)
                </a>
                <ol>
                  <li>Extraia o ZIP em uma pasta permanente.</li>
                  <li>Abra <code>chrome://extensions</code> e ative o modo desenvolvedor.</li>
                  <li>Clique em “Carregar sem compactação” e selecione a pasta extraída.</li>
                </ol>
                <p className="muted">
                  A extensão tem nome, armazenamento e conexão próprios e pode ficar instalada ao lado da extensão Horse Power da Chrome Web Store. Não substitua nem remova a versão comercial.
                </p>
              </section>
            )}
            <section className="panel settings-card full">
              <Layers3 size={23} />
              <h2>Evolução dos módulos</h2>
              <p>
                A fundação concentra o atendimento, os cadastros e os
                recebimentos. Os próximos incrementos serão desenvolvidos por
                fluxo.
              </p>
              <div className="roadmap-grid">
                {[
                  [
                    "01",
                    "Atendimento ampliado",
                    "Checklist, comissões e diagnóstico detalhado.",
                  ],
                  [
                    "02",
                    "Compras e vendas",
                    "Fornecedores, compras e venda rápida integradas ao estoque.",
                  ],
                  [
                    "03",
                    "Gestão financeira",
                    "Plano de contas, retiradas e relatórios ampliados.",
                  ],
                  [
                    "04",
                    "Organização e SaaS",
                    "Agenda, convites, configurações e preparação comercial.",
                  ],
                ].map(([n, t, d]) => (
                  <div key={n}>
                    <span>{n}</span>
                    <h3>{t}</h3>
                    <p>{d}</p>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </>
      )}
    </>
  );
}
