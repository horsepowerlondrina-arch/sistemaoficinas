import { useEffect, useRef, useState, type ChangeEvent } from "react";
import {useAdminDraft} from "../lib/useAdminDraft";
import {adminActionLabel,adminResultLabel} from "../lib/adminPresentation";
import { Download, LockKeyhole, Upload } from "lucide-react";

type Mode = "empty" | "merge" | "replace";
type Totals = { stockUnits: number; inventoryValueCents: number; receivablesCents: number; payablesCents: number; cashReceivedCents: number };
type Preview = {
  mode: Mode; confirmationId: string; sourceWorkshop: string; targetWorkshop: string; counts: Record<string, number>;
  entities: Record<string, { existing: number; source: number; new: number; equal: number; updates: number; conflicts: number; removed: number }>;
  issues: string[]; warnings: string[]; canImport: boolean;
  before: Totals; after: Totals; publicLinksToRevoke: number; historicalDocumentsToArchive: number; historicalDocumentsToRestore: number;
};
type Backup = { id: string; package_sha256: string; created_at: string; expires_at: string };
type CriticalRequest = { id: string; packageSha256: string; status: string; requesterEmail: string; approverEmail: string | null; requestedAt: string; decidedAt: string | null };
type History = { id: string; actor_email: string; action: string; result: string; technical_context: Record<string, unknown>; created_at: string };
type Props = { showHistory?:boolean; onChanged?:()=>void; tenantId: string; workshopName: string; environmentLabel: string; canRequestCritical: boolean; canApproveCritical: boolean };
const MAX_PACKAGE_BYTES = 4 * 1024 * 1024;

export function PlatformDataTransfer({ tenantId, workshopName, environmentLabel, canRequestCritical, canApproveCritical, showHistory=true, onChanged }: Props) {
  const base = "/admin-api/workshops/" + encodeURIComponent(tenantId) + "/data-transfer";
  const [fileText, setFileText] = useState("");
  const [fileName, setFileName] = useState("");
  const [phrase, setPhrase] = useState("");
  const [mode, setMode] = useState<Mode>("empty");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [verification, setVerification] = useState<Record<string, unknown> | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [workshopConfirmation, setWorkshopConfirmation] = useState("");
  const [backups, setBackups] = useState<Backup[]>([]);
  const [requests, setRequests] = useState<CriticalRequest[]>([]);
  const [history, setHistory] = useState<History[]>([]);
  const [busy, setBusy] = useState(false);
  const importInFlight = useRef(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useAdminDraft(!!fileText||!!phrase||busy);

  async function json<T>(path: string, method = "GET", body?: unknown): Promise<T> {
    const response = await fetch(base + path, {
      method, credentials: "same-origin", cache: "no-store",
      ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    });
    const value = await response.json().catch(() => ({})) as T & { error?: string };
    if (!response.ok) throw new Error(value.error || "Não foi possível concluir a operação.");
    return value;
  }
  async function refresh() {
    const [b, r, h] = await Promise.all([
      json<Backup[]>("/backups"), json<CriticalRequest[]>("/critical-requests"), showHistory?json<History[]>("/history"):Promise.resolve([] as History[]),
    ]);
    setBackups(b); setRequests(r); setHistory(h);onChanged?.();
  }
  useEffect(() => { void refresh().catch(cause => setError(cause instanceof Error ? cause.message : "Falha ao carregar a transferência.")); }, [tenantId]);

  async function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setPreview(null); setVerification(null); setConfirmation(""); setWorkshopConfirmation(""); setFileText(""); setFileName(""); setError(""); setMessage("");
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".hptx") || file.size > MAX_PACKAGE_BYTES) {
      setError("Selecione um pacote .hptx de até 4 MiB. Este limite evita exceder o tamanho aceito pela hospedagem.");
      return;
    }
    setFileName(file.name); setFileText(await file.text());
  }
  async function post<T>(path: string, body: unknown) {
    return json<T>(path, "POST", body);
  }
  async function packageSha256() {
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(fileText));
    return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("");
  }
  async function exportPackage() {
    setBusy(true); setError(""); setMessage("");
    try {
      const direct = await fetch(base + "/export", { method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ passphrase: phrase }) });
      if (direct.ok) {
        const url = URL.createObjectURL(await direct.blob());
        const link = document.createElement("a"); link.href = url;
        link.download = "oficina-" + new Date().toISOString().slice(0, 10) + ".hptx"; link.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
        setPhrase("");
        setMessage("Pacote criptografado baixado. Guarde a frase secreta separadamente.");
        return;
      }
      const directError = await direct.json().catch(() => ({})) as { error?: string; code?: string };
      if (direct.status !== 413 || directError.code !== "package_too_large")
        throw new Error(directError.error || "Não foi possível exportar a oficina.");
      const staged = await post<{ id: string; sha256: string; size: number; chunkCount: number }>("/export/staged", { passphrase: phrase });
      if (!Number.isSafeInteger(staged.size) || staged.size < 1 || staged.size > 96 * 1024 * 1024
          || !Number.isSafeInteger(staged.chunkCount) || staged.chunkCount !== Math.ceil(staged.size / (1024 * 1024))
          || !/^[a-f0-9]{64}$/.test(staged.sha256)) throw new Error("A descrição do pacote não passou na validação.");
      const chunks: ArrayBuffer[] = [];
      for (let index = 0; index < staged.chunkCount; index++) {
        const response = await fetch(base + "/exports/" + encodeURIComponent(staged.id) + "/chunks/" + index,
          { credentials: "same-origin", cache: "no-store" });
        if (!response.ok) throw new Error("A parte " + (index + 1) + " do pacote não foi recebida. Tente baixar novamente.");
        if (response.headers.get("X-Package-Sha256") !== staged.sha256 || Number(response.headers.get("X-Package-Size")) !== staged.size)
          throw new Error("As partes recebidas não pertencem ao mesmo pacote.");
        const bytes = await response.arrayBuffer();
        if (bytes.byteLength !== Math.min(1024 * 1024, staged.size - index * 1024 * 1024))
          throw new Error("O pacote recebido está incompleto.");
        chunks.push(bytes);
      }
      const archive = new Blob(chunks, { type: "application/vnd.sistema-oficinas.transfer+json" });
      const digest = await crypto.subtle.digest("SHA-256", await archive.arrayBuffer());
      const actual = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
      if (archive.size !== staged.size || actual !== staged.sha256) throw new Error("A integridade do pacote não confere. Nenhum arquivo foi baixado.");
      const url = URL.createObjectURL(archive);
      const link = document.createElement("a"); link.href = url;
      link.download = "oficina-" + new Date().toISOString().slice(0, 10) + ".hptx"; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
      setPhrase("");
      setMessage("Pacote criptografado baixado e conferido por SHA-256. Guarde a frase secreta separadamente.");
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha na exportação."); }
    finally { setBusy(false); }
  }
  async function runPreview() {
    setBusy(true); setError(""); setMessage(""); setPreview(null); setVerification(null);
    try { setPreview(await post<Preview>("/preview", { packageText: fileText, passphrase: phrase, mode })); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao gerar a prévia."); }
    finally { setBusy(false); }
  }
  async function runVerification() {
    setBusy(true); setError(""); setMessage(""); setVerification(null);
    try { setVerification(await post<Record<string, unknown>>("/verify", { packageText: fileText, passphrase: phrase, mode })); setPhrase(""); setMessage("Conferência somente leitura concluída."); await refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao conferir o pacote."); }
    finally { setBusy(false); }
  }
  async function requestApproval() {
    setBusy(true); setError(""); setMessage("");
    try { await post("/critical-requests", { packageSha256: await packageSha256() }); setMessage("Solicitação vinculada ao pacote e à oficina. Outro administrador precisa aprová-la."); await refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao solicitar aprovação."); }
    finally { setBusy(false); }
  }
  async function approve(id: string) {
    setBusy(true); setError(""); setMessage("");
    try { await post("/critical-requests/" + encodeURIComponent(id) + "/approve", {}); setMessage("Aprovação registrada."); await refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao aprovar."); }
    finally { setBusy(false); }
  }
  async function runImport() {
    if (importInFlight.current) return;
    if (!preview?.canImport) {
      setError("Gere uma prévia válida antes de confirmar a importação.");
      return;
    }
    if (confirmation !== preview.confirmationId) {
      setError("O identificador digitado não corresponde à prévia. Copie o identificador completo exibido e tente novamente.");
      return;
    }
    if (!fileText || phrase.length < 12) {
      setError("Selecione o pacote e informe a frase secreta antes de confirmar.");
      return;
    }
    importInFlight.current = true;
    setImporting(true); setBusy(true); setError(""); setMessage("");
    try {
      const sha = await packageSha256();
      const approval = preview.mode === "replace" ? requests.find(item => item.packageSha256 === sha && item.status === "approved") : undefined;
      if (preview.mode === "replace" && (!approval || workshopConfirmation !== preview.targetWorkshop))
        throw new Error("Digite o nome exato da oficina e obtenha a aprovação de outro administrador para este pacote.");
      await post("/import", { packageText: fileText, passphrase: phrase, confirmationId: preview.confirmationId, mode: preview.mode, workshopConfirmation, ...(approval ? { criticalRequestId: approval.id } : {}), confirm: true });
      setMessage("Importação concluída e registrada na auditoria administrativa.");
      setPreview(null); setVerification(null); setConfirmation(""); setWorkshopConfirmation(""); setPhrase(""); setFileText(""); setFileName("");
      try { await refresh(); }
      catch { setError("A importação foi concluída, mas a tela não conseguiu atualizar o histórico. Consulte o histórico antes de qualquer nova operação."); }
    } catch (cause) {
      const message = cause instanceof TypeError
        ? "A conexão foi interrompida antes de confirmar a resposta. A importação pode ter sido concluída; consulte o Histórico de operações antes de tentar novamente."
        : cause instanceof Error ? cause.message : "Falha ao processar a importação.";
      setError(message);
    } finally {
      importInFlight.current = false;
      setImporting(false); setBusy(false);
    }
  }
  async function downloadBackup(id: string) {
    setError("");
    try {
      const response = await fetch(base + "/backups/" + encodeURIComponent(id), { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) throw new Error("Não foi possível baixar a cópia.");
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a"); link.href = url; link.download = "backup-oficina-" + id + ".hptx"; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao baixar a cópia."); }
  }

  return <div className="work-order-section">
    <section className="panel">
      <h2>Transferência completa da oficina</h2>
      <p><strong>{workshopName}</strong> · ID <code>{tenantId}</code> · {environmentLabel}</p>
      <p>Área administrativa restrita. A exportação é preparada em cópia criptografada temporária e baixada em partes, com verificação de integridade. As operações reutilizam as regras de exportação, importação, mesclagem, substituição e conferência já existentes. Usuários, senhas, vínculos e sessões da oficina de destino não são importados nem alterados.</p>
      <label className="field"><span>Frase secreta do pacote</span><input type="password" autoComplete="new-password" minLength={12} maxLength={1024} value={phrase} onChange={event => setPhrase(event.target.value)} /></label>
      <div className="button-row"><button type="button" className="button primary" disabled={busy || phrase.length < 12} onClick={() => void exportPackage()}>{busy ? <LockKeyhole size={16}/> : <Download size={16}/>} Exportar pacote protegido</button></div>
      <hr />
      <label className="field"><span>Modo de importação</span><select value={mode} onChange={event => { setMode(event.target.value as Mode); setPreview(null); setVerification(null); setConfirmation(""); setWorkshopConfirmation(""); }}>
        <option value="empty">Oficina vazia</option><option value="merge">Mesclar dados</option><option value="replace">Substituir dados</option>
      </select></label>
      {mode === "empty" && <p className="muted">Importa somente em uma oficina sem dados operacionais.</p>}
      {mode === "merge" && <p className="muted">Mantém registros preexistentes e identifica atualizações seguras e conflitos.</p>}
      {mode === "replace" && <div className="error-box">Substitui somente os dados operacionais desta oficina. A operação cria e valida um backup criptografado, exige confirmação do nome e da prévia e aprovação de outro administrador. Usuários, credenciais e sessões permanecem preservados.</div>}
      <label className="field"><span>Pacote .hptx (máximo 4 MiB online)</span><input type="file" accept=".hptx,application/vnd.sistema-oficinas.transfer+json" onChange={event => void chooseFile(event)} /></label>
      {fileName && <p className="muted">Arquivo selecionado: {fileName}</p>}
      <div className="button-row">
        <button type="button" className="button" disabled={busy || !fileText || phrase.length < 12} onClick={() => void runPreview()}><Upload size={16}/> Validar e gerar prévia</button>
        <button type="button" className="button" disabled={busy || !fileText || phrase.length < 12} onClick={() => void runVerification()}>Conferir dados importados</button>
      </div>
      {preview && <div className="info-box" aria-live="polite">
        <h3>Prévia · {preview.mode === "empty" ? "Oficina vazia" : preview.mode === "merge" ? "Mesclar" : "Substituir"}</h3>
        <p>Origem: <strong>{preview.sourceWorkshop}</strong> · Destino selecionado: <strong>{workshopName}</strong></p>
        <div className="table-wrap"><table><thead><tr><th>Entidade</th><th>Existentes</th><th>No pacote</th><th>Novos</th><th>Iguais</th><th>Atualizações</th><th>Conflitos</th><th>Removidos</th></tr></thead><tbody>
          {Object.entries(preview.entities).filter(([, row]) => row.existing + row.source > 0).map(([entity, row]) => <tr key={entity}><th>{entity}</th><td>{row.existing}</td><td>{row.source}</td><td>{row.new}</td><td>{row.equal}</td><td>{row.updates}</td><td>{row.conflicts}</td><td>{row.removed}</td></tr>)}
        </tbody></table></div>
        <p>Estoque: {preview.before.stockUnits} → {preview.after.stockUnits} unidades; valor em centavos {preview.before.inventoryValueCents} → {preview.after.inventoryValueCents}.</p>
        <p>Recebíveis: {preview.before.receivablesCents} → {preview.after.receivablesCents}; pagáveis: {preview.before.payablesCents} → {preview.after.payablesCents}; recebimentos: {preview.before.cashReceivedCents} → {preview.after.cashReceivedCents}.</p>
        {preview.issues.map((item, index) => <p className="error-box" key={index}>{item}</p>)}{preview.warnings.map((item, index) => <p className="muted" key={index}>{item}</p>)}
        {preview.canImport && <>
          {preview.mode === "replace" && <><label className="field"><span>Digite exatamente o nome de destino: {preview.targetWorkshop}</span><input value={workshopConfirmation} onChange={event => setWorkshopConfirmation(event.target.value)} /></label>
            {canRequestCritical && <button type="button" className="button" disabled={busy || !fileText || phrase.length < 12} onClick={() => void requestApproval()}>Solicitar aprovação de outro administrador</button>}</>}
          <label className="field"><span>Digite o identificador da prévia: {preview.confirmationId}</span><input value={confirmation} onChange={event => setConfirmation(event.target.value)} /></label>
          <button type="button" className="button primary" disabled={busy || confirmation !== preview.confirmationId || (preview.mode === "replace" && (workshopConfirmation !== preview.targetWorkshop || !requests.some(item => item.status === "approved")))} onClick={() => void runImport()}>{importing ? "Importando..." : preview.mode === "replace" ? "Confirmar substituição" : preview.mode === "merge" ? "Confirmar mesclagem" : "Confirmar importação"}</button>
          {confirmation !== preview.confirmationId && <p className="muted" role="status">Para habilitar a confirmação, digite exatamente o identificador completo da prévia acima.</p>}
        </>}
      </div>}
      {verification && <div className="info-box"><h3>Relatório de conferência somente leitura</h3><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{JSON.stringify(verification, null, 2)}</pre></div>}
      <section className="panel"><h3>Aprovações de substituição</h3><p className="muted">A aprovação é específica para o SHA-256 do pacote e exige administrador diferente de quem solicitou.</p>
        {requests.map(item => <p key={item.id}>{item.requesterEmail} · {item.approverEmail || "aguardando aprovação"} · {item.status} · SHA {item.packageSha256.slice(0, 12)}… {item.status === "requested" && canApproveCritical && <button type="button" className="button" disabled={busy} onClick={() => void approve(item.id)}>Aprovar</button>}</p>)}
      </section>
      <section className="panel"><h3>Cópias de segurança temporárias</h3><p className="muted">Criptografadas, até cinco por oficina e por 30 dias, incluindo exportações preparadas no painel. A auditoria registra downloads sem incluir o conteúdo dos arquivos.</p><button type="button" className="button" onClick={() => void refresh().catch(cause => setError(cause instanceof Error ? cause.message : "Falha ao atualizar."))}>Atualizar listas</button>
        {backups.map(item => <p key={item.id}>{new Date(item.created_at).toLocaleString("pt-BR")} · expira {new Date(item.expires_at).toLocaleDateString("pt-BR")} · SHA {item.package_sha256.slice(0, 12)}… <button type="button" className="button" onClick={() => void downloadBackup(item.id)}>Baixar .hptx</button></p>)}
      </section>
      {showHistory&&<section className="panel"><h3>Histórico de operações</h3><p className="muted">Auditoria administrativa da oficina selecionada.</p>{history.map(item => <p key={item.id}>{new Date(item.created_at).toLocaleString("pt-BR")} · {item.actor_email} · {adminActionLabel(item.action)} · {adminResultLabel(item.result)}</p>)}</section>}
      {message && <p className="info-box" role="status">{message}</p>}{error && <div role="alert" className="error-box">{error}</div>}
    </section>
  </div>;
}
