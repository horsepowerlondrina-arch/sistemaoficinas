import { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { OrderPrint } from "./OrderPrint.js";
import { ChecklistPrint } from "./ChecklistPrint.js";

type ArchivedRow = { id: string; kind: "order" | "checklist"; entity_id: string; revision: number; issued_at: string; archived_at: string };
type ArchivePayload = { archive: ArchivedRow; document: Record<string, any> };

export function ArchivedDocuments() {
  const [rows, setRows] = useState<ArchivedRow[]>([]);
  const [selected, setSelected] = useState<ArchivePayload | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function refresh() {
    setError("");
    try { setRows(await api<ArchivedRow[]>("/documents/archives")); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível carregar os documentos históricos."); }
  }
  useEffect(() => { void refresh(); }, []);
  async function open(id: string) {
    setBusy(true); setError("");
    try { setSelected(await api<ArchivePayload>(`/documents/archives/${encodeURIComponent(id)}`)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível abrir o documento histórico."); }
    finally { setBusy(false); }
  }
  const document = selected?.document;
  return <section className="panel">
    <h3>Documentos preservados de substituições</h3>
    <p className="muted">Revisões anteriores ficam arquivadas com a identidade original e não são associadas a ordens ou checklists importados depois. Podem ser consultadas e impressas; links públicos antigos são revogados na substituição.</p>
    {rows.length === 0 ? <p className="muted">Nenhuma revisão arquivada.</p> : <div className="table-wrap"><table><thead><tr><th>Tipo</th><th>Registro original</th><th>Revisão</th><th>Emitido em</th><th></th></tr></thead><tbody>
      {rows.map((row) => <tr key={row.id}><td>{row.kind === "order" ? "Ordem de serviço" : "Checklist"}</td><td>{row.entity_id}</td><td>{row.revision}</td><td>{new Date(row.issued_at).toLocaleString("pt-BR")}</td><td><button type="button" className="button" disabled={busy} onClick={() => void open(row.id)}>Abrir / imprimir</button></td></tr>)}
    </tbody></table></div>}
    {selected && document && <div className="no-print capture-actions"><button type="button" className="button" onClick={() => window.print()}>Imprimir cópia histórica</button><button type="button" className="button" onClick={() => setSelected(null)}>Fechar</button></div>}
    {document && <div className="issued-document"><div className="print-only document-revision-label">Cópia histórica · revisão {document.revision} · emitido em {new Date(document.issued_at).toLocaleString("pt-BR")}</div>{selected?.archive.kind === "order" ? <OrderPrint order={{ ...document.order, quote_valid_until: document.quote_valid_until }} tenant={document.shop} customer={document.customer || undefined} vehicle={document.vehicle || undefined} /> : <ChecklistPrint checklist={document.checklist} tenant={document.shop} />}</div>}
    {error && <p role="alert" className="error-box">{error}</p>}
  </section>;
}
