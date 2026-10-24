import { useState, type ChangeEvent } from "react";
import { Download, LockKeyhole, Upload } from "lucide-react";
import { useApp } from "../lib/context.js";

type Preview = {
  confirmationId: string;
  sourceWorkshop: string;
  targetWorkshop: string;
  counts: Record<string, number>;
  issues: string[];
  warnings: string[];
  canImport: boolean;
};

export function DataTransfer() {
  const { notify } = useApp();
  const [phrase, setPhrase] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [file, setFile] = useState("");
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0];
    setPreview(null);
    setFile("");
    setError("");
    if (!selected) { setFileName(""); return; }
    if (!selected.name.toLowerCase().endsWith(".hptx") || selected.size > 96 * 1024 * 1024) {
      setFileName("");
      setError("Selecione um pacote .hptx com até 96 MB.");
      return;
    }
    setFileName(selected.name);
    setFile(await selected.text());
  }

  async function post(path: string, body: unknown) {
    const response = await fetch(path, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const result = await response.json().catch(() => ({})) as Preview & { error?: string };
    if (!response.ok) throw new Error(result.error || "Não foi possível concluir a transferência.");
    return result;
  }

  async function runPreview() {
    setBusy(true); setError(""); setPreview(null);
    try {
      setPreview(await post("/api/data-transfer/preview", { packageText: file, passphrase: phrase }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao validar o pacote."); }
    finally { setBusy(false); }
  }

  async function runImport() {
    if (!preview?.canImport || confirmation !== preview.confirmationId) return;
    setBusy(true); setError("");
    try {
      const result = await post("/api/data-transfer/import", { packageText: file, passphrase: phrase, confirmationId: preview.confirmationId, confirm: true });
      notify(`Importação concluída: ${Object.values(result.counts).reduce((sum, count) => sum + count, 0)} registros verificados.`);
      setPreview(null); setConfirmation(""); setPhrase(""); setFile(""); setFileName("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha na importação."); }
    finally { setBusy(false); }
  }

  async function runExport() {
    setBusy(true); setError("");
    try {
      const result = await fetch("/api/data-transfer/export", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ passphrase: phrase }) });
      if (!result.ok) { const body = await result.json().catch(() => ({})) as { error?: string }; throw new Error(body.error || "Não foi possível exportar os dados."); }
      const url = URL.createObjectURL(await result.blob());
      const link = document.createElement("a"); link.href = url; link.download = `oficina-${new Date().toISOString().slice(0, 10)}.hptx`; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
      notify("Pacote criptografado baixado. Guarde a frase secreta separadamente.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha na exportação."); }
    finally { setBusy(false); }
  }

  return <div className="work-order-section">
    <section className="panel">
      <h2>Transferência completa da oficina</h2>
      <p>Pacotes protegidos e versionados com os dados operacionais, relacionamentos e histórico disponível. Credenciais, sessões, links públicos e dados comerciais da plataforma não são transferidos.</p>
      <label className="field"><span>Frase secreta do pacote (mínimo 12 caracteres)</span><input type="password" autoComplete="new-password" minLength={12} maxLength={1024} value={phrase} onChange={(event) => setPhrase(event.target.value)} /></label>
      <div className="button-row">
        <button type="button" className="button primary" disabled={busy || phrase.length < 12} onClick={runExport}>{busy ? <LockKeyhole size={16}/> : <Download size={16}/>} Exportar pacote protegido</button>
      </div>
      <hr />
      <label className="field"><span>Pacote .hptx</span><input type="file" accept=".hptx,application/vnd.sistema-oficinas.transfer+json" onChange={chooseFile}/></label>
      {fileName && <p className="muted">Arquivo selecionado: {fileName}</p>}
      <button type="button" className="button" disabled={busy || !file || phrase.length < 12} onClick={runPreview}>{busy ? "Validando…" : <><Upload size={16}/> Validar e gerar prévia</>}</button>
      {preview && <div className="info-box" aria-live="polite">
        <h3>Prévia da importação</h3>
        <p>Origem: <strong>{preview.sourceWorkshop}</strong> · Destino autenticado: <strong>{preview.targetWorkshop}</strong></p>
        <ul>{Object.entries(preview.counts).map(([entity, count]) => <li key={entity}>{entity}: {count}</li>)}</ul>
        {preview.warnings.map((warning) => <p className="muted" key={warning}>{warning}</p>)}
        {preview.issues.map((issue) => <p className="error-box" key={issue}>{issue}</p>)}
        {preview.canImport && <>
          <p>Confirme somente se esta oficina de destino estiver vazia e os dados da prévia estiverem corretos. A importação é transacional e não pode ser aplicada duas vezes.</p>
          <label className="field"><span>Digite o identificador exibido na prévia para confirmar ({preview.confirmationId})</span><input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label>
          <button type="button" className="button primary" disabled={busy || confirmation !== preview.confirmationId} onClick={runImport}>{busy ? "Importando…" : "Confirmar importação"}</button>
        </>}
      </div>}
      {error && <div role="alert" className="error-box">{error}</div>}
    </section>
  </div>;
}
