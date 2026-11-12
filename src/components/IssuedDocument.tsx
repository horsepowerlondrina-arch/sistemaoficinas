import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api, send } from "../lib/api";
import { OrderPrint } from "./OrderPrint";
import { ChecklistPrint } from "./ChecklistPrint";
import { useApp } from "../lib/context";
import { Modal } from "./ui";
import type { Order } from "../lib/types";
import { ShareOrder } from "./ShareOrder";

type Kind = "order" | "checklist";
type History = { legacy: boolean; revisions: Record<string, any>[] };
type DocumentContextValue = {
  kind: Kind;
  id: string;
  admin: boolean;
  history: History;
  payload: Record<string, any> | null;
  error: string;
  busy: boolean;
  setPayload: (payload: Record<string, any> | null) => void;
  setError: (error: string) => void;
  setBusy: (busy: boolean) => void;
  issue: (newRevision: boolean) => Promise<boolean>;
  currentOnly: boolean;
  setPrinting: (printing: boolean) => void;
};
const DocumentContext = createContext<DocumentContextValue | null>(null);

function useIssuedDocument() {
  const value = useContext(DocumentContext);
  if (!value) throw new Error("IssuedDocument controls require an IssuedDocumentProvider.");
  return value;
}

export function IssuedDocumentProvider({ kind, id, currentOnly = false, children }: { kind: Kind; id: string; currentOnly?: boolean; children: ReactNode }) {
  const { session, data } = useApp();
  const admin = session.role === "owner";
  const [history, setHistory] = useState<History>({ legacy: false, revisions: [] });
  const [payload, setPayload] = useState<Record<string, any> | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [printing, setPrinting] = useState(false);
  const endpoint = "/documents/" + kind + "/" + id;

  useEffect(() => {
    let active = true;
    setPayload(null);
    setError("");
    api<History>(endpoint)
      .then(async (documentHistory) => {
        if (!active) return;
        setHistory(documentHistory);
        if ((!currentOnly || documentHistory.legacy) && documentHistory.revisions.length) {
          const document = await api<Record<string, any>>(endpoint + "?revision=" + documentHistory.revisions[0].revision);
          if (active) setPayload(document);
        }
      })
      .catch((cause) => {
        if (active) setError(cause.message);
      });
    return () => { active = false; };
  }, [endpoint, currentOnly]);

  useEffect(() => {
    if (!printing || !payload) return;
    const frame = requestAnimationFrame(() => { window.print(); setPrinting(false); });
    return () => cancelAnimationFrame(frame);
  }, [printing, payload]);

  async function issue(newRevision: boolean) {
    setBusy(true);
    setError("");
    try {
      const currentOrder = currentOnly && kind === "order" && !history.legacy;
      const completed = kind === "order" && data.orders.some((order) => order.id === id && order.status === "completed");
      const value = currentOrder && !completed
        ? await api<Record<string, any>>(endpoint + "?current=1")
        : await send(endpoint, { new_revision: currentOrder ? false : newRevision });
      setPayload(value);
      if (!currentOrder) setHistory(await api(endpoint));
      setPrinting(true);
      return true;
    } catch (cause) {
      setError((cause as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <DocumentContext.Provider value={{ kind, id, admin, history, payload, error, busy, setPayload, setError, setBusy, issue, currentOnly, setPrinting }}>
      {children}
    </DocumentContext.Provider>
  );
}

export function IssuedDocumentActions({ includeShare = true }: { includeShare?: boolean } = {}) {
  const { kind, id, admin, history, payload, error, busy, setPayload, setError, setBusy, issue, currentOnly, setPrinting } = useIssuedDocument();
  const { data, session } = useApp();
  const endpoint = "/documents/" + kind + "/" + id;
  const order = data.orders.find((item) => item.id === id);
  const customer = order?.customer_id ? data.customers.find((item) => item.id === order.customer_id) : undefined;
  return (
    <>
      {(!currentOnly || history.legacy) && history.revisions.length > 0 && (
        <label className="issued-document-revision">
          Revisão
          <select disabled={busy} value={payload?.revision || ""} onChange={async (event) => {
            setBusy(true);
            setError("");
            try { setPayload(await api(endpoint + "?revision=" + event.target.value)); }
            catch (cause) { setError((cause as Error).message); }
            finally { setBusy(false); }
          }}>
            {history.revisions.map((revision) => (
              <option key={revision.revision} value={revision.revision}>
                Revisão {revision.revision} · {new Date(revision.issued_at).toLocaleString("pt-BR")}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="capture-actions">
        {currentOnly ? (
          <button type="button" className="button" disabled={busy} onClick={() => {
            if (history.legacy && payload) setPrinting(true);
            else void issue(history.legacy);
          }}>
            {history.legacy && payload ? `Reimprimir revisão ${payload.revision}` : history.legacy ? "Emitir revisão do legado" : "Imprimir PDF"}
          </button>
        ) : payload ? (
          <button type="button" className="button" disabled={busy} onClick={() => setPrinting(true)}>
            Reimprimir revisão {payload.revision}
          </button>
        ) : !history.legacy && (
          <button type="button" className="button" disabled={busy} onClick={() => void issue(false)}>
            Emitir e imprimir / PDF
          </button>
        )}
        {admin && (history.legacy || (!currentOnly && history.revisions.length > 0)) && (
          <button type="button" className="button" disabled={busy} onClick={() => {
            if (window.confirm("Emitir uma nova revisão com os dados atuais? As anteriores e seus links serão preservados.")) void issue(true);
          }}>
            Emitir nova revisão com dados atuais
          </button>
        )}
      </div>
      {includeShare && kind === "order" && admin && order && (currentOnly || payload) && (
        <ShareOrder
          key={id}
          shopName={session.tenant.name}
          customerPhone={customer?.phone}
          order={order}
        />
      )}
      {error && <p role="alert" className="error-box issued-document-error">{error}</p>}
    </>
  );
}

export function IssuedDocumentPreview() {
  const { kind, payload, history } = useIssuedDocument();
  if (!payload) return null;
  return (
    <div className="issued-document">
      {payload.revision > 0 && (kind !== "order" || history.legacy) && <div className="print-only document-revision-label">
        Revisão {payload.revision} · Emitido em {new Date(payload.issued_at).toLocaleString("pt-BR")}
        {payload.reissued_legacy ? " · Nova emissão de registro legado" : ""}
      </div>}
      {kind === "order" ? (
        <OrderPrint order={{ ...payload.order, quote_valid_until: payload.quote_valid_until }} tenant={payload.shop} customer={payload.customer || undefined} vehicle={payload.vehicle || undefined} />
      ) : (
        <ChecklistPrint checklist={payload.checklist} tenant={payload.shop} />
      )}
    </div>
  );
}

export function IssuedDocument({ kind, id }: { kind: Kind; id: string }) {
  return (
    <IssuedDocumentProvider kind={kind} id={id}>
      <IssuedDocumentLegacyControls />
      <IssuedDocumentPreview />
    </IssuedDocumentProvider>
  );
}

function IssuedDocumentLegacyControls() {
  const { history } = useIssuedDocument();
  return (
    <section className="panel no-print issued-document-controls">
      <h2>Documento emitido</h2>
      {history.legacy && !history.revisions.length
        ? <p role="status">Registro legado sem snapshot. A identidade e o documento originalmente emitidos não foram registrados e não serão reconstruídos com dados atuais. Uma nova emissão será identificada como revisão do legado.</p>
        : <p>Emissões são imutáveis. Alterar dados da oficina, itens ou pagamentos não modifica revisões já emitidas.</p>}
      <IssuedDocumentActions />
    </section>
  );
}

export function PostReceiptActions({ order, shopName, customerPhone, onDone }: {
  order: Order;
  shopName: string;
  customerPhone?: string;
  onDone: () => void;
}) {
  const { history, payload, busy, error, issue, setPrinting } = useIssuedDocument();
  async function printAndReturn() {
    const done = () => onDone();
    window.addEventListener("afterprint", done, { once: true });
    if (history.legacy && payload) {
      setPrinting(true);
    } else if (!await issue(history.legacy)) {
      window.removeEventListener("afterprint", done);
    }
  }
  return (
    <Modal
      title="Recebimento concluído"
      description={`OS #${order.number} finalizada. Deseja entregar uma cópia ao cliente?`}
      onClose={onDone}
    >
      <div className="modal-body">
        <p>Você pode imprimir a OS, compartilhar pelo WhatsApp ou voltar à lista.</p>
        {error && <p className="error-box" role="alert">{error}</p>}
      </div>
      <div className="modal-footer post-receipt-actions">
        <button type="button" className="button" disabled={busy} onClick={onDone}>Agora não</button>
        <button type="button" className="button" disabled={busy} onClick={() => void printAndReturn()}>Imprimir PDF</button>
        <ShareOrder order={order} shopName={shopName} customerPhone={customerPhone} onOpenWhatsApp={onDone} />
      </div>
    </Modal>
  );
}
