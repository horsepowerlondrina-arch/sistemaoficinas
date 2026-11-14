import { VehiclePlate } from "../components/VehiclePlate";
import { IssuedDocumentActions, IssuedDocumentPreview, IssuedDocumentProvider, PostReceiptActions } from "../components/IssuedDocument";
import { useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useApp } from "../lib/context";
import { send } from "../lib/api";
import { money, dateLabel, statusLabel } from "../lib/types";
import { displayStatus } from "../lib/workflow";
import { PageHeading, Badge, Empty, Modal, Field } from "../components/ui";
import { ShareOrder } from "../components/ShareOrder";
import { vehicleDisplayModel } from "../../shared/vehicleIdentity";
export function OrderView() {
  const { id } = useParams();
  const { data, session, refresh, notify } = useApp();
  const navigate = useNavigate();
  const location = useLocation();
  const [postReceiptOpen, setPostReceiptOpen] = useState(Boolean(location.state?.postReceipt));
  const order = data.orders.find((o) => o.id === id);
  const admin = session.role === "owner";
  const [confirm, setConfirm] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [approvalDueOn, setApprovalDueOn] = useState(""),
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
  const displayValue = (...values: unknown[]) => {
    const value = values.find((item) => item !== undefined && item !== null && String(item).trim() !== "");
    return value === undefined ? "Não informado" : String(value);
  };
  const manufactureYear = displayValue(vehicle?.year, vehicle?.manufacture_year, vehicle?.year_manufacture, order.manufacture_year, order.year_manufacture);
  const modelYear = displayValue(vehicle?.model_year, vehicle?.year_model, vehicle?.year, order.model_year, order.year_model, order.year);
  const mileage = Number(order.km || 0) || Number(vehicle?.km || 0);
  const mileageLabel = mileage > 0 ? mileage.toLocaleString("pt-BR") + " km" : "Não informado";
  const engineVersion = displayValue(vehicle?.engine, vehicle?.motorization, vehicle?.motor, vehicle?.version, vehicle?.trim, order.engine, order.motorization, order.version);
  async function transition() {
    if (order && !["quote", "cancelled"].includes(confirm) && (!order.customer_id || !order.vehicle_id)) {
      notify("Informe o cliente e o veículo no atendimento e depois aprove a OS.");
      setConfirm("");
      navigate(`/ordens/${id}/editar`);
      return;
    }
    if (order!.status === "quote" && !["quote", "cancelled"].includes(confirm) &&
      (!approvalDueOn || approvalDueOn < order!.entered_on)) {
      setError("Informe uma previsão de entrega a partir da data de entrada.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await send(`/orders/${id}/status`, {
        status: confirm,
        ...(order!.status === "quote" && !["quote", "cancelled"].includes(confirm)
          ? { due_on: approvalDueOn }
          : {}),
      });
      await refresh();
      setConfirm("");
      notify(
        result.warnings?.length
          ? `OS finalizada com aviso: ${result.warnings.join(" ")}`
          : "Situação atualizada.",
      );
      if (confirm === "completed") {
        if (Number(order!.total) > 0) navigate(`/ordens/${id}/receber`);
        else setPostReceiptOpen(true);
      }
    } catch (e) {
      setError((e as Error).message);
      setConfirm("");
    } finally {
      setBusy(false);
    }
  }
  const finishReceipt = () => navigate("/ordens", { replace: true });
  return (
    <IssuedDocumentProvider key={id} kind="order" id={id!} currentOnly>
      <>
      <div className="no-print">
      <button
        className="back-link no-print"
        onClick={() =>
          navigate("/ordens")
        }
      >
        ← Voltar à lista
      </button>
      <div className="order-view-header">
        <PageHeading
          eyebrow="ORDEM DE SERVIÇO"
          title="Detalhes da OS"
          description="Dados do atendimento e do veículo"
        />
        <div className="no-print order-view-toolbar" aria-label="Ações da ordem de serviço">
          {admin && (
            <button
              className="button"
              onClick={() => navigate(`/checklists?order=${id}`)}
            >
              Checklist de entrada
            </button>
          )}
          {admin && (
            <ShareOrder
              order={order}
              shopName={session.tenant.name}
              customerPhone={customer?.phone}
            />
          )}
          {admin && (
            <button className="button" onClick={() => setStatusPicker(true)}>
              Alterar status
            </button>
          )}
          <IssuedDocumentActions includeShare={false} />
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
              {order.payment_status === "paid" ? "Ver recebimento" : "Receber OS"}
            </button>
          )}
        </div>
      </div>
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
      <section className="work-order-summary panel" aria-label="Resumo da ordem de serviço">
        <div className="work-order-summary-item">
          <span>OS</span><strong>#{order.number}</strong>
        </div>
        <div className="work-order-summary-item">
          <span>Placa</span><VehiclePlate value={displayValue(order.plate, vehicle?.plate, order.guest_plate)} compact />
        </div>
        <div className="work-order-summary-item">
          <span>Cliente</span><strong>{displayValue(order.customer_name, customer?.name, order.guest_name)}</strong>
        </div>
        <div className="work-order-summary-item">
          <span>Marca</span><strong>{displayValue(order.brand, vehicle?.brand)}</strong>
        </div>
        <div className="work-order-summary-item">
          <span>Modelo FIPE</span><strong>{displayValue(vehicleDisplayModel(vehicle), order.model, order.guest_vehicle)}</strong>
        </div>
        <div className="work-order-summary-item">
          <span>Motorização / versão</span><strong>{engineVersion}</strong>
        </div>
        <div className="work-order-summary-item">
          <span>Ano fabricação / modelo</span><strong>{manufactureYear} / {modelYear}</strong>
        </div>
        <div className="work-order-summary-item">
          <span>Quilometragem</span><strong>{mileageLabel}</strong>
        </div>
        <div className="work-order-summary-item">
          <span>Data de entrada</span><strong>{order.entered_on ? dateLabel(order.entered_on) : "Não informado"}</strong>
        </div>
        {order.status !== "quote" && <div className="work-order-summary-item">
          <span>Previsão de entrega</span><strong>{order.due_on ? dateLabel(order.due_on) : "Não informado"}</strong>
        </div>}
        <div className="work-order-summary-item">
          <span>Status</span><strong><Badge status={displayStatus(order)} /></strong>
        </div>
        {admin && (
          <div className="work-order-summary-item work-order-summary-total">
            <span>Valor total</span><strong>{money(order.total)}</strong>
          </div>
        )}
      </section>
      <section className="panel work-order-section">
        <h2>Relato do cliente</h2>
        <p className="preserve-lines">
          {order.problem || "Nenhum relato informado."}
        </p>
      </section>
      <div className="work-order-grid">
        {([
          ["service", "Serviços"],
          ["product", "Produtos e peças"],
        ] as const).map(([kind, title]) => (
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
            {admin && <div className="work-order-subtotal">
              <span>Total de {kind === "service" ? "serviços" : "peças"}</span>
              <strong>{money(order.items.filter((item) => item.kind === kind).reduce((sum, item) => sum + Math.round(Number(item.quantity) * Number(item.price)), 0))}</strong>
            </div>}
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
      <IssuedDocumentPreview />
      {postReceiptOpen && <PostReceiptActions order={order} shopName={session.tenant.name} customerPhone={customer?.phone} onDone={finishReceipt} />}
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
          {order.status === "quote" && !["quote", "cancelled"].includes(confirm) && (
            <div className="modal-body">
              <Field label="Previsão de entrega">
                <input type="date" min={order.entered_on} value={approvalDueOn} onChange={(event) => setApprovalDueOn(event.target.value)} />
              </Field>
            </div>
          )}
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
              disabled={busy || (order.status === "quote" && !["quote", "cancelled"].includes(confirm) && (!approvalDueOn || approvalDueOn < order.entered_on))}
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
    </IssuedDocumentProvider>
  );
}
