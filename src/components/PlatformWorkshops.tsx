import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight, Copy, Plus, RefreshCw, Search, ShieldCheck, X } from "lucide-react";
import { PlatformDataTransfer } from "./PlatformDataTransfer";
import { PlatformWorkshopEntitlements } from "./PlatformWorkshopEntitlements";
import { PlatformWorkshopUsers } from "./PlatformWorkshopUsers";

import {adminRequest as request, adminActionLabel, adminResultLabel, adminReason, localDateInput, workshopTabs, type WorkshopTab} from "../lib/adminPresentation";
import {confirmAdminNavigation, useAdminDraft} from "../lib/useAdminDraft";

type Status = "pending_verification" | "trial" | "active" | "grace_period" | "read_only" | "blocked" | "archived" | "legacy";
type Workshop = {
  tenant_id: string; name: string; document: string; phone: string; status: Status; source: string;
  responsible_name: string; responsible_email: string; created_at: string | null; updated_at: string | null;
  email_verified_at: string | null; trial_started_at: string | null; trial_ends_at: string | null;
  trial_days_remaining: number | null; status_reason: string; total_count?: number;
  invitation_status: "none" | "pending" | "sent" | "failed" | "expired" | "revoked" | "used" | "manual_link_created";
  invitation_expires_at: string | null; invitation_sent_at: string | null;
  catalog_access?: CatalogAccess;
};
type HistoryEvent = { id: string; actor_email: string; action: string; result: string; technical_context: Record<string, unknown>; created_at: string };
type CatalogAccess = { status:"active"|"not_contracted"|"expired"|"revoked"|"not_installed"; enabled:boolean; valid_until:string|null; activated_at:string|null; grant_source:string; updated_by_admin_id:string|null; updated_by_admin_email:string; updated_at:string|null; reason:string; catalog_installed:boolean };
type CatalogTestAccess = { available:boolean; enabled:boolean; valid_until:string|null; updated_by_admin_email:string; updated_at:string|null; reason:string };
type ManualActivation = { mode:"confirm" } | { mode:"link"; url:string; expiresAt:string };
type FormFields = Pick<Workshop, "name" | "responsible_name" | "responsible_email" | "phone" | "document">;

const labels: Record<Status, string> = {
  pending_verification: "Aguardando confirmação", trial: "Teste grátis", active: "Ativa", grace_period: "Tolerância",
  read_only: "Somente leitura", blocked: "Bloqueada", archived: "Arquivada", legacy: "Legada",
};
const invitationLabels: Record<Workshop["invitation_status"], string> = {
  none:"Não enviado", pending:"Preparando envio", sent:"Enviado", failed:"Falha no envio",
  expired:"Expirado", revoked:"Substituído", used:"Ativação concluída", manual_link_created:"Link manual pronto",
};
const blank: FormFields = { name: "", responsible_name: "", responsible_email: "", phone: "", document: "" };

function toFields(value?: Workshop): FormFields {
  return value ? { name: value.name, responsible_name: value.responsible_name, responsible_email: value.responsible_email, phone: value.phone, document: value.document } : blank;
}
function localDate(value: string | null) { return value ? new Date(value).toLocaleString("pt-BR") : "—"; }
const localDateTimeInput = localDateInput;
const catalogAccessLabels:Record<CatalogAccess["status"],string>={active:"Habilitado",not_contracted:"Não contratado",expired:"Acesso vencido",revoked:"Acesso revogado",not_installed:"Catálogo ainda não instalado"};

export function PlatformWorkshops({ canManage, canManageModules, canTransfer, canRequestCritical, canApproveCritical, environmentLabel }: { canManage: boolean; canManageModules:boolean; canTransfer: boolean; canRequestCritical: boolean; canApproveCritical: boolean; environmentLabel: string }) {
  const [tab,setTab]=useState<WorkshopTab>("general");
  const [historyError,setHistoryError]=useState("");
  const [historyLoading,setHistoryLoading]=useState(false);
  const listRequest=useRef(0), detailRequest=useRef(0), historyRequest=useRef(0), actionLock=useRef(false);
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
  const [trialDays, setTrialDays] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [catalogUntil,setCatalogUntil]=useState("");
  const [catalogReason,setCatalogReason]=useState("Autorização administrativa do módulo Catálogo Técnico.");
  const [testAccess,setTestAccess]=useState<CatalogTestAccess|null>(null);
  const [testUntil,setTestUntil]=useState("");
  const [testReason,setTestReason]=useState("Acesso temporário para testes de homologação.");
  const [testAccessUnavailable,setTestAccessUnavailable]=useState(false);
  const [manualActivation,setManualActivation]=useState<ManualActivation|null>(null);
  const [identityVerified,setIdentityVerified]=useState(false);
  const [verificationMethod,setVerificationMethod]=useState<"phone"|"in_person"|"video_call"|"other">("phone");

  const formDirty=(creating||editing)&&JSON.stringify(fields)!==JSON.stringify(toFields(creating?undefined:selected||undefined));
  const catalogDirty=!!selected&&(catalogUntil!==localDateTimeInput(selected.catalog_access?.valid_until||null)||catalogReason!=="Autorização administrativa do módulo Catálogo Técnico.");
  useAdminDraft(formDirty||!!reason||!!nextStatus||catalogDirty||identityVerified||manualActivation?.mode==="link");
  const cancelEdit=()=>{if(busy||!confirmAdminNavigation())return;setCreating(false);setEditing(false);setFields(toFields(selected||undefined));setError("");};
  const loadHistory=async(tenantId:string)=>{
    const requestId=++historyRequest.current;setHistoryLoading(true);setHistoryError("");
    try{const events=await request<HistoryEvent[]>(`/workshops/${encodeURIComponent(tenantId)}/history`);if(requestId===historyRequest.current)setHistory(events);}
    catch(cause){if(requestId===historyRequest.current)setHistoryError((cause as Error).message);}
    finally{if(requestId===historyRequest.current)setHistoryLoading(false);}
  };
  const load = async (nextPage = page) => {
    const requestId=++listRequest.current;
    setError("");
    try {
      const query = new URLSearchParams({ search, status, page: String(nextPage), page_size: "20" });
      const result = await request<{ items: Workshop[]; total: number }>(`/workshops?${query}`);
      if(requestId!==listRequest.current)return;
      setItems(result.items); setTotal(result.total); setPage(nextPage);
    } catch (cause) { if(requestId===listRequest.current)setError((cause as Error).message); }
  };
  useEffect(() => { void load(1); }, [status]);
  useEffect(()=>{if(!canManageModules||environmentLabel==="Ambiente local")return;void request<CatalogTestAccess>("/catalog-test-access").then(value=>{setTestAccess(value);setTestUntil(localDateTimeInput(value.valid_until));}).catch(()=>setTestAccessUnavailable(true));},[canManageModules,environmentLabel]);

  const openWorkshop = async (tenantId: string) => {
    const requestId=++detailRequest.current;
    setManualActivation(null); setIdentityVerified(false);
    setError(""); setMessage(""); setBusy(true);
    try {
      const detail = await request<Workshop>(`/workshops/${encodeURIComponent(tenantId)}`);
      if(requestId!==detailRequest.current)return;
      setHistory([]); void loadHistory(tenantId);
      setSelected(detail); setFields(toFields(detail)); setEditing(false); setCreating(false); setReason(""); setNextStatus(""); setTrialDays("");
      setCatalogUntil(localDateTimeInput(detail.catalog_access?.valid_until||null));
      setCatalogReason("Autorização administrativa do módulo Catálogo Técnico.");
    } catch (cause) { if(requestId===detailRequest.current)setError((cause as Error).message); }
    finally { if(requestId===detailRequest.current&&!actionLock.current)setBusy(false); }
  };
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if(actionLock.current)return;actionLock.current=true; setBusy(true); setError(""); setMessage("");
    try {
      if (creating) {
        const result = await request<{ tenant_id: string; invitation_status: Workshop["invitation_status"] }>("/workshops", "POST", fields);
        setCreating(false); setFields(blank); await load(1); await openWorkshop(result.tenant_id);
        setMessage(result.invitation_status === "sent"
          ? "Oficina cadastrada. O convite de ativação foi enviado ao responsável."
          : "Oficina cadastrada, mas o convite não foi enviado. Confira a configuração do serviço de e-mail e tente novamente.");
      } else if (selected) {
        await request(`/workshops/${encodeURIComponent(selected.tenant_id)}`, "PUT", fields);
        await openWorkshop(selected.tenant_id); await load(); setMessage("Dados administrativos atualizados e auditados.");
      }
    } catch (cause) { setError((cause as Error).message); }
    finally { actionLock.current=false; setBusy(false); }
  };
  const changeStatus = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!selected || !nextStatus || actionLock.current) return;
    if(["blocked","archived","read_only"].includes(nextStatus)&&!window.confirm("Confirmar a restrição de acesso desta oficina? Os dados serão preservados."))return;
    actionLock.current=true;
    setBusy(true); setError(""); setMessage("");
    try {
      await request(`/workshops/${encodeURIComponent(selected.tenant_id)}/status`, "PATCH", { status: nextStatus, trial_days: nextStatus === "trial" && trialDays.trim() ? Number(trialDays) : null, reason });
      await openWorkshop(selected.tenant_id); await load(); setMessage("Situação alterada e registrada na auditoria.");
    } catch (cause) { setError((cause as Error).message); }
    finally { actionLock.current=false; setBusy(false); }
  };
  const sendInvitation = async () => {
    if (!selected || actionLock.current) return;
    if(selected.invitation_status!=="none"&&!window.confirm("Reenviar o convite e invalidar o link anterior?"))return;
    actionLock.current=true; setBusy(true); setError(""); setMessage("");
    try {
      const result = await request<{ invitation_status: Workshop["invitation_status"] }>(`/workshops/${encodeURIComponent(selected.tenant_id)}/invitation`, "POST", {});
      await openWorkshop(selected.tenant_id);
      setMessage(result.invitation_status === "sent"
        ? "Convite enviado. Os convites anteriores foram invalidados."
        : "O convite não foi enviado. Verifique a configuração do serviço de e-mail e tente novamente.");
      await load();
    } catch (cause) { setError((cause as Error).message); }
    finally { actionLock.current=false; setBusy(false); }
  };
  const generateManualActivationLink = async () => {
    if (!selected || !identityVerified || actionLock.current) return;
    actionLock.current=true;
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await request<{ activation_url:string; invitation_expires_at:string }>(
        `/workshops/${encodeURIComponent(selected.tenant_id)}/manual-activation-link`,
        "POST",
        { identity_verified:true, verification_method:verificationMethod },
      );
      const activationUrl = new URL(result.activation_url);
      if (activationUrl.origin !== window.location.origin || !activationUrl.hash) {
        throw new Error("O servidor retornou um link de ativação inválido.");
      }
      setSelected(current => current?.tenant_id === selected.tenant_id ? {
        ...current, invitation_status:"manual_link_created", invitation_expires_at:result.invitation_expires_at, invitation_sent_at:null,
      } : current);
      setManualActivation({ mode:"link", url:activationUrl.toString(), expiresAt:result.invitation_expires_at });
      setIdentityVerified(false);
      await load();
    } catch (cause) { setError((cause as Error).message); }
    finally { actionLock.current=false; setBusy(false); }
  };
  const closeManualActivation = () => { setManualActivation(null); setIdentityVerified(false); };
  const copyManualActivationLink = async () => {
    if (!manualActivation || manualActivation.mode !== "link") return;
    try { await navigator.clipboard.writeText(manualActivation.url); setMessage("Link copiado. Ele continuará visível somente até você fechar esta janela."); }
    catch { setError("Não foi possível copiar automaticamente. Selecione o link e copie manualmente."); }
  };
  const setField = (key: keyof FormFields, value: string) => setFields(current => ({ ...current, [key]: value }));
  const changeCatalogAccess=async(enabled:boolean)=>{
    if(!selected||actionLock.current)return;
    if(catalogReason.trim().length<10||catalogReason.trim().length>500){setError("Informe uma justificativa entre 10 e 500 caracteres.");return;}
    if(!enabled&&!window.confirm("Desabilitar o catálogo somente para esta oficina?"))return;
    actionLock.current=true;setBusy(true);setError("");setMessage("");
    try{
      await request(`/workshops/${encodeURIComponent(selected.tenant_id)}/catalog-access`,"PATCH",{
        enabled,valid_until:enabled&&catalogUntil?new Date(catalogUntil).toISOString():null,reason:catalogReason,
      });
      await openWorkshop(selected.tenant_id);await load();
      setMessage(enabled?"Acesso ao Catálogo Técnico habilitado e registrado no histórico.":"Acesso ao Catálogo Técnico revogado. Os registros históricos foram preservados.");
    }catch(cause){setError((cause as Error).message);}finally{actionLock.current=false;setBusy(false);}
  };
  const changeTestAccess=async(enabled:boolean)=>{
    if(actionLock.current)return;
    if(testReason.trim().length<10||testReason.trim().length>500){setError("Informe uma justificativa entre 10 e 500 caracteres.");return;}
    if(!window.confirm("Confirmar a alteração coletiva dos acessos temporários de homologação?"))return;
    actionLock.current=true;setBusy(true);setError("");setMessage("");
    try{
      await request("/catalog-test-access","PUT",{enabled,valid_until:enabled&&testUntil?new Date(testUntil).toISOString():null,reason:testReason});
      const current=await request<CatalogTestAccess>("/catalog-test-access");setTestAccess(current);setTestUntil(localDateTimeInput(current.valid_until));
      setMessage(enabled?"Acesso temporário aplicado somente às autorizações de teste; novas ativações receberão a mesma liberação.":"Acesso temporário revogado em lote. Autorizações comerciais foram preservadas.");
    }catch(cause){setError((cause as Error).message);}finally{actionLock.current=false;setBusy(false);}
  };

  if (creating || editing) return <section className="pa-card pa-workshop-form-card">
    <div className="pa-section-title"><div><h2>{creating ? "Cadastrar oficina" : "Editar dados cadastrais"}</h2><p>O cadastro não libera o sistema enquanto o e-mail estiver pendente.</p></div><button type="button" className="pa-quiet" disabled={busy} onClick={cancelEdit}><ArrowLeft size={16}/> Voltar</button></div>
    {error&&<p role="alert" className="pa-note pa-note--error">{error}</p>}
    <form className="pa-workshop-form" onSubmit={save}>
      <fieldset disabled={busy} className="pa-form-fields">
      <label>Nome da oficina<input required minLength={2} maxLength={160} value={fields.name} onChange={e => setField("name",e.target.value)} /></label>
      <label>Responsável<input required minLength={2} maxLength={120} value={fields.responsible_name} onChange={e => setField("responsible_name",e.target.value)} /></label>
      <label>E-mail do responsável<input required type="email" maxLength={254} value={fields.responsible_email} onChange={e => setField("responsible_email",e.target.value)} /></label>
      <label>Telefone ou WhatsApp<input maxLength={40} value={fields.phone} onChange={e => setField("phone",e.target.value)} /></label>
      <label>CPF/CNPJ (opcional)<input maxLength={32} value={fields.document} onChange={e => setField("document",e.target.value)} /></label>
      <p className="pa-workshop-form-note">Nenhum usuário, cliente ou documento operacional é criado nesta etapa. A oficina recebe um identificador de tenant próprio.</p>
      </fieldset><div className="pa-workshop-actions"><button className="pa-primary" disabled={busy}>{busy ? "Salvando…" : "Salvar cadastro"}</button><button type="button" className="pa-quiet" disabled={busy} onClick={cancelEdit}>Cancelar</button></div>
    </form>
  </section>;

  if (selected) return <div className="pa-workshop-detail">
    <section className="pa-card">
      <div className="pa-section-title"><div><button className="pa-back-button" disabled={busy} onClick={() => { if(!confirmAdminNavigation())return;historyRequest.current++;setSelected(null);setReason("");setNextStatus(""); closeManualActivation(); }}><ArrowLeft size={15}/> Voltar à lista</button><h2>{selected.name}</h2></div><span className={`pa-status ${selected.status === "trial" || selected.status === "active" ? "is-active" : ""}`}>{labels[selected.status]}</span></div>

      {message&&<p className="pa-note" role="status">{message}</p>}{error&&<p className="pa-note pa-note--error" role="alert">{error}</p>}
      <div role="tablist" aria-label="Gerenciamento da oficina" className="pa-workshop-tabs">
        {workshopTabs.filter(([key])=>key!=="transfer"||canTransfer).map(([key,label])=><button type="button" role="tab" key={key} id={`workshop-tab-${key}`} aria-controls={`workshop-panel-${key}`} aria-selected={tab===key} tabIndex={tab===key?0:-1} onKeyDown={event=>{const tabs=workshopTabs.filter(([id])=>id!=="transfer"||canTransfer);const i=tabs.findIndex(([id])=>id===key);let target=i;if(event.key==="ArrowRight")target=(i+1)%tabs.length;else if(event.key==="ArrowLeft")target=(i+tabs.length-1)%tabs.length;else if(event.key==="Home")target=0;else if(event.key==="End")target=tabs.length-1;else return;event.preventDefault();setTab(tabs[target][0]);document.getElementById(`workshop-tab-${tabs[target][0]}`)?.focus();}} disabled={busy} onClick={()=>setTab(key)}>{label}</button>)}
      </div>
      <div role="tabpanel" id="workshop-panel-general" aria-labelledby="workshop-tab-general" hidden={tab!=="general"}>      {canManage && selected.source !== "legacy" && <button className="pa-quiet" disabled={busy} onClick={() => { if(!confirmAdminNavigation())return;setFields(toFields(selected)); setEditing(true);setError(""); }}><ShieldCheck size={15}/> Editar dados</button>}
      <dl className="pa-workshop-data"><div><dt>Responsável</dt><dd>{selected.responsible_name || "Não informado"}</dd></div><div><dt>E-mail</dt><dd>{selected.responsible_email || "Não informado"}</dd></div><div><dt>Telefone</dt><dd>{selected.phone || "Não informado"}</dd></div><div><dt>CPF/CNPJ</dt><dd>{selected.document || "Não informado"}</dd></div><div><dt>Origem</dt><dd>{selected.source === "legacy" ? "Cadastro anterior" : "Painel administrativo"}</dd></div><div><dt>Cadastro</dt><dd>{localDate(selected.created_at)}</dd></div><div><dt>Identificador</dt><dd>{selected.tenant_id}</dd></div></dl>
</div>
      <div role="tabpanel" id="workshop-panel-access" aria-labelledby="workshop-tab-access" hidden={tab!=="access"}><PlatformWorkshopEntitlements key={selected.tenant_id} tenantId={selected.tenant_id} canEdit={canManage} onSaved={()=>void loadHistory(selected.tenant_id)} catalogStatus={selected.catalog_access?.status} catalogControls={<>      {canManageModules && selected.catalog_access && <section className="pa-workshop-state-form" aria-labelledby="catalog-access-title">
        <h3 id="catalog-access-title">Disponibilidade e validade do catálogo</h3>
        <p>Situação: <strong>{catalogAccessLabels[selected.catalog_access.status]}</strong></p>
        <dl className="pa-workshop-data"><div><dt>Ativação</dt><dd>{localDate(selected.catalog_access.activated_at)}</dd></div><div><dt>Validade</dt><dd>{localDate(selected.catalog_access.valid_until)}</dd></div><div><dt>Responsável pela última alteração</dt><dd>{selected.catalog_access.updated_by_admin_email || selected.catalog_access.updated_by_admin_id || "Sistema"}</dd></div><div><dt>Última alteração</dt><dd>{localDate(selected.catalog_access.updated_at)}</dd></div><div><dt>Origem</dt><dd>{selected.catalog_access.grant_source === "homologation-test" ? "Teste de homologação" : selected.catalog_access.grant_source === "commercial" ? "Autorização comercial" : "—"}</dd></div></dl>
        {selected.catalog_access.reason && <p>Justificativa: {selected.catalog_access.reason}</p>}
        <label>Validade (deixe vazio para acesso permanente)<input type="datetime-local" value={catalogUntil} onChange={event=>setCatalogUntil(event.target.value)} /></label>
        <label>Justificativa<textarea required minLength={10} maxLength={500} value={catalogReason} onChange={event=>setCatalogReason(event.target.value)} /></label>
        <div className="pa-workshop-actions"><button className="pa-primary" disabled={busy} onClick={()=>void changeCatalogAccess(true)}>{selected.catalog_access.enabled?"Renovar acesso":"Habilitar catálogo"}</button>{selected.catalog_access.enabled&&<button className="pa-quiet" disabled={busy} onClick={()=>void changeCatalogAccess(false)}>Desabilitar catálogo</button>}</div>
      </section>}
</>} />
      <dl className="pa-workshop-data"><div><dt>Início do teste</dt><dd>{localDate(selected.trial_started_at)}</dd></div><div><dt>Fim do teste</dt><dd>{localDate(selected.trial_ends_at)}{selected.trial_days_remaining !== null && selected.trial_days_remaining !== undefined ? ` · ${selected.trial_days_remaining} dia(s) restantes` : ""}</dd></div></dl>
      {selected.status_reason&&<p className="pa-workshop-reason">Justificativa da situação: {selected.status_reason}</p>}
            {canManage && selected.source !== "legacy" && <form className="pa-workshop-state-form" onSubmit={changeStatus}><h3>Situação e acesso</h3><p>Oficinas pendentes precisam concluir a ativação do responsável. Para oficinas verificadas, é possível iniciar ou estender o teste e reativar acesso, sempre com justificativa auditada.</p><label>Nova situação<select required value={nextStatus} onChange={e => {setNextStatus(e.target.value);if(e.target.value!=="trial")setTrialDays("");}}><option value="">Selecione…</option><option value="trial" disabled={!["trial","read_only","blocked"].includes(selected.status)||!selected.email_verified_at}>Teste grátis (14 dias ou prazo informado)</option><option value="active" disabled={!["trial","read_only","blocked"].includes(selected.status)||!selected.email_verified_at}>Ativa / reativar acesso</option><option value="read_only" disabled={!["trial","active","grace_period","blocked"].includes(selected.status)}>Somente leitura</option><option value="blocked" disabled={selected.status==="archived"||selected.status==="blocked"}>Bloqueada</option><option value="archived" disabled={selected.status==="archived"}>Arquivada</option></select></label>{nextStatus==="trial"&&<label>Duração do teste em dias (opcional)<input type="number" min={1} max={90} value={trialDays} onChange={e=>setTrialDays(e.target.value)} placeholder="Usar padrão configurado"/></label>}<label>Justificativa<textarea required minLength={10} maxLength={500} value={reason} onChange={e => setReason(e.target.value)} /></label><button className="pa-quiet" disabled={busy || !nextStatus}>Registrar mudança</button></form>}</div>
      <div role="tabpanel" id="workshop-panel-users" aria-labelledby="workshop-tab-users" hidden={tab!=="users"}><PlatformWorkshopUsers key={selected.tenant_id} tenantId={selected.tenant_id} canEdit={canManage} onSaved={()=>void loadHistory(selected.tenant_id)} primaryOwnerEmail={selected.responsible_email} /></div>
      <div role="tabpanel" id="workshop-panel-invitations" aria-labelledby="workshop-tab-invitations" hidden={tab!=="invitations"}><h3>Ativação e convites</h3><dl className="pa-workshop-data"><div><dt>Convite</dt><dd>{invitationLabels[selected.invitation_status]}{selected.invitation_sent_at ? ` · ${localDate(selected.invitation_sent_at)}` : ""}{selected.invitation_expires_at && selected.invitation_status !== "used" ? ` · expira ${localDate(selected.invitation_expires_at)}` : ""}</dd></div><div><dt>E-mail confirmado</dt><dd>{localDate(selected.email_verified_at)}</dd></div></dl>      {canManage && selected.source === "admin" && selected.status === "pending_verification" && <div className="pa-workshop-actions"><button className="pa-primary pa-invitation-action" disabled={busy} onClick={() => void sendInvitation()}><RefreshCw size={15}/>{selected.invitation_status === "none" ? "Enviar convite" : "Reenviar convite"}</button><button type="button" className="pa-quiet pa-invitation-action" disabled={busy} onClick={() => { setIdentityVerified(false); setVerificationMethod("phone"); setManualActivation({ mode:"confirm" }); setError(""); setMessage(""); }}>Gerar link manual</button></div>}

        {selected.status!=="pending_verification"&&<p>O envio de convite de ativação está disponível para oficinas aguardando confirmação. Os acessos existentes são administrados na aba Usuários.</p>}</div>
      <div role="tabpanel" id="workshop-panel-history" aria-labelledby="workshop-tab-history" hidden={tab!=="history"}>    <section><div className="pa-section-title"><div><h2>Histórico administrativo</h2><p>Eventos imutáveis associados à oficina.</p></div></div><button type="button" className="pa-quiet" disabled={historyLoading} onClick={()=>void loadHistory(selected.tenant_id)}>Atualizar histórico</button>{historyError&&<p role="alert">{historyError}</p>}{historyLoading&&<p role="status">Carregando histórico…</p>}<div className="pa-audit-list">{history.map(event => <article className="pa-audit-event" key={event.id}><span className={`pa-status ${event.result === "success" ? "is-active" : ""}`}>{adminResultLabel(event.result)}</span><div><strong>{adminActionLabel(event.action)}</strong><small>{event.actor_email || "Sistema"} · {localDate(event.created_at)}</small><small>Justificativa: {adminReason(event.technical_context)}</small></div></article>)}{!historyLoading&&!historyError&&history.length === 0 && <p>Nenhuma ação registrada.</p>}</div></section>
</div>
      <div role="tabpanel" id="workshop-panel-transfer" aria-labelledby="workshop-tab-transfer" hidden={tab!=="transfer"}>    {canTransfer && selected && <section><PlatformDataTransfer showHistory={false} onChanged={()=>void loadHistory(selected.tenant_id)} tenantId={selected.tenant_id} workshopName={selected.name} environmentLabel={environmentLabel} canRequestCritical={canRequestCritical} canApproveCritical={canApproveCritical} /></section>}
</div>
    </section>
    {manualActivation && <div
      role="presentation"
      onClick={event => { if (!busy && event.target === event.currentTarget) closeManualActivation(); }}
      style={{ position:"fixed", inset:0, zIndex:1000, display:"grid", placeItems:"center", padding:16, background:"rgba(15,23,42,.55)" }}
    >
      <section
        className="pa-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="manual-activation-title"
        onClick={event => event.stopPropagation()}
        style={{ width:"min(100%, 620px)", maxHeight:"90vh", overflowY:"auto", boxShadow:"0 20px 60px rgba(0,0,0,.25)" }}
      >
        <div className="pa-section-title">
          <div><h2 id="manual-activation-title">{manualActivation.mode === "confirm" ? "Gerar link manual de ativação" : "Link de ativação — exibição única"}</h2></div>
          <button type="button" className="pa-quiet" aria-label="Fechar e apagar o link da tela" disabled={busy} onClick={closeManualActivation}><X size={16}/></button>
        </div>
        {error&&<p role="alert" className="pa-note pa-note--error">{error}</p>}
        {manualActivation.mode === "confirm" ? <>
          <p>Antes de continuar, confirme que verificou fora do sistema a titularidade da oficina e a autorização de quem receberá o link. A pessoa que concluir o fluxo poderá criar o acesso do responsável cadastrado e iniciar o teste grátis.</p>
          <p>O link não será enviado por e-mail. Ele expira em 72 horas e a geração invalida convites anteriores ainda não utilizados.</p>
          <label>Como a titularidade foi verificada?
            <select value={verificationMethod} onChange={event => setVerificationMethod(event.target.value as typeof verificationMethod)}>
              <option value="phone">Contato telefônico</option>
              <option value="in_person">Presencialmente</option>
              <option value="video_call">Chamada de vídeo</option>
              <option value="other">Outro método externo</option>
            </select>
          </label>
          <label style={{ display:"flex", alignItems:"flex-start", gap:10, marginTop:16 }}>
            <input type="checkbox" checked={identityVerified} onChange={event => setIdentityVerified(event.target.checked)} />
            <span>Confirmo que a titularidade e a autorização foram verificadas fora do sistema.</span>
          </label>
          <div className="pa-workshop-actions" style={{ marginTop:18 }}>
            <button type="button" className="pa-primary" disabled={busy || !identityVerified} onClick={() => void generateManualActivationLink()}>{busy ? "Gerando…" : "Confirmar e gerar link"}</button>
            <button type="button" className="pa-quiet" disabled={busy} onClick={closeManualActivation}>Cancelar</button>
          </div>
        </> : <>
          <p>Copie e entregue o link somente à pessoa cuja titularidade foi verificada. Por segurança, ele não será salvo para consulta posterior. Fechar esta janela apaga o link da tela; se necessário, gere outro, o que invalidará este.</p>
          <p>Expira: <strong>{localDate(manualActivation.expiresAt)}</strong></p>
          <label>Link de ativação<input readOnly value={manualActivation.url} onFocus={event => event.currentTarget.select()} /></label>
          <div className="pa-workshop-actions" style={{ marginTop:18 }}>
            <button type="button" className="pa-primary" onClick={() => void copyManualActivationLink()}><Copy size={15}/> Copiar link</button>
            <button type="button" className="pa-quiet" onClick={closeManualActivation}>Fechar e apagar</button>
          </div>
        </>}
      </section>
    </div>}

  </div>;

  return <div className="pa-workshops">
    {canManageModules&&environmentLabel!=="Ambiente local"&&<section className="pa-card"><div className="pa-section-title"><div><h2>Acesso temporário para testes de homologação</h2><p>Concessão controlada no projeto autorizado; a revogação em lote afeta somente registros de teste e novas ativações herdam a validade definida.</p></div><ShieldCheck size={20}/></div>{testAccessUnavailable?<p role="status">Controle coletivo indisponível neste ambiente.</p>:testAccess&&<><p>Situação: <strong>{testAccess.enabled?"Habilitado":"Desabilitado"}</strong>{testAccess.valid_until?` · válido até ${localDate(testAccess.valid_until)}`:""}{testAccess.updated_by_admin_email?` · alterado por ${testAccess.updated_by_admin_email}`:""}</p><label>Válido até<input type="datetime-local" value={testUntil} onChange={event=>setTestUntil(event.target.value)} /></label><label>Justificativa<textarea required minLength={10} maxLength={500} value={testReason} onChange={event=>setTestReason(event.target.value)} /></label><div className="pa-workshop-actions"><button className="pa-primary" disabled={busy} onClick={()=>void changeTestAccess(true)}>Habilitar oficinas para testes</button>{testAccess.enabled&&<button className="pa-quiet" disabled={busy} onClick={()=>void changeTestAccess(false)}>Desabilitar e revogar acessos temporários</button>}</div></>}</section>}
    <section className="pa-card"><div className="pa-section-title"><div><h2>Oficinas cadastradas</h2><p>Os cadastros anteriores permanecem com o acesso atual; nenhuma cobrança ou dado operacional aparece aqui.</p></div><div className="pa-workshop-actions"><button className="pa-quiet" onClick={() => void load(1)}><RefreshCw size={15}/> Atualizar</button>{canManage && <button className="pa-primary" disabled={busy} onClick={() => { setFields(blank); setCreating(true); setMessage(""); setError(""); }}><Plus size={16}/> Cadastrar oficina</button>}</div></div>
      <form className="pa-workshop-filters" onSubmit={event => { event.preventDefault(); void load(1); }}><label><span>Pesquisar</span><div><Search size={15}/><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Nome, identificador, documento ou e-mail" /></div></label><label>Situação<select value={status} onChange={e => setStatus(e.target.value)}><option value="all">Todas</option>{Object.entries(labels).map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select></label><button className="pa-quiet">Buscar</button></form>
      <div className="pa-workshop-list">{items.map(item => <button type="button" className="pa-workshop-row" key={item.tenant_id} disabled={busy} onClick={() => {setTab("general");void openWorkshop(item.tenant_id);}}><span><strong>{item.name}</strong><small>{item.responsible_email || item.document || item.tenant_id}</small></span><span className={`pa-status ${item.status === "trial" || item.status === "active" ? "is-active" : ""}`}>{labels[item.status]}</span><small>{item.source === "admin" ? `${invitationLabels[item.invitation_status]}${item.invitation_expires_at && item.invitation_status !== "used" ? ` · até ${localDate(item.invitation_expires_at)}` : ""}` : item.trial_days_remaining !== null && item.trial_days_remaining !== undefined ? `${item.trial_days_remaining} dia(s)` : "Acesso legado"}</small></button>)}{items.length === 0 && <p className="pa-empty">Nenhuma oficina encontrada.</p>}</div>
      <div className="pa-pagination"><span>{total} oficina(s) · Página {page} de {Math.max(1,Math.ceil(total/20))}</span><div><button className="pa-quiet" disabled={page<=1 || busy} onClick={() => void load(page-1)}><ChevronLeft size={16}/> Anterior</button><button className="pa-quiet" disabled={page*20>=total || busy} onClick={() => void load(page+1)}>Próxima <ChevronRight size={16}/></button></div></div>
    </section>
    {message && <p className="pa-note" role="status">{message}</p>}{error && <p className="pa-note pa-note--error" role="alert">{error}</p>}
  </div>;
}
