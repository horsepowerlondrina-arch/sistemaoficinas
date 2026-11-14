import { useUnsavedSettings } from "../lib/useUnsavedSettings";
import { useEffect, useState } from "react";
import { api, send } from "../lib/api";
import { useApp } from "../lib/context";
import { money } from "../lib/types";
import { Field, PageHeading } from "./ui";
type Row = Record<string, any>;
export function OrderAccessControls({ orderId }: { orderId: string }) {
  const { session, refresh, notify } = useApp();
  const permissions = session.access?.permissions;
  const [staff, setStaff] = useState<Row[]>([]),
    [assigned, setAssigned] = useState<string[]>([]),
    [history, setHistory] = useState<Row[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [discount, setDiscount] = useState(""),
    [mode, setMode] = useState("money"),
    [reason, setReason] = useState(""),
    [assignmentDirty, setAssignmentDirty] = useState(false);
  useUnsavedSettings(assignmentDirty || !!reason || !!discount);
  useEffect(() => {
    if (!permissions?.["orders.assign"]) return;
    void Promise.all([
      api<Row[]>("/staff"),
      api<Row[]>(`/orders/${orderId}/assignments`),
    ])
      .then(([s, a]) => {
        setStaff(s);
        setAssigned(
          a.filter((i) => !i.removed_at).map((i) => i.professional_id),
        );
        setHistory(a);
      })
      .catch((e) => setError(e.message));
  }, [orderId, permissions?.["orders.assign"]]);
  const execute = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await action();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (!permissions?.["orders.assign"] && !permissions?.["orders.discount"])
    return null;
  return (
    <section className="panel settings-card">
      <h2>Equipe e autorizações</h2>
      <a className="button" href="/aprovacoes">
        Central de aprovações
      </a>
      {permissions?.["orders.assign"] && (
        <>
          <h3>Responsáveis pela OS</h3>
          <p>
            Selecione os profissionais produtivos ativos. A atribuição vale para
            toda a OS.
          </p>
          <div className="form-grid">
            {staff
              .filter((s) => s.active === 1 && s.productive === 1)
              .map((s) => (
                <label className="checkbox-row" key={s.id}>
                  <input
                    type="checkbox"
                    checked={assigned.includes(s.id)}
                    onChange={(e) => {
                      setAssignmentDirty(true);
                      setAssigned(
                        e.target.checked
                          ? [...assigned, s.id]
                          : assigned.filter((id) => id !== s.id),
                      );
                    }}
                  />
                  {s.name}
                </label>
              ))}
          </div>
          <button
            className="button"
            disabled={busy}
            onClick={() =>
              execute(async () => {
                await send(
                  `/orders/${orderId}/assignments`,
                  { professional_ids: assigned },
                  "PUT",
                );
                const h = await api<Row[]>(`/orders/${orderId}/assignments`);
                setHistory(h);
                setAssignmentDirty(false);
                notify("Responsáveis atualizados.");
              })
            }
          >
            Salvar responsáveis
          </button>
          <details>
            <summary>Histórico de atribuições</summary>
            {history.map((row) => (
              <p key={row.professional_id}>
                {row.name} ·{" "}
                {new Date(Number(row.assigned_at)).toLocaleString("pt-BR")} ·{" "}
                {row.removed_at ? "Removido" : "Atribuído"}
              </p>
            ))}
          </details>
        </>
      )}
      {permissions?.["orders.discount"] && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void execute(async () => {
              await send(`/orders/${orderId}/discount-requests`, {
                mode,
                value: Math.round(Number(discount) * 100),
                justification: reason,
              });
              setDiscount("");
              setReason("");
              notify("Solicitação enviada à central de aprovações.");
            });
          }}
        >
          <h3>Solicitar aprovação de desconto</h3>
          <p>
            Informe o desconto total desejado. O pedido não aplica o desconto
            automaticamente.
          </p>
          <div className="form-grid">
            <Field label="Modalidade">
              <select value={mode} onChange={(e) => setMode(e.target.value)}>
                <option value="money">Reais</option>
                <option value="percent">Percentual</option>
              </select>
            </Field>
            <Field label="Desconto total solicitado">
              <input
                type="number"
                min="0"
                step="0.01"
                max={mode === "percent" ? 100 : undefined}
                required
                value={discount}
                onChange={(e) => setDiscount(e.target.value)}
              />
            </Field>
            <Field label="Justificativa" full>
              <textarea
                required
                minLength={10}
                maxLength={1000}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </Field>
          </div>
          <button className="button" disabled={busy}>
            Solicitar aprovação
          </button>
        </form>
      )}
      {error && (
        <p role="alert" className="error-box">
          {error}
        </p>
      )}
    </section>
  );
}
export function ApprovalCenter() {
  const { session, refresh, notify } = useApp();
  const [rows, setRows] = useState<Row[]>([]),
    [reason, setReason] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const load = () =>
    api<Row[]>("/approvals")
      .then(setRows)
      .catch((e) => setError(e.message));
  useEffect(() => {
    void load();
  }, [session.tenant.id]);
  const decide = async (id: string, approve: boolean) => {
    if (busy) return;
    if (reason.trim().length < 5) {
      setError("Informe uma justificativa para a decisão.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await send(`/approvals/${id}/decision`, {
        approve,
        reason,
      });
      notify(
        result.status === "invalidated"
          ? "Solicitação invalidada porque a OS mudou."
          : "Decisão registrada.",
      );
      setReason("");
      await load();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <PageHeading
        title="Central de aprovações"
        description="Solicitações internas de desconto da oficina."
      />
      <section className="panel settings-card">
        {error && (
          <p className="error-box" role="alert">
            {error}
          </p>
        )}
        {session.access?.permissions["orders.approve"] && (
          <Field label="Justificativa da decisão">
            <textarea
              value={reason}
              minLength={5}
              maxLength={1000}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
        )}
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>OS</th>
                <th>Subtotal</th>
                <th>Desconto total</th>
                <th>Justificativa</th>
                <th>Situação</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <a href={`/ordens/${row.order_id}`}>Abrir OS</a>
                  </td>
                  <td>{money(row.subtotal)}</td>
                  <td>{money(row.discount)}</td>
                  <td>{row.justification}</td>
                  <td>
                    {
                      {
                        pending: "Pendente",
                        approved: "Aprovada",
                        rejected: "Recusada",
                        invalidated: "Invalidada",
                      }[row.status as string]
                    }
                  </td>
                  <td>
                    {row.status === "pending" &&
                      row.requester_id !== session.user.id &&
                      session.access?.permissions["orders.approve"] && (
                        <>
                          <button
                            className="button"
                            disabled={busy}
                            onClick={() => decide(row.id, true)}
                          >
                            Aprovar
                          </button>
                          <button
                            className="button"
                            disabled={busy}
                            onClick={() => decide(row.id, false)}
                          >
                            Recusar
                          </button>
                        </>
                      )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!rows.length && <p>Nenhuma solicitação disponível.</p>}
      </section>
    </>
  );
}
