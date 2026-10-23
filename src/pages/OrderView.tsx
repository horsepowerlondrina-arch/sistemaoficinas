import { IssuedDocument } from "../components/IssuedDocument";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useApp } from "../lib/context";
import { send } from "../lib/api";
import { money, dateLabel, statusLabel } from "../lib/types";
import { displayStatus } from "../lib/workflow";
import { PageHeading, Badge, Empty, Modal, Field } from "../components/ui";
export function OrderView() {
  const { id } = useParams();
  const { data, session, refresh, notify } = useApp();
  const navigate = useNavigate();
  const order = data.orders.find((o) => o.id === id);
  const admin = session.role === "owner";
  const [confirm, setConfirm] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [editingNotes, setEditingNotes] = useState(false),
    [notes, setNotes] = useState(""),
    [statusPicker, setStatusPicker] = useState(false);
  if (!order) return <Empty title="Atendimento não encontrado" />;
  const editable = ["quote", "open", "working", "ready"].includes(order.status);
  const customer = data.customers.find((c) => c.id === order.customer_id);
  const vehicle = data.vehicles.find((v) => v.id === order.vehicle_id);
  const statusOptions = [
    ["quote", "Orçamento", "Voltar a OS para o status Orçamento."],
    ["open", "OS aberta", "Deixar a OS aberta, antes do início da execução."],
    ["working", "Em execução", "Retomar ou colocar a OS em execução."],
    ["ready", "Pronta para entrega", "Marcar a OS como pronta para entrega."],
    ["completed", "Finalizada", "Finalizar a OS, baixar estoque e gerar cobrança."],
    ["cancelled", "Cancelada", "Cancelar o atendimento mantendo o histórico."],
  ] as const;
  const next: Record<string, [string, string]> = {
    quote: ["open", "Aprovar OS"],
    open: ["working", "Iniciar execução"],
    working: ["ready", "Marcar como pronta"],
    ready: ["completed", "Finalizar OS e receber"],
  };
  const action = next[order.status];
  async function transition() {
    if (order && !["quote", "cancelled"].includes(confirm) && (!order.customer_id || !order.vehicle_id)) {
      notify("Informe o cliente e o veículo no atendimento e depois aprove a OS.");
      setConfirm("");
      navigate(`/ordens/${id}/editar`);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await send(`/orders/${id}/status`, { status: confirm });
      await refresh();
      setConfirm("");
      notify(
        result.warnings?.length
          ? `OS finalizada com aviso: ${result.warnings.join(" ")}`
          : "Situação atualizada.",
      );
      if (confirm === "completed") navigate(`/ordens/${id}/receber`);
    } catch (e) {
      setError((e as Error).message);
      setConfirm("");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button
        className="back-link no-print"
        onClick={() =>
          navigate("/ordens")
        }
      >
        ← Voltar à lista
      </button>
      <IssuedDocument key={id} kind="order" id={id!} />
      <div className="no-print">
      <PageHeading
        eyebrow="ORDEM DE SERVIÇO"
        title={`#${order.number} · ${order.plate || "Sem placa"}`}
        description={`${order.customer_name} · ${[order.brand, order.model].filter(Boolean).join(" ") || "Veículo não informado"}`}
        actions={
          <div className="no-print action-row">
            {admin && (
              <button
                className="button"
                onClick={() => navigate(`/checklists?order=${id}`)}
              >
                Checklist de entrada
              </button>
            )}
            {admin && (
              <button className="button" onClick={() => setStatusPicker(true)}>
                Alterar status
              </button>
            )}

            {admin && editable && (
              <button
                className="button"
                onClick={() => navigate(`/ordens/${id}/editar`)}
              >
                Editar atendimento
              </button>
            )}
            {action && (admin || ["working", "ready"].includes(action[0])) && (
              <button
                className="button primary"
                disabled={busy}
                onClick={() => setConfirm(action[0])}
              >
                {action[1]}
              </button>
            )}
            {admin && order.status === "completed" && order.receivable_id && (
              <button
                className="button primary"
                onClick={() => navigate(`/ordens/${id}/receber`)}
              >
                {order.payment_status === "paid"
                  ? "Ver recebimento"
                  : "Receber OS"}
              </button>
            )}
          </div>
        }
      />
      {error && (
        <div className="error-box" role="alert">
          {error}
        </div>
      )}
      {order.source && (
        <p className="import-note">
          Histórico importado · {order.source}. Pagamento não conciliado; sem
          movimentação no caixa atual.
        </p>
      )}
      <div className="work-order-meta panel">
        <Badge status={displayStatus(order)} />
        <span>
          Entrada: <strong>{dateLabel(order.entered_on)}</strong>
        </span>
        <span>
          Entrega: <strong>{dateLabel(order.due_on)}</strong>
        </span>
        <span>
          <strong>
            {order.source && !order.km
              ? "Não informado"
              : order.km.toLocaleString("pt-BR")}
          </strong>{" "}
          km
        </span>
        {admin && (
          <span>
            Total: <strong>{money(order.total)}</strong>
          </span>
        )}
      </div>
      <section className="panel work-order-section">
        <h2>Relato do cliente</h2>
        <p className="preserve-lines">
          {order.problem || "Nenhum relato informado."}
        </p>
      </section>
      <div className="work-order-grid">
        {[
          ["service", "Serviços"],
          ["product", "Produtos e peças"],
        ].map(([kind, title]) => (
          <section key={kind} className="panel work-order-section">
            <h2>
              {title}{" "}
              <small>{order.items.filter((i) => i.kind === kind).length}</small>
            </h2>
            {order.items
              .filter((i) => i.kind === kind)
              .map((i) => (
                <div className="work-order-line" key={i.id}>
                  <b className="quantity-pill">{i.quantity}×</b>
                  <div>
                    <strong>{i.name}</strong>
                    {i.professional_name && (
                      <small>{i.professional_name}</small>
                    )}
                  </div>
                  {admin && <span>{money(i.quantity * i.price)}</span>}
                </div>
              ))}
            {!order.items.some((i) => i.kind === kind) && (
              <p className="muted">Nenhum item informado.</p>
            )}
          </section>
        ))}
      </div>
      <section className="panel work-order-section">
        <div className="section-heading">
          <h2>Observações para a equipe</h2>
          {order.status !== "quote" && editable && (
            <button
              className="text-button no-print"
              onClick={() => {
                setNotes(order.notes);
                setEditingNotes(true);
              }}
            >
              Editar observações
            </button>
          )}
        </div>
        <p className="preserve-lines">
          {order.notes || "Nenhuma observação adicional."}
        </p>
      </section>
      {admin && editable && (
        <button
          className="text-button danger"
          onClick={() => setConfirm("cancelled")}
        >
          Cancelar OS
        </button>
      )}
      </div>
      {statusPicker && (
        <Modal
          title="Alterar status do atendimento"
          description="Como administrador, você pode avançar ou voltar o atendimento. Ao reabrir uma OS finalizada, estoque e cobrança aberta são desfeitos automaticamente."
          onClose={() => setStatusPicker(false)}
        >
          <div className="modal-body status-choice-list">
            {statusOptions
              .filter(([value]) => value !== order.status)
              .map(([value, label, description]) => (
                <button
                  type="button"
                  className="status-choice"
                  key={value}
                  onClick={() => {
                    setStatusPicker(false);
                    setConfirm(value);
                  }}
                >
                  <strong>{label}</strong>
                  <small>{description}</small>
                </button>
              ))}
          </div>
        </Modal>
      )}
      {confirm && (
        <Modal
          title={`Alterar status para ${statusLabel[confirm] || confirm}?`}
          description={
            order.status === "completed" && confirm !== "completed"
              ? "A finalização será desfeita: as peças baixadas voltarão ao estoque e a cobrança ainda não recebida será removida. Se já houver pagamento confirmado, a reabertura será bloqueada."
              : confirm === "completed"
                ? "As peças serão baixadas do estoque e você seguirá para o recebimento."
                : confirm === "quote"
                  ? "A OS voltará ao status Orçamento e poderá ser editada normalmente."
                  : confirm === "cancelled"
                    ? "O registro será preservado no histórico como cancelado."
                    : "Confirme a nova situação do atendimento."
          }
          onClose={() => !busy && setConfirm("")}
        >
          <div className="modal-footer">
            <button
              className="button"
              disabled={busy}
              onClick={() => setConfirm("")}
            >
              Voltar
            </button>
            <button
              className="button primary"
              disabled={busy}
              onClick={transition}
            >
              {busy ? "Processando..." : "Confirmar"}
            </button>
          </div>
        </Modal>
      )}
      {editingNotes && (
        <Modal
          title="Observações para a equipe"
          onClose={() => !busy && setEditingNotes(false)}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              try {
                await send(`/orders/${id}/notes`, { notes }, "PATCH");
                await refresh();
                setEditingNotes(false);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <div className="modal-body">
              <Field label="Observações">
                <textarea
                  rows={8}
                  maxLength={4000}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </Field>
              {error && (
                <div className="error-box" role="alert">
                  {error}
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="button primary" disabled={busy}>
                Salvar observações
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
