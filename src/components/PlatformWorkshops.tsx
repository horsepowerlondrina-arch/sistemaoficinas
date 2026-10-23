import { useEffect, useState, type FormEvent } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight, Plus, RefreshCw, Search, ShieldCheck } from "lucide-react";

type Status = "pending_verification" | "trial" | "active" | "grace_period" | "read_only" | "blocked" | "archived" | "legacy";
type Workshop = {
  tenant_id: string; name: string; document: string; phone: string; status: Status; source: string;
  responsible_name: string; responsible_email: string; created_at: string | null; updated_at: string | null;
  email_verified_at: string | null; trial_started_at: string | null; trial_ends_at: string | null;
  trial_days_remaining: number | null; status_reason: string; total_count?: number;
};
type HistoryEvent = { id: string; actor_email: string; action: string; result: string; technical_context: Record<string, unknown>; created_at: string };
type FormFields = Pick<Workshop, "name" | "responsible_name" | "responsible_email" | "phone" | "document">;

const labels: Record<Status, string> = {
  pending_verification: "Aguardando confirmação", trial: "Teste grátis", active: "Ativa", grace_period: "Tolerância",
  read_only: "Somente leitura", blocked: "Bloqueada", archived: "Arquivada", legacy: "Legada",
};
const blank: FormFields = { name: "", responsible_name: "", responsible_email: "", phone: "", document: "" };

async function request<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(`/admin-api${path}`, {
    method, credentials: "same-origin",
    ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(value.error || "Não foi possível concluir a operação.");
  return value as T;
}

function toFields(value?: Workshop): FormFields {
  return value ? { name: value.name, responsible_name: value.responsible_name, responsible_email: value.responsible_email, phone: value.phone, document: value.document } : blank;
}
function localDate(value: string | null) { return value ? new Date(value).toLocaleString("pt-BR") : "—"; }

export function PlatformWorkshops({ canManage }: { canManage: boolean }) {
  const [items, setItems] = useState<Workshop[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [selected, setSelected] = useState<Workshop | null>(null);
  const [history, setHistory] = useState<HistoryEvent[]>([]);
  const [fields, setFields] = useState<FormFields>(blank);
  const [editing, setEditing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [nextStatus, setNextStatus] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = async (nextPage = page) => {
    setError("");
    try {
      const query = new URLSearchParams({ search, status, page: String(nextPage), page_size: "20" });
      const result = await request<{ items: Workshop[]; total: number }>(`/workshops?${query}`);
      setItems(result.items); setTotal(result.total); setPage(nextPage);
    } catch (cause) { setError((cause as Error).message); }
  };
  useEffect(() => { void load(1); }, [status]);

  const openWorkshop = async (tenantId: string) => {
    setError(""); setMessage(""); setBusy(true);
    try {
      const detail = await request<Workshop>(`/workshops/${encodeURIComponent(tenantId)}`);
      const events = await request<HistoryEvent[]>(`/workshops/${encodeURIComponent(tenantId)}/history`);
      setSelected(detail); setHistory(events); setFields(toFields(detail)); setEditing(false); setCreating(false); setReason(""); setNextStatus("");
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  };
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    try {
      if (creating) {
        const result = await request<{ tenant_id: string }>("/workshops", "POST", fields);
        setMessage("Oficina cadastrada como pendente. O acesso operacional só será liberado após a confirmação do e-mail.");
        setCreating(false); setFields(blank); await load(1); await openWorkshop(result.tenant_id);
      } else if (selected) {
        await request(`/workshops/${encodeURIComponent(selected.tenant_id)}`, "PUT", fields);
        setMessage("Dados administrativos atualizados e auditados."); await openWorkshop(selected.tenant_id); await load();
      }
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  };
  const changeStatus = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!selected || !nextStatus) return;
    setBusy(true); setError(""); setMessage("");
    try {
      await request(`/workshops/${encodeURIComponent(selected.tenant_id)}/status`, "PATCH", { status: nextStatus, reason });
      setMessage("Situação alterada e registrada na auditoria."); await openWorkshop(selected.tenant_id); await load();
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  };
  const setField = (key: keyof FormFields, value: string) => setFields(current => ({ ...current, [key]: value }));

  if (creating || editing) return <section className="pa-card pa-workshop-form-card">
    <div className="pa-section-title"><div><h2>{creating ? "Cadastrar oficina" : "Editar dados cadastrais"}</h2><p>O cadastro não libera o sistema enquanto o e-mail estiver pendente.</p></div><button type="button" className="pa-quiet" onClick={() => { setCreating(false); setEditing(false); setFields(toFields(selected || undefined)); }}><ArrowLeft size={16}/> Voltar</button></div>
    <form className="pa-workshop-form" onSubmit={save}>
      <label>Nome da oficina<input required minLength={2} maxLength={160} value={fields.name} onChange={e => setField("name",e.target.value)} /></label>
      <label>Responsável<input required minLength={2} maxLength={120} value={fields.responsible_name} onChange={e => setField("responsible_name",e.target.value)} /></label>
      <label>E-mail do responsável<input required type="email" maxLength={254} value={fields.responsible_email} onChange={e => setField("responsible_email",e.target.value)} /></label>
      <label>Telefone ou WhatsApp<input maxLength={40} value={fields.phone} onChange={e => setField("phone",e.target.value)} /></label>
      <label>CPF/CNPJ (opcional)<input maxLength={32} value={fields.document} onChange={e => setField("document",e.target.value)} /></label>
      <p className="pa-workshop-form-note">Nenhum usuário, cliente ou documento operacional é criado nesta etapa. A oficina recebe um identificador de tenant próprio.</p>
      <button className="pa-primary" disabled={busy}>{busy ? "Salvando…" : "Salvar cadastro"}</button>
    </form>
  </section>;

  if (selected) return <div className="pa-workshop-detail">
    <section className="pa-card"><div className="pa-section-title"><div><button className="pa-back-button" onClick={() => setSelected(null)}><ArrowLeft size={15}/> Voltar à lista</button><h2>{selected.name}</h2><p>{selected.tenant_id}</p></div><span className={`pa-status ${selected.status === "trial" || selected.status === "active" ? "is-active" : ""}`}>{labels[selected.status]}</span></div>
      {canManage && selected.source !== "legacy" && <button className="pa-quiet" disabled={busy} onClick={() => { setFields(toFields(selected)); setEditing(true); }}><ShieldCheck size={15}/> Editar dados</button>}
      <dl className="pa-workshop-data"><div><dt>Responsável</dt><dd>{selected.responsible_name || "Não informado"}</dd></div><div><dt>E-mail</dt><dd>{selected.responsible_email || "Não informado"}</dd></div><div><dt>Telefone</dt><dd>{selected.phone || "Não informado"}</dd></div><div><dt>CPF/CNPJ</dt><dd>{selected.document || "Não informado"}</dd></div><div><dt>Origem</dt><dd>{selected.source === "legacy" ? "Cadastro anterior" : "Painel administrativo"}</dd></div><div><dt>Cadastro</dt><dd>{localDate(selected.created_at)}</dd></div><div><dt>E-mail confirmado</dt><dd>{localDate(selected.email_verified_at)}</dd></div><div><dt>Início do teste</dt><dd>{localDate(selected.trial_started_at)}</dd></div><div><dt>Fim do teste</dt><dd>{localDate(selected.trial_ends_at)}{selected.trial_days_remaining !== null && selected.trial_days_remaining !== undefined ? ` · ${selected.trial_days_remaining} dia(s) restantes` : ""}</dd></div><div><dt>Identificador</dt><dd>{selected.tenant_id}</dd></div></dl>
      {selected.status_reason && <p className="pa-workshop-reason">Situação: {selected.status_reason}</p>}
      {canManage && selected.source !== "legacy" && <form className="pa-workshop-state-form" onSubmit={changeStatus}><h3>Alteração manual da situação</h3><p>Teste e estados de cobrança só podem ser definidos por confirmação ou integração futura.</p><label>Nova situação<select required value={nextStatus} onChange={e => setNextStatus(e.target.value)}><option value="">Selecione…</option><option value="read_only">Somente leitura</option><option value="blocked">Bloqueada</option><option value="archived">Arquivada</option></select></label><label>Justificativa<textarea required minLength={10} maxLength={500} value={reason} onChange={e => setReason(e.target.value)} /></label><button className="pa-quiet" disabled={busy || !nextStatus}>Registrar mudança</button></form>}
    </section>
    <section className="pa-card"><div className="pa-section-title"><div><h2>Histórico administrativo</h2><p>Eventos imutáveis associados à oficina.</p></div></div><div className="pa-audit-list">{history.map(event => <article className="pa-audit-event" key={event.id}><span className={`pa-status ${event.result === "success" ? "is-active" : ""}`}>{event.result}</span><div><strong>{event.action}</strong><small>{event.actor_email || "Sistema"} · {localDate(event.created_at)}</small>{typeof event.technical_context?.reason === "string" && <small>Justificativa: {event.technical_context.reason}</small>}</div></article>)}{history.length === 0 && <p>Nenhuma ação registrada.</p>}</div></section>
    {message && <p className="pa-note" role="status">{message}</p>}{error && <p className="pa-note pa-note--error" role="alert">{error}</p>}
  </div>;

  return <div className="pa-workshops">
    <section className="pa-card"><div className="pa-section-title"><div><h2>Oficinas cadastradas</h2><p>Os cadastros anteriores permanecem com o acesso atual; nenhuma cobrança ou dado operacional aparece aqui.</p></div><div className="pa-workshop-actions"><button className="pa-quiet" onClick={() => void load(1)}><RefreshCw size={15}/> Atualizar</button>{canManage && <button className="pa-primary" onClick={() => { setFields(blank); setCreating(true); setMessage(""); setError(""); }}><Plus size={16}/> Cadastrar oficina</button>}</div></div>
      <form className="pa-workshop-filters" onSubmit={event => { event.preventDefault(); void load(1); }}><label><span>Pesquisar</span><div><Search size={15}/><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Nome, identificador, documento ou e-mail" /></div></label><label>Situação<select value={status} onChange={e => setStatus(e.target.value)}><option value="all">Todas</option>{Object.entries(labels).map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select></label><button className="pa-quiet">Buscar</button></form>
      <div className="pa-workshop-list">{items.map(item => <button type="button" className="pa-workshop-row" key={item.tenant_id} onClick={() => void openWorkshop(item.tenant_id)}><span><strong>{item.name}</strong><small>{item.responsible_email || item.document || item.tenant_id}</small></span><span className={`pa-status ${item.status === "trial" || item.status === "active" ? "is-active" : ""}`}>{labels[item.status]}</span><small>{item.trial_days_remaining !== null && item.trial_days_remaining !== undefined ? `${item.trial_days_remaining} dia(s)` : item.source === "legacy" ? "Acesso legado" : "Sem teste iniciado"}</small></button>)}{items.length === 0 && <p className="pa-empty">Nenhuma oficina encontrada.</p>}</div>
      <div className="pa-pagination"><span>{total} oficina(s) · Página {page} de {Math.max(1,Math.ceil(total/20))}</span><div><button className="pa-quiet" disabled={page<=1 || busy} onClick={() => void load(page-1)}><ChevronLeft size={16}/> Anterior</button><button className="pa-quiet" disabled={page*20>=total || busy} onClick={() => void load(page+1)}>Próxima <ChevronRight size={16}/></button></div></div>
    </section>
    {message && <p className="pa-note" role="status">{message}</p>}{error && <p className="pa-note pa-note--error" role="alert">{error}</p>}
  </div>;
}
