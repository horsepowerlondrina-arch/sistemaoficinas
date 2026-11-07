import { NumericInput } from "../components/NumericInput";
import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import {
  Plus,
  ArrowDownLeft,
  ArrowUpRight,
  Wallet,
  CalendarDays,
} from "lucide-react";
import { api, send } from "../lib/api";
import { money, today, type Entity } from "../lib/types";
import { useApp } from "../lib/context";
import {
  PageHeading,
  Field,
  Modal,
  Empty,
  Stat,
  SearchBox,
} from "../components/ui";
export function FinanceNav() {
  return (
    <div className="tabs finance-nav">
      <NavLink to="/financeiro" end>Contas a pagar</NavLink>
      <NavLink to="/financeiro/receber">Contas a receber</NavLink>
      <NavLink to="/financeiro/caixa">Caixa</NavLink>
      <NavLink to="/financeiro/pecas">Lucro das peças</NavLink>
      <NavLink to="/financeiro/servicos">Lucro dos serviços</NavLink>
      <NavLink to="/financeiro/ganhos">Ganhos por período</NavLink>
    </div>
  );
}
export function Expenses({ cash = false }: { cash?: boolean }) {
  const { data, notify } = useApp();
  const [records, setRecords] = useState<{
    templates: Entity[];
    payables: Entity[];
  }>({ templates: [], payables: [] });
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [tab, setTab] = useState("open"),
    [search, setSearch] = useState(""),
    [month, setMonth] = useState(today().slice(0, 7));
  const [editing, setEditing] = useState<Entity | null>(null),
    [paying, setPaying] = useState<Entity | null>(null),
    [template, setTemplate] = useState<Entity | null>(null),
    [generating, setGenerating] = useState(false),
    [cancel, setCancel] = useState<Entity | null>(null),
    [deletingTemplate, setDeletingTemplate] = useState<Entity | null>(null);
  const load = async () => {
    try {
      setRecords(await api("/expenses"));
    } catch (e) {
      setError((e as Error).message);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  const action = async (fn: () => Promise<any>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      await load();
      notify("Financeiro atualizado.");
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };
  const blank = () => ({
    id: "",
    description: "",
    supplier: "",
    category: "Fixo",
    amount: "",
    due_on: today(),
    notes: "",
  });
  const filtered = records.payables.filter(
    (p) =>
      (tab === "all" ||
        (tab === "overdue"
          ? p.status === "open" && p.due_on < today()
          : p.status === tab)) &&
      (!month || p.due_on.startsWith(month)) &&
      `${p.description} ${p.supplier}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const open = records.payables.filter(
    (p) => p.status === "open" && (!month || p.due_on.startsWith(month)),
  );
  const cashRows: Entity[] = [
    ...data.cash.map((c) => ({
      ...c,
      description: "Recebimento de OS",
      date: c.created_at.slice(0, 10),
      signed: c.amount,
    })),
    ...records.payables
      .filter((p) => p.status === "paid")
      .map((p) => ({ ...p, date: p.paid_on, signed: -p.amount })),
  ]
    .filter((c) => !month || c.date.startsWith(month))
    .sort((a, b) => b.date.localeCompare(a.date));
  return (
    <>
      <FinanceNav />
      <PageHeading
        eyebrow="FINANCEIRO"
        title={cash ? "Caixa da oficina" : "Contas a pagar"}
        description={
          cash
            ? "Entradas recebidas e despesas efetivamente pagas."
            : "Vencimentos, pagamentos e planejamento dos gastos da sua oficina."
        }
        actions={
          !cash && (
            <button
              className="button primary"
              onClick={() => setEditing(blank())}
            >
              <Plus size={17} />
              Nova conta
            </button>
          )
        }
      />
      {error && (
        <div className="error-box" role="alert">
          {error}
        </div>
      )}
      <div className="stats-grid three">
        <Stat
          detail="Conforme o mês selecionado"
          label={cash ? "Entradas no período" : "A pagar no período"}
          value={money(
            cash
              ? cashRows
                  .filter((c) => c.signed > 0)
                  .reduce((s, c) => s + c.signed, 0)
              : open.reduce((s, p) => s + p.amount, 0),
          )}
          icon={<Wallet size={18} />}
        />
        <Stat
          detail="Conforme o mês selecionado"
          label={cash ? "Saídas no período" : "Vencidas no período"}
          value={money(
            cash
              ? -cashRows
                  .filter((c) => c.signed < 0)
                  .reduce((s, c) => s + c.signed, 0)
              : open
                  .filter((p) => p.due_on < today())
                  .reduce((s, p) => s + p.amount, 0),
          )}
          icon={<ArrowUpRight size={18} />}
        />
        <Stat
          label={
            cash
              ? "Movimento líquido do período"
              : "Planejamento mensal conhecido"
          }
          value={money(
            cash
              ? cashRows.reduce((s, c) => s + c.signed, 0)
              : records.templates
                  .filter((t) => t.active)
                  .reduce((s, t) => s + (t.amount ?? 0), 0),
          )}
          detail={
            cash
              ? "Não inclui saldo bancário inicial."
              : "Variáveis sem valor não entram no total."
          }
          icon={<CalendarDays size={18} />}
        />
      </div>
      <section className="panel">
        <div className="expense-toolbar">
          <div className="tabs">
            {!cash &&
              [
                ["open", "Em aberto"],
                ["overdue", "Vencidas"],
                ["paid", "Pagas"],
                ["all", "Todas"],
                ["templates", "Planejamento"],
              ].map(([v, l]) => (
                <button
                  key={v}
                  className={tab === v ? "active" : ""}
                  onClick={() => setTab(v)}
                >
                  {l}
                </button>
              ))}
          </div>
          <label className="field">
            <span>Mês</span>
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
            />
          </label>
          {!cash && tab !== "templates" && (
            <SearchBox
              value={search}
              onChange={setSearch}
              placeholder="Buscar despesa ou fornecedor"
            />
          )}
        </div>
        {cash ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Movimento</th>
                  <th>Forma</th>
                  <th>Valor</th>
                </tr>
              </thead>
              <tbody>
                {cashRows.map((c) => (
                  <tr key={c.id}>
                    <td>
                      {new Date(c.date + "T12:00:00").toLocaleDateString(
                        "pt-BR",
                      )}
                    </td>
                    <td>{c.description}</td>
                    <td>{c.method}</td>
                    <td className={c.signed < 0 ? "negative" : "positive"}>
                      {money(c.signed)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!cashRows.length && (
              <Empty title="Nenhum movimento confirmado neste mês" />
            )}
          </div>
        ) : tab === "templates" ? (
          <>
            <div className="expense-toolbar">
              <p className="muted">
                Importado da planilha. Gere as contas no mês correto para
                começar a acompanhar os vencimentos. Gerar o mesmo mês novamente
                não duplica contas.
              </p>
              <button
                className="button primary"
                onClick={() => setGenerating(true)}
              >
                Gerar contas do mês
              </button>
              <button
                className="button"
                onClick={() =>
                  setTemplate({
                    id: "",
                    request_id: crypto.randomUUID(),
                    description: "",
                    category: "Fixo",
                    supplier: "",
                    amount: "",
                    due_day: 10,
                    remaining_months: "",
                    start_month: "",
                    source: "",
                    active: 1,
                  })
                }
              >
                Novo gasto recorrente
              </button>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Gasto</th>
                    <th>Categoria</th>
                    <th>Valor mensal</th>
                    <th>Vencimento</th>
                    <th>Parcelas informadas</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {records.templates.map((t) => (
                    <tr key={t.id}>
                      <td>
                        <strong>{t.description}</strong>
                        <small className="cell-secondary">
                          {t.active ? "Ativo" : "Pausado"}
                          {t.start_month
                            ? " · início " + t.start_month
                            : " · mês inicial a definir"}
                        </small>
                      </td>
                      <td>{t.category}</td>
                      <td>
                        {t.amount === null ? "A informar" : money(t.amount)}
                      </td>
                      <td>Dia {t.due_day}</td>
                      <td>{t.remaining_months ?? "Recorrente"}</td>
                      <td>
                        <button
                          className="button"
                          onClick={() =>
                            setTemplate({
                              ...t,
                              amount: t.amount === null ? "" : t.amount / 100,
                            })
                          }
                        >
                          Editar
                        </button>
                        <button
                          className="button danger"
                          onClick={() => setDeletingTemplate(t)}
                        >
                          Excluir
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Despesa / fornecedor</th>
                  <th>Categoria</th>
                  <th>Vencimento</th>
                  <th>Valor</th>
                  <th>Situação</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <strong>{p.description}</strong>
                      <small className="cell-secondary">{p.supplier}</small>
                    </td>
                    <td>{p.category}</td>
                    <td>
                      {new Date(p.due_on + "T12:00:00").toLocaleDateString(
                        "pt-BR",
                      )}
                    </td>
                    <td>{money(p.amount)}</td>
                    <td>
                      {p.status === "paid"
                        ? "Paga"
                        : p.status === "cancelled"
                          ? "Cancelada"
                          : p.due_on < today()
                            ? "Vencida"
                            : "Em aberto"}
                    </td>
                    <td>
                      {p.status === "open" && (
                        <div className="action-row">
                          <button
                            className="button"
                            onClick={() =>
                              setEditing({ ...p, amount: p.amount / 100 })
                            }
                          >
                            Editar
                          </button>
                          <button
                            className="button primary"
                            onClick={() =>
                              setPaying({
                                ...p,
                                paid_on: today(),
                                method: "Pix",
                              })
                            }
                          >
                            Pagar
                          </button>
                          <button
                            className="button"
                            onClick={() => setCancel(p)}
                          >
                            Cancelar
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!filtered.length && (
              <Empty
                title="Nenhuma conta neste filtro"
                description="Cadastre uma conta ou use Planejamento para gerar os gastos do mês."
              />
            )}
          </div>
        )}
      </section>
      {editing && (
        <Modal
          title={editing.id ? "Editar conta" : "Nova conta a pagar"}
          onClose={() => setEditing(null)}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (
                await action(() =>
                  send(
                    "/payables" + (editing.id ? "/" + editing.id : ""),
                    {
                      ...editing,
                      amount: Math.round(Number(editing.amount) * 100),
                    },
                    editing.id ? "PUT" : "POST",
                  ),
                )
              )
                setEditing(null);
            }}
          >
            <div className="modal-body form-grid">
              {[
                ["description", "Descrição"],
                ["supplier", "Fornecedor"],
                ["category", "Categoria"],
                ["amount", "Valor (R$)"],
                ["due_on", "Vencimento"],
              ].map(([k, l]) => (
                <Field label={l} key={k}>
                  <input
                    required={k !== "supplier"}
                    type={
                      k === "amount"
                        ? "number"
                        : k === "due_on"
                          ? "date"
                          : "text"
                    }
                    min={k === "amount" ? "0.01" : undefined}
                    step={k === "amount" ? "0.01" : undefined}
                    value={editing[k]}
                    onChange={(e) =>
                      setEditing({ ...editing, [k]: e.target.value })
                    }
                  />
                </Field>
              ))}
              <Field label="Observações" full>
                <textarea
                  value={editing.notes}
                  onChange={(e) =>
                    setEditing({ ...editing, notes: e.target.value })
                  }
                />
              </Field>
              {error && <p role="alert">{error}</p>}
            </div>
            <div className="modal-footer">
              <button className="button primary" disabled={busy}>
                Salvar conta
              </button>
            </div>
          </form>
        </Modal>
      )}
      {paying && (
        <Modal
          title="Confirmar pagamento"
          description={`${paying.description} · ${money(paying.amount)}`}
          onClose={() => setPaying(null)}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (
                await action(() =>
                  send(`/payables/${paying.id}/pay`, {
                    paid_on: paying.paid_on,
                    method: paying.method,
                    account_id: paying.account_id || undefined,
                  }),
                )
              )
                setPaying(null);
            }}
          >
            <div className="modal-body form-grid">
              {!!data.cash_accounts?.length && (
                <Field label="Conta de saída">
                  <select
                    required
                    value={paying.account_id || ""}
                    onChange={(e) =>
                      setPaying({ ...paying, account_id: e.target.value })
                    }
                  >
                    <option value="">Selecione a conta</option>
                    {data.cash_accounts
                      .filter((a) => a.active)
                      .map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name} ·{" "}
                          {a.kind === "cash"
                            ? "Dinheiro físico"
                            : "Conta bancária"}
                        </option>
                      ))}
                  </select>
                </Field>
              )}
              <Field label="Data do pagamento">
                <input
                  required
                  type="date"
                  value={paying.paid_on}
                  onChange={(e) =>
                    setPaying({ ...paying, paid_on: e.target.value })
                  }
                />
              </Field>
              <Field label="Forma de pagamento">
                <select
                  value={paying.method}
                  onChange={(e) =>
                    setPaying({ ...paying, method: e.target.value })
                  }
                >
                  {["Pix", "Dinheiro", "Transferência", "Boleto", "Cartão"].map(
                    (m) => (
                      <option key={m}>{m}</option>
                    ),
                  )}
                </select>
              </Field>
              {error && <p role="alert">{error}</p>}
            </div>
            <div className="modal-footer">
              <button className="button primary" disabled={busy}>
                Confirmar saída do caixa
              </button>
            </div>
          </form>
        </Modal>
      )}
      {template && (
        <Modal
          title={
            template.id ? "Editar gasto recorrente" : "Novo gasto recorrente"
          }
          onClose={() => setTemplate(null)}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (
                await action(() =>
                  send(
                    "/expense-templates" +
                      (template.id ? "/" + template.id : ""),
                    {
                      amount:
                        template.amount === ""
                          ? null
                          : Math.round(Number(template.amount) * 100),
                      due_day: Number(template.due_day),
                      active: template.active,
                      description: template.description,
                      category: template.category,
                      supplier: template.supplier || "",
                      remaining_months: template.remaining_months
                        ? Number(template.remaining_months)
                        : null,
                      start_month: template.start_month || null,
                      source: template.source || "",
                      request_id: template.request_id,
                    },
                    template.id ? "PUT" : "POST",
                  ),
                )
              )
                setTemplate(null);
            }}
          >
            <div className="modal-body form-grid">
              <Field label="Descrição" full>
                <input
                  required
                  maxLength={200}
                  value={template.description}
                  onChange={(e) =>
                    setTemplate({ ...template, description: e.target.value })
                  }
                />
              </Field>
              <Field label="Categoria">
                <input
                  required
                  maxLength={200}
                  value={template.category}
                  onChange={(e) =>
                    setTemplate({ ...template, category: e.target.value })
                  }
                />
              </Field>
              <Field label="Fornecedor">
                <input
                  maxLength={500}
                  value={template.supplier || ""}
                  onChange={(e) =>
                    setTemplate({ ...template, supplier: e.target.value })
                  }
                />
              </Field>
              <Field label="Parcelas restantes (vazio = recorrente)">
                <NumericInput
                  type="number"
                  min="1"
                  max="600"
                  value={template.remaining_months ?? ""}
                  onChange={(e) =>
                    setTemplate({
                      ...template,
                      remaining_months: e.target.value,
                    })
                  }
                />
              </Field>
              <Field label="Mês inicial (opcional)">
                <input
                  type="month"
                  value={template.start_month || ""}
                  onChange={(e) =>
                    setTemplate({ ...template, start_month: e.target.value })
                  }
                />
              </Field>
              <Field label="Valor mensal (R$)">
                <NumericInput
                  type="number"
                  min="0"
                  step="0.01"
                  value={template.amount}
                  onChange={(e) =>
                    setTemplate({ ...template, amount: e.target.value })
                  }
                />
              </Field>
              <Field label="Dia do vencimento">
                <NumericInput
                  type="number"
                  min="1"
                  max="31"
                  required
                  value={template.due_day}
                  onChange={(e) =>
                    setTemplate({ ...template, due_day: e.target.value })
                  }
                />
              </Field>
              <label>
                <input
                  type="checkbox"
                  checked={!!template.active}
                  onChange={(e) =>
                    setTemplate({
                      ...template,
                      active: e.target.checked ? 1 : 0,
                    })
                  }
                />{" "}
                Incluir nos próximos meses
              </label>
              <p className="muted">
                Alterações valem para contas ainda não geradas.
              </p>
              {error && <p role="alert">{error}</p>}
            </div>
            <div className="modal-footer">
              <button className="button primary" disabled={busy}>
                Salvar planejamento
              </button>
            </div>
          </form>
        </Modal>
      )}
      {generating && (
        <Modal title="Gerar contas do mês" onClose={() => setGenerating(false)}>
          <div className="modal-body">
            <Field label="Mês de referência">
              <input
                required
                type="month"
                value={month}
                onChange={(e) => setMonth(e.target.value)}
              />
            </Field>
            <p>
              O primeiro mês gerado será o início das parcelas restantes
              informadas na planilha. As contas entram em aberto; nenhum
              pagamento será presumido. Gastos sem valor ficam no planejamento.
            </p>
            {error && <p role="alert">{error}</p>}
          </div>
          <div className="modal-footer">
            <button
              className="button primary"
              disabled={busy || !month}
              onClick={async () => {
                if (await action(() => send("/expenses/generate", { month })))
                  setGenerating(false);
              }}
            >
              Gerar contas de {month}
            </button>
          </div>
        </Modal>
      )}
      {deletingTemplate && (
        <Modal
          title="Excluir gasto recorrente"
          description={deletingTemplate.description}
          onClose={() => setDeletingTemplate(null)}
        >
          <div className="modal-body">
            Este gasto sairá do planejamento e não gerará novas contas. As
            contas já lançadas e os pagamentos serão preservados.
          </div>
          <div className="modal-footer">
            <button
              className="button"
              onClick={() => setDeletingTemplate(null)}
            >
              Voltar
            </button>
            <button
              className="button danger"
              disabled={busy}
              onClick={async () => {
                if (
                  await action(() =>
                    send(
                      "/expense-templates/" + deletingTemplate.id,
                      {},
                      "DELETE",
                    ),
                  )
                )
                  setDeletingTemplate(null);
              }}
            >
              Excluir do planejamento
            </button>
          </div>
        </Modal>
      )}
      {cancel && (
        <Modal
          title="Cancelar conta"
          description={cancel.description}
          onClose={() => setCancel(null)}
        >
          <div className="modal-body">
            A conta continuará no histórico como cancelada.
          </div>
          <div className="modal-footer">
            <button
              className="button danger"
              disabled={busy}
              onClick={async () => {
                if (
                  await action(() => send(`/payables/${cancel.id}/cancel`, {}))
                )
                  setCancel(null);
              }}
            >
              Confirmar cancelamento
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
