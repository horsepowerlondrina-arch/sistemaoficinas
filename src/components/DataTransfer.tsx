import { useEffect, useState, type ChangeEvent } from "react";
import { Download, LockKeyhole, Upload } from "lucide-react";
import { useApp } from "../lib/context.js";
import { ArchivedDocuments } from "./ArchivedDocuments.js";

type Preview = {
  mode: "empty" | "merge" | "replace";
  confirmationId: string;
  sourceWorkshop: string;
  targetWorkshop: string;
  counts: Record<string, number>;
  entities: Record<string, { existing: number; source: number; new: number; equal: number; updates: number; conflicts: number; removed: number }>;
  issues: string[];
  warnings: string[];
  canImport: boolean;
  before: { stockUnits: number; inventoryValueCents: number; receivablesCents: number; payablesCents: number; cashReceivedCents: number };
  after: Preview["before"];
  backupRequired: boolean;
  publicLinksToRevoke: number;
  historicalDocumentsToArchive: number;
  historicalDocumentsToRestore: number;
};
type Backup = { id: string; package_sha256: string; created_at: string; expires_at: string };
type VerificationStatus = "corresponding" | "transformed" | "divergent" | "not-verifiable";
const MAX_VERIFY_PACKAGE_TEXT = 4 * 1024 * 1024;
type Verification = {
  mode: Preview["mode"]; sourceWorkshop: string; targetWorkshop: string; packageSha256: string; generatedAt: string; overall: VerificationStatus;
  entities: Record<string, { sourceCount: number; destinationRows: number | null; destinationMatched: number; corresponding: number; transformed: number; divergent: number; missing: number; additionalDestination: number; notVerifiable: number; unrelatedExistingIgnored: number; changedSinceImport: number; records: Array<{ recordId?: string; status: VerificationStatus; differingFields?: string[]; transformedFields?: string[]; reason?: string; changedSinceImport?: boolean }>; omittedDetails: number; financialCents: Record<string, { source: string; destination: string; difference: string }> }>;
  workshopConfiguration: { status: VerificationStatus; differingFields: string[]; transformedFields: string[]; notVerifiableFields: string[] };
  stock: { sourceProductUnits: string; destinationProductUnits: string; differenceUnits: string; sourceMovementUnits: string; destinationMovementUnits: string; differenceMovementUnits: string; sourceInventoryValueCents: string; destinationInventoryValueCents: string; differenceInventoryValueCents: string };
  financial: Record<string, { sourceCents: string; destinationCents: string; differenceCents: string }>;
  referentialIntegrity: { checked: number; divergent: number; notVerifiable: number };
  historicalDocuments: { sourceActive: number; sourceArchived: number; destinationActive: number; destinationArchived: number; missing: number; preservedDestinationArchives: number };
  backups: { existing: number; integrityValid: number; integrityInvalid: number };
  policy: { usersExcluded: number; membershipsExcluded: number; auditEventsExcluded: number; authorsRemapped: number; tenantIdRemapped: true };
  notes: string[];
};
function statusLabel(status: VerificationStatus) {
  return status === "corresponding" ? "Correspondente" : status === "transformed" ? "Transformado" : status === "divergent" ? "Divergente" : "Não verificável";
}
function formatCents(value: string) {
  const cents = BigInt(value), negative = cents < 0n, absolute = negative ? -cents : cents;
  return `R$ ${negative ? "-" : ""}${(absolute / 100n).toLocaleString("pt-BR")},${String(absolute % 100n).padStart(2, "0")}`;
}

export function DataTransfer() {
  const { notify } = useApp();
  const [phrase, setPhrase] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [workshopConfirmation, setWorkshopConfirmation] = useState("");
  const [mode, setMode] = useState<Preview["mode"]>("empty");
  const [backups, setBackups] = useState<Backup[]>([]);
  const [file, setFile] = useState("");
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [verification, setVerification] = useState<Verification | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0];
    setPreview(null);
    setVerification(null);
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

  async function post<T = Preview>(path: string, body: unknown): Promise<T> {
    const response = await fetch(path, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const result = await response.json().catch(() => ({})) as T & { error?: string };
    if (!response.ok) throw new Error(result.error || "Não foi possível concluir a transferência.");
    return result;
  }

  async function refreshBackups() {
    const response = await fetch("/api/data-transfer/backups", { credentials: "same-origin", cache: "no-store" });
    if (!response.ok) return;
    setBackups(await response.json() as Backup[]);
  }

  async function downloadBackup(id: string) {
    const response = await fetch(`/api/data-transfer/backups/${encodeURIComponent(id)}`, { credentials: "same-origin", cache: "no-store" });
    if (!response.ok) { setError("Não foi possível baixar a cópia de segurança."); return; }
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement("a"); link.href = url; link.download = `backup-oficina-${id}.hptx`; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }

  useEffect(() => { void refreshBackups(); }, []);

  async function runPreview() {
    setBusy(true); setError(""); setPreview(null);
    try {
      setPreview(await post<Preview>("/api/data-transfer/preview", { packageText: file, passphrase: phrase, mode }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao validar o pacote."); }
    finally { setBusy(false); }
  }

  async function runVerification() {
    setBusy(true); setError(""); setVerification(null);
    try {
      setVerification(await post<Verification>("/api/data-transfer/verify", { packageText: file, passphrase: phrase, mode }));
      setPhrase("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao conferir o pacote."); }
    finally { setBusy(false); }
  }

  async function runImport() {
    if (!preview?.canImport || confirmation !== preview.confirmationId || (preview.mode === "replace" && workshopConfirmation !== preview.targetWorkshop)) return;
    setBusy(true); setError("");
    try {
      const result = await post("/api/data-transfer/import", { packageText: file, passphrase: phrase, confirmationId: preview.confirmationId, mode: preview.mode, workshopConfirmation, confirm: true });
      notify(`Importação concluída no modo ${result.mode}.`);
      setPreview(null); setConfirmation(""); setWorkshopConfirmation(""); setPhrase(""); setFile(""); setFileName("");
      await refreshBackups();
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
      <p>Pacotes protegidos e versionados com dados operacionais e histórico disponível. A conta, senha, vínculos, permissões e sessões da oficina de destino permanecem intactos; usuários e acessos do pacote não são importados. Referências de autoria dos registros transferidos serão associadas ao proprietário que confirma a operação, e a auditoria histórica da origem não será importada.</p>
      <label className="field"><span>Frase secreta do pacote (mínimo 12 caracteres)</span><input type="password" autoComplete="new-password" minLength={12} maxLength={1024} value={phrase} onChange={(event) => { setPhrase(event.target.value); setVerification(null); }} /></label>
      <div className="button-row">
        <button type="button" className="button primary" disabled={busy || phrase.length < 12} onClick={runExport}>{busy ? <LockKeyhole size={16}/> : <Download size={16}/>} Exportar pacote protegido</button>
      </div>
      <hr />
      <label className="field"><span>Como importar</span><select value={mode} onChange={(event) => { setMode(event.target.value as Preview["mode"]); setPreview(null); setVerification(null); setConfirmation(""); setWorkshopConfirmation(""); }}>
        <option value="empty">Oficina vazia — só aceita destino sem dados operacionais</option>
        <option value="merge">Mesclar dados — mantém o que já existe e adiciona ou atualiza itens reconhecidos</option>
        <option value="replace">Substituir dados — remove os dados operacionais atuais após criar uma cópia criptografada</option>
      </select></label>
      {mode === "empty" && <p className="muted">Use uma oficina sem dados. Contas e acessos existentes são preservados.</p>}
      {mode === "merge" && <p className="muted">Registros novos serão adicionados. Só atualiza cadastros importados anteriormente que não tenham sido alterados localmente. OS, documentos, pagamentos e movimentações não são reescritos.</p>}
      {mode === "replace" && <div className="error-box">A substituição remove dados operacionais somente desta oficina. Uma cópia `.hptx` criptografada será validada e guardada antes da troca. Contas, senhas, vínculos atuais e sessões são mantidos; links públicos ativos serão revogados. Guarde a frase secreta para conseguir abrir a cópia.</div>}
      <label className="field"><span>Pacote .hptx</span><input type="file" accept=".hptx,application/vnd.sistema-oficinas.transfer+json" onChange={chooseFile}/></label>
      {fileName && <p className="muted">Arquivo selecionado: {fileName}</p>}
      <div className="button-row">
        <button type="button" className="button" disabled={busy || !file || phrase.length < 12} onClick={runPreview}>{busy ? "Validando…" : <><Upload size={16}/> Validar e gerar prévia</>}</button>
        <button type="button" className="button" disabled={busy || !file || file.length > MAX_VERIFY_PACKAGE_TEXT || phrase.length < 12} onClick={runVerification}>{busy ? "Conferindo…" : "Conferir dados importados"}</button>
      </div>
      {file.length > MAX_VERIFY_PACKAGE_TEXT && <p className="muted" role="status">A conferência online aceita pacotes de até 4 MiB por causa do limite de requisição da hospedagem. Arquivos maiores exigem uma futura estratégia de envio em partes; o limite de seleção para importação continua inalterado.</p>}
      {verification && <div className="info-box" aria-live="polite">
        <h3>Relatório de conferência</h3>
        <p className="muted">A comparação só consulta dados desta oficina, não altera o banco e não guarda a frase secreta. A frase foi removida deste formulário após a conferência.</p>
        <p><strong>Resultado geral: {statusLabel(verification.overall)}</strong> · Modo: {verification.mode === "empty" ? "Oficina vazia" : verification.mode === "merge" ? "Mesclar" : "Substituir"}</p>
        <p>Pacote SHA-256: <code>{verification.packageSha256}</code></p>
        <p>Origem: <strong>{verification.sourceWorkshop}</strong> · Oficina autenticada: <strong>{verification.targetWorkshop}</strong></p>
        <div className="table-wrap"><table><thead><tr><th>Entidade</th><th>No arquivo</th><th>No destino</th><th>Correspondentes</th><th>Transformados</th><th>Divergentes</th><th>Ausentes</th><th>Adicionais</th><th>Não verificáveis</th></tr></thead><tbody>
          {Object.entries(verification.entities).filter(([, item]) => item.sourceCount > 0 || (item.destinationRows || 0) > 0).map(([entity, item]) => <tr key={entity}><th>{entity}</th><td>{item.sourceCount}</td><td>{item.destinationRows ?? "Política"}</td><td>{item.corresponding}</td><td>{item.transformed}</td><td>{item.divergent}</td><td>{item.missing}</td><td>{item.additionalDestination}</td><td>{item.notVerifiable}</td></tr>)}
        </tbody></table></div>
        <h4>Estoque e financeiro</h4>
        <ul>
          <li>Produtos: {verification.stock.sourceProductUnits} unidades no pacote · {verification.stock.destinationProductUnits} unidades correspondentes no destino · diferença {verification.stock.differenceUnits}</li>
          <li>Valor de estoque: {formatCents(verification.stock.sourceInventoryValueCents)} no pacote · {formatCents(verification.stock.destinationInventoryValueCents)} no destino · diferença {formatCents(verification.stock.differenceInventoryValueCents)}</li>
          <li>Movimentações: {verification.stock.sourceMovementUnits} unidades no pacote · {verification.stock.destinationMovementUnits} correspondentes no destino · diferença {verification.stock.differenceMovementUnits}</li>
          {Object.entries(verification.financial).map(([field, totals]) => <li key={field}>{field}: {formatCents(totals.sourceCents)} no pacote · {formatCents(totals.destinationCents)} no destino · diferença {formatCents(totals.differenceCents)}</li>)}
        </ul>
        <p>Configuração da oficina: <strong>{statusLabel(verification.workshopConfiguration.status)}</strong>
          {verification.workshopConfiguration.differingFields.length > 0 && <> · campos divergentes: {verification.workshopConfiguration.differingFields.join(", ")}</>}
          {verification.workshopConfiguration.transformedFields.length > 0 && <> · preservados pela política de mesclagem: {verification.workshopConfiguration.transformedFields.join(", ")}</>}
          {verification.workshopConfiguration.notVerifiableFields.length > 0 && <> · não verificáveis: {verification.workshopConfiguration.notVerifiableFields.join(", ")}</>}</p>
        <p>Integridade referencial: {verification.referentialIntegrity.checked} relações verificadas · {verification.referentialIntegrity.divergent} divergentes · {verification.referentialIntegrity.notVerifiable} não verificáveis.</p>
        <p>Documentos: {verification.historicalDocuments.sourceActive} revisões ativas e {verification.historicalDocuments.sourceArchived} arquivadas no pacote · {verification.historicalDocuments.missing} ausentes ou com estado de arquivo divergente · {verification.historicalDocuments.preservedDestinationArchives} arquivos anteriores preservados no modo Substituir.</p>
        <p>Backups da oficina: {verification.backups.existing} existentes · {verification.backups.integrityValid} íntegros · {verification.backups.integrityInvalid} com falha de integridade.</p>
        <p>Política aplicada: {verification.policy.usersExcluded} usuários, {verification.policy.membershipsExcluded} vínculos e {verification.policy.auditEventsExcluded} eventos de auditoria da origem não são importados; {verification.policy.authorsRemapped} campos de autoria foram remapeados. Identidades históricas não são declaradas como preservadas.</p>
        {Object.entries(verification.entities).flatMap(([entity, item]) => item.records.map((record, index) => ({ entity, record, index }))).filter(({ record }) => record.status !== "corresponding" || record.changedSinceImport).length > 0 && <div>
          <h4>Registros para revisão</h4>
          <ul>{Object.entries(verification.entities).flatMap(([entity, item]) => item.records.map((record, index) => ({ entity, record, index }))).filter(({ record }) => record.status !== "corresponding" || record.changedSinceImport).slice(0, 200).map(({ entity, record, index }) => <li key={`${entity}-${record.recordId || index}`}><strong>{entity}</strong>{record.recordId ? ` · ID ${record.recordId}` : ""} · {statusLabel(record.status)}{record.differingFields?.length ? ` · campos: ${record.differingFields.join(", ")}` : ""}{record.transformedFields?.length ? ` · transformação: ${record.transformedFields.join(", ")}` : ""}{record.changedSinceImport ? " · hash diferente do estado rastreado" : ""}{record.reason ? ` · ${record.reason}` : ""}</li>)}</ul>
          {Object.entries(verification.entities).some(([, item]) => item.omittedDetails > 0) && <p className="muted">O relatório detalhado é limitado a 100 registros por entidade; os totais incluem todos os registros.</p>}
        </div>}
        {verification.notes.map((note) => <p className="muted" key={note}>{note}</p>)}
      </div>}
      {preview && <div className="info-box" aria-live="polite">
        <h3>Prévia da importação</h3>
        <p>Origem: <strong>{preview.sourceWorkshop}</strong> · Destino autenticado: <strong>{preview.targetWorkshop}</strong></p>
        <div className="table-wrap"><table><thead><tr><th>Entidade</th><th>Existem</th><th>No arquivo</th><th>Novos</th><th>Iguais</th><th>Atualizações</th><th>Conflitos</th><th>Removidos</th></tr></thead><tbody>
          {Object.entries(preview.entities).filter(([, item]) => item.existing + item.source > 0).map(([entity, item]) => <tr key={entity}><th>{entity}</th><td>{item.existing}</td><td>{item.source}</td><td>{item.new}</td><td>{item.equal}</td><td>{item.updates}</td><td>{item.conflicts}</td><td>{item.removed}</td></tr>)}
        </tbody></table></div>
        <p>Resumo financeiro e de estoque (valores em reais, armazenados em centavos):</p>
        <ul>
          <li>Estoque: {preview.before.stockUnits} unidades · R$ {(preview.before.inventoryValueCents / 100).toFixed(2)} → {preview.after.stockUnits} unidades · R$ {(preview.after.inventoryValueCents / 100).toFixed(2)}</li>
          <li>Contas a receber em aberto: R$ {(preview.before.receivablesCents / 100).toFixed(2)} → R$ {(preview.after.receivablesCents / 100).toFixed(2)}</li>
          <li>Contas a pagar em aberto: R$ {(preview.before.payablesCents / 100).toFixed(2)} → R$ {(preview.after.payablesCents / 100).toFixed(2)}</li>
          <li>Recebimentos registrados: R$ {(preview.before.cashReceivedCents / 100).toFixed(2)} → R$ {(preview.after.cashReceivedCents / 100).toFixed(2)}</li>
        </ul>
        {preview.mode === "replace" && <p><strong>Serão revogados {preview.publicLinksToRevoke} links públicos ativos, arquivadas {preview.historicalDocumentsToArchive} revisões atuais e restauradas {preview.historicalDocumentsToRestore} associações presentes no pacote.</strong> Revisões marcadas como arquivadas no pacote continuam separadas; só voltam à lista do registro quando o próprio pacote as identifica como ativas. A cópia de segurança só será criada e conferida dentro da transação de substituição. Se algo falhar, o PostgreSQL reverte a operação integralmente.</p>}
        {preview.warnings.map((warning) => <p className="muted" key={warning}>{warning}</p>)}
        {preview.issues.map((issue) => <p className="error-box" key={issue}>{issue}</p>)}
        {preview.canImport && <>
          <p>{preview.mode === "empty" ? "Confirme se a oficina está vazia e revise os totais." : preview.mode === "merge" ? "Revise os conflitos e os totais antes de mesclar." : "A confirmação substituirá os dados operacionais apresentados acima após validar e guardar a cópia criptografada."} A operação é revalidada e executada em transação.</p>
          {preview.mode === "replace" && <label className="field"><span>Digite o nome exato da oficina de destino para autorizar a substituição: {preview.targetWorkshop}</span><input value={workshopConfirmation} onChange={(event) => setWorkshopConfirmation(event.target.value)} /></label>}
          <label className="field"><span>Digite o identificador exibido na prévia para confirmar ({preview.confirmationId})</span><input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label>
          <button type="button" className="button primary" disabled={busy || confirmation !== preview.confirmationId || (preview.mode === "replace" && workshopConfirmation !== preview.targetWorkshop)} onClick={runImport}>{busy ? "Importando…" : preview.mode === "replace" ? "Confirmar substituição" : preview.mode === "merge" ? "Confirmar mesclagem" : "Confirmar importação"}</button>
        </>}
      </div>}
      <section className="panel"><h3>Cópias de segurança de substituições</h3><p className="muted">As cópias são criptografadas, mantidas por até 30 dias e limitadas às cinco mais recentes por oficina. Expiradas ou excedentes são removidas quando a lista é consultada ou uma nova substituição é concluída. Baixe e guarde fora do sistema se precisar mantê-las por mais tempo.</p><button type="button" className="button" onClick={() => void refreshBackups()}>Atualizar lista</button>{backups.map((backup) => <p key={backup.id}>{new Date(backup.created_at).toLocaleString()} · expira {new Date(backup.expires_at).toLocaleDateString("pt-BR")} · integridade {backup.package_sha256.slice(0, 12)}… <button type="button" className="button" onClick={() => void downloadBackup(backup.id)}>Baixar `.hptx`</button></p>)}</section>
      <ArchivedDocuments />
      {error && <div role="alert" className="error-box">{error}</div>}
    </section>
  </div>;
}
