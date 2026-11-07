import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, send } from "../lib/api";
import { useApp } from "../lib/context";
import {
  cashReport,
  type CashAccount,
  type CashMovement,
  type CashFilters,
} from "../lib/cashReports";
import { money, today, type Entity } from "../lib/types";
import { Field, Modal, PageHeading, Empty } from "../components/ui";
import { NumericInput } from "../components/NumericInput";
import { CashReport, CashReportContent } from "../components/CashReport";
import { FinanceNav } from "./Expenses";
import "./cashControl.css";
type Data = {
  accounts: CashAccount[];
  movements: CashMovement[];
  legacy_count: number;
};
export function CashControl() {
  const { session, refresh, notify } = useApp(),
    day = today();
  const [data, setData] = useState<Data>({
    accounts: [],
    movements: [],
    legacy_count: 0,
  });
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [account, setAccount] = useState<Entity | null>(null),
    [adjust, setAdjust] = useState<Entity | null>(null),
    [showReport, setShowReport] = useState(false),
    [exporting, setExporting] = useState(false);
  const [draft, setDraft] = useState<CashFilters>({
      from: day.slice(0, 7) + "-01",
      to: day,
      account_id: "",
    }),
    [filters, setFilters] = useState(draft);
  const load = async () => {
    try {
      setData(await api<Data>("/cash-control"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  const action = async (fn: () => Promise<unknown>) => {
    if (busy) return false;
    setBusy(true);
    setError("");
    try {
      await fn();
      await load();
      await refresh();
      notify("Controle de caixa atualizado.");
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };
  const report = cashReport(data.accounts, data.movements, filters),
    company = session.tenant.name;
  const exportExcel = async () => {
    setExporting(true);
    try {
      const { downloadCashWorkbook } = await import("../lib/cashWorkbook");
      downloadCashWorkbook(report, company);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setExporting(false);
    }
  };
  const hasMovements =
    !!account && data.movements.some((m) => m.account_id === account.id);
  return (
    <>
      <FinanceNav />
      <PageHeading
        title="Controle de caixa"
        description="Saldo por conta bancária e dinheiro físico, atualizado por movimentos confirmados."
        actions={
          <button
            className="button primary"
            onClick={() =>
              setAccount({
                id: "",
                request_id: crypto.randomUUID(),
                name: "",
                kind: "bank",
                opening_balance: "",
                opening_on: day,
                active: 1,
              })
            }
          >
            Nova conta / caixa
          </button>
        }
      />
      {error && (
        <div role="alert" className="error-box">
          {error}
        </div>
      )}
      <p className="muted">
        Cadastre o saldo que você tem antes dos próximos lançamentos. Os
        pagamentos e recebimentos antigos não são atribuídos às contas
        automaticamente.{" "}
        <Link to="/financeiro/caixa/historico">
          Ver histórico financeiro geral
        </Link>
      </p>
      {loading ? (
        <p role="status">Carregando o controle de caixa...</p>
      ) : !data.accounts.length ? (
        <Empty
          title="Cadastre sua primeira conta"
          description="Adicione sua conta bancária e o dinheiro físico com os respectivos saldos iniciais."
        />
      ) : (
        <div className="cash-accounts">
          {data.accounts.map((a) => (
            <section className="panel cash-account" key={a.id}>
              <h2>{a.name}</h2>
              <p className="muted">
                {a.kind === "bank" ? "Conta bancária" : "Dinheiro físico"} ·{" "}
                {a.active ? "Ativa" : "Pausada"}
              </p>
              <strong className={a.balance < 0 ? "negative" : ""}>
                {money(a.balance)}
              </strong>
              {!!a.pending_receipts && <p className="muted">A entrar: {money(a.pending_receipts)} · disponível na data do crédito</p>}
              <div className="report-actions">
                <button
                  className="button"
                  onClick={() =>
                    setAccount({
                      ...a,
                      opening_balance: a.opening_balance / 100,
                    })
                  }
                >
                  Editar conta
                </button>
                <button
                  className="button"
                  disabled={!a.active}
                  onClick={() =>
                    setAdjust({
                      id: a.id,
                      name: a.name,
                      target_balance: a.balance / 100,
                      reason: "",
                      request_id: crypto.randomUUID(),
                    })
                  }
                >
                  Ajustar saldo
                </button>
              </div>
            </section>
          ))}
        </div>
      )}
      {!!data.legacy_count && (
        <p className="muted">
          {data.legacy_count} pagamentos ou recebimentos anteriores permanecem
          no histórico financeiro, sem associação automática a uma conta.
        </p>
      )}
      <section className="panel cash-period">
        <h2>Relatório por período</h2>
        <form
          className="cash-filter"
          onSubmit={(e) => {
            e.preventDefault();
            if (draft.from > draft.to) {
              setError("A data inicial deve ser anterior ou igual à final.");
              return;
            }
            setError("");
            setFilters({ ...draft });
          }}
        >
          <Field label="De">
            <input
              type="date"
              required
              value={draft.from}
              onChange={(e) => setDraft({ ...draft, from: e.target.value })}
            />
          </Field>
          <Field label="Até">
            <input
              type="date"
              required
              value={draft.to}
              onChange={(e) => setDraft({ ...draft, to: e.target.value })}
            />
          </Field>
          <Field label="Conta">
            <select
              value={draft.account_id}
              onChange={(e) =>
                setDraft({ ...draft, account_id: e.target.value })
              }
            >
              <option value="">Todas as contas</option>
              {data.accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                  {a.active ? "" : " (pausada)"}
                </option>
              ))}
            </select>
          </Field>
          <button className="button primary">Aplicar filtros</button>
        </form>
        <div className="report-actions">
          <button
            className="button"
            disabled={!data.accounts.length}
            onClick={() => setShowReport(true)}
          >
            Relatório / PDF
          </button>
          <button
            className="button"
            disabled={exporting || !data.accounts.length}
            onClick={() => void exportExcel()}
          >
            Baixar Excel
          </button>
        </div>
        <CashReportContent report={report} company={company} />
      </section>
      {showReport && (
        <CashReport
          report={report}
          company={company}
          onClose={() => setShowReport(false)}
          onExcel={() => void exportExcel()}
          exporting={exporting}
        />
      )}
      {account && (
        <Modal
          title={account.id ? "Editar conta" : "Nova conta / caixa"}
          onClose={() => !busy && setAccount(null)}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (
                await action(() =>
                  send(
                    "/cash-accounts" + (account.id ? "/" + account.id : ""),
                    {
                      name: account.name,
                      kind: account.kind,
                      opening_balance: Math.round(
                        Number(account.opening_balance) * 100,
                      ),
                      opening_on: account.opening_on,
                      active: account.active,
                      request_id: account.request_id,
                    },
                    account.id ? "PUT" : "POST",
                  ),
                )
              )
                setAccount(null);
            }}
          >
            <div className="modal-body form-grid">
              <Field label="Nome">
                <input
                  required
                  maxLength={200}
                  value={account.name}
                  onChange={(e) =>
                    setAccount({ ...account, name: e.target.value })
                  }
                />
              </Field>
              <Field label="Tipo">
                <select
                  value={account.kind}
                  onChange={(e) =>
                    setAccount({ ...account, kind: e.target.value })
                  }
                >
                  <option value="bank">Conta bancária</option>
                  <option value="cash">Dinheiro físico</option>
                </select>
              </Field>
              <Field label="Saldo inicial (R$)">
                <NumericInput
                  type="number"
                  required
                  min="-1000000"
                  max="1000000"
                  step="0.01"
                  disabled={hasMovements}
                  value={account.opening_balance}
                  onChange={(e) =>
                    setAccount({ ...account, opening_balance: e.target.value })
                  }
                />
              </Field>
              <Field label="Início do controle">
                <input
                  type="date"
                  required
                  max={day}
                  disabled={hasMovements}
                  value={account.opening_on}
                  onChange={(e) =>
                    setAccount({ ...account, opening_on: e.target.value })
                  }
                />
              </Field>
              <label className="checkbox-row full">
                <input
                  type="checkbox"
                  checked={!!account.active}
                  onChange={(e) =>
                    setAccount({ ...account, active: e.target.checked ? 1 : 0 })
                  }
                />
                Conta ativa para novos lançamentos
              </label>
              <p className="muted full">
                {hasMovements
                  ? "O saldo inicial já tem movimentos associados. Use Ajustar saldo para corrigir uma diferença."
                  : "O saldo informado é a base anterior aos próximos pagamentos e recebimentos associados a esta conta."}
              </p>
              {error && (
                <p role="alert" className="full">
                  {error}
                </p>
              )}
            </div>
            <div className="modal-footer">
              <button className="button primary" disabled={busy}>
                Salvar conta
              </button>
            </div>
          </form>
        </Modal>
      )}
      {adjust && (
        <Modal
          title={"Ajustar saldo de " + adjust.name}
          description="A diferença será registrada no histórico com a data de hoje."
          onClose={() => !busy && setAdjust(null)}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (
                await action(() =>
                  send("/cash-adjustments", {
                    account_id: adjust.id,
                    target_balance: Math.round(
                      Number(adjust.target_balance) * 100,
                    ),
                    reason: adjust.reason,
                    request_id: adjust.request_id,
                  }),
                )
              )
                setAdjust(null);
            }}
          >
            <div className="modal-body form-grid">
              <Field label="Saldo correto que você tem (R$)">
                <NumericInput
                  type="number"
                  required
                  min="-1000000"
                  max="1000000"
                  step="0.01"
                  value={adjust.target_balance}
                  onChange={(e) =>
                    setAdjust({ ...adjust, target_balance: e.target.value })
                  }
                />
              </Field>
              <Field label="Motivo">
                <input
                  required
                  minLength={3}
                  maxLength={500}
                  value={adjust.reason}
                  onChange={(e) =>
                    setAdjust({ ...adjust, reason: e.target.value })
                  }
                />
              </Field>
              {error && (
                <p role="alert" className="full">
                  {error}
                </p>
              )}
            </div>
            <div className="modal-footer">
              <button className="button primary" disabled={busy}>
                Registrar ajuste
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
