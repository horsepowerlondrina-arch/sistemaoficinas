import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { workshopModuleKeys, workshopModuleLabels, type WorkshopModules } from "../../shared/workshopModules";
import { adminRequest, localDateInput, optionalWholeNumber, plannedWorkshopPlans } from "../lib/adminPresentation";
import { useAdminDraft } from "../lib/useAdminDraft";

type Entitlements = {
  plate_lookup?: { status: string; configured: boolean };
  plan_code: string | null;
  effective_plan_code: string | null;
  plan_policy_activated_at: string | null;
  trial_active: boolean;
  plan_configured: boolean;
  plan_module_defaults: Partial<WorkshopModules>;
  module_overrides: Partial<WorkshopModules>;
  override_expires_at: Record<string, string>;
  modules: WorkshopModules;
  max_users_override: number | null;
  max_users: number | null;
  trial_days_override: number | null;
  trial_days: number;
  user_count: number;
};

const planLabel = (code: string | null) => plannedWorkshopPlans.find(plan => plan.code === code)?.label || code || "Sem plano";
const localExpiry = (value?: string) => value ? localDateInput(value) : "";

export function PlatformWorkshopEntitlements({ tenantId, canEdit = true, onSaved, catalogStatus, catalogControls }: {
  tenantId: string; canEdit?: boolean; onSaved?: () => void; catalogStatus?: string; catalogControls?: ReactNode;
}) {
  const [state, setState] = useState<Entitlements | null>(null);
  const [plan, setPlan] = useState("basic");
  const [planReason, setPlanReason] = useState("");
  const [modules, setModules] = useState<Partial<WorkshopModules>>({});
  const [maxUsers, setMaxUsers] = useState("");
  const [trialDays, setTrialDays] = useState("");
  const [expiry, setExpiry] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const lock = useRef(false);

  const apply = (value: Entitlements) => {
    setState(value);
    setPlan(value.plan_code || "basic");
    setPlanReason("");
    setModules(value.module_overrides || {});
    setMaxUsers(value.max_users_override == null ? "" : String(value.max_users_override));
    setTrialDays(value.trial_days_override == null ? "" : String(value.trial_days_override));
    setExpiry(Object.fromEntries(Object.entries(value.override_expires_at || {}).map(([key, date]) => [key, localExpiry(date)])));
    setReason("");
  };
  const dirty = !!state && (
    plan !== (state.plan_code || "basic") || !!planReason || !!reason ||
    JSON.stringify(modules) !== JSON.stringify(state.module_overrides || {}) ||
    maxUsers !== (state.max_users_override == null ? "" : String(state.max_users_override)) ||
    trialDays !== (state.trial_days_override == null ? "" : String(state.trial_days_override)) ||
    JSON.stringify(expiry) !== JSON.stringify(Object.fromEntries(Object.entries(state.override_expires_at || {}).map(([key, date]) => [key, localExpiry(date)])))
  );
  useAdminDraft(dirty);
  const load = useCallback(async () => {
    setBusy(true); setError("");
    try { apply(await adminRequest<Entitlements>(`/workshops/${encodeURIComponent(tenantId)}/entitlements`)); }
    catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }, [tenantId]);
  useEffect(() => { void load(); }, [load]);

  const refresh = () => { if (dirty && !window.confirm("Descartar alterações não salvas?")) return; void load(); };
  const savePlan = async () => {
    if (lock.current || !canEdit) return;
    if (planReason.trim().length < 10 || planReason.trim().length > 500) { setError("Informe uma justificativa entre 10 e 500 caracteres."); return; }
    if (!window.confirm(`Aplicar o plano ${planLabel(plan)}? Os dados e usuários atuais serão preservados; novas contas respeitarão o limite.`)) return;
    lock.current = true; setBusy(true); setError(""); setMessage("");
    try {
      const result = await adminRequest<{ entitlements: Entitlements }>(`/workshops/${encodeURIComponent(tenantId)}/plan`, "PUT", { plan_code: plan, reason: planReason.trim() });
      apply(result.entitlements); setMessage("Plano aplicado e registrado na auditoria. Os acessos foram atualizados sem excluir dados."); onSaved?.();
    } catch (cause) { setError((cause as Error).message); }
    finally { lock.current = false; setBusy(false); }
  };
  const saveExceptions = async (restore = false) => {
    if (lock.current || !canEdit) return;
    if (reason.trim().length < 10 || reason.trim().length > 500) { setError("Informe uma justificativa entre 10 e 500 caracteres."); return; }
    if (restore && !window.confirm("Remover as exceções administrativas e restaurar os padrões do plano?")) return;
    lock.current = true; setBusy(true); setError(""); setMessage("");
    try {
      const dates: Record<string, string> = {};
      if (!restore) for (const [key, value] of Object.entries(expiry)) {
        if (!value) continue;
        if (key !== "max_users" && key !== "trial_days" && modules[key as keyof WorkshopModules] === undefined) continue;
        if (key === "max_users" && !maxUsers.trim()) continue;
        if (key === "trial_days" && !trialDays.trim()) continue;
        const date = new Date(value);
        if (!Number.isFinite(date.getTime())) throw new Error("Informe uma data válida para a exceção.");
        dates[key] = date.toISOString();
      }
      const result = await adminRequest<{ entitlements: Entitlements }>(`/workshops/${encodeURIComponent(tenantId)}/entitlements`, "PUT", {
        module_overrides: restore ? {} : modules,
        max_users: restore ? null : optionalWholeNumber(maxUsers, 10000),
        trial_days: restore ? null : optionalWholeNumber(trialDays, 90),
        override_expires_at: dates,
        reason: reason.trim(),
      });
      apply(result.entitlements); setMessage(restore ? "Padrões do plano restaurados e auditados." : "Exceções salvas e auditadas."); onSaved?.();
    } catch (cause) { setError((cause as Error).message); }
    finally { lock.current = false; setBusy(false); }
  };
  const setExpiryFor = (key: string, value: string) => setExpiry(current => ({ ...current, [key]: value }));

  return <section className="pa-workshop-state-form" aria-labelledby="workshop-entitlements-title">
    <h3 id="workshop-entitlements-title">Plano e permissões da oficina</h3>
    {error && <p role="alert" className="pa-note pa-note--error">{error}</p>}
    {message && <p role="status" className="pa-note">{message}</p>}
    {!state ? <><p>{busy ? "Carregando configurações…" : "Configurações indisponíveis."}</p><button type="button" className="pa-quiet" disabled={busy} onClick={() => void load()}>Tentar novamente</button></> : <>
      <p>Plano contratado: <strong>{planLabel(state.plan_code)}</strong>. Acesso aplicado agora: <strong>{planLabel(state.effective_plan_code)}</strong>{state.trial_active ? " (teste grátis)" : ""}.</p>
      {!state.plan_policy_activated_at && state.plan_code && !state.trial_active && <p className="pa-note">O plano legado ainda não aplicou padrões automáticos. Reaplique-o para ativar os novos limites e permissões.</p>}
      {state.trial_active && <p className="pa-note">Durante o período de teste vigente, os recursos do Premium ficam disponíveis, salvo exceções administrativas e integrações não configuradas. Alterar o plano não reinicia o teste.</p>}
      <div className="pa-form-fields">
        <label>Plano comercial<select aria-label="Plano comercial" value={plan} disabled={busy || !canEdit} onChange={event => setPlan(event.target.value)}>{plannedWorkshopPlans.map(item => <option key={item.code} value={item.code}>{item.label} · {item.users} usuários</option>)}</select></label>
        <label className="pa-full-row">Justificativa da alteração do plano<textarea value={planReason} onChange={event => setPlanReason(event.target.value)} minLength={10} maxLength={500} disabled={busy || !canEdit} /></label>
      </div>
      {canEdit && <button type="button" className="pa-primary" disabled={busy || planReason.trim().length < 10} onClick={() => void savePlan()}>{busy ? "Salvando…" : "Aplicar plano"}</button>}
      <details className="pa-plans"><summary>Recursos de cada plano</summary><ul>{plannedWorkshopPlans.map(item => <li key={item.code}><strong>{item.label} · {item.users} usuários</strong>: {item.description}</li>)}</ul></details>
      <div className="pa-permissions-table"><table><thead><tr><th>Funcionalidade</th><th>Padrão aplicado</th><th>Exceção administrativa</th><th>Validade da exceção</th><th>Acesso efetivo</th></tr></thead><tbody>
        {workshopModuleKeys.map(key => <tr key={key}><th scope="row">{workshopModuleLabels[key]}</th>
          <td>{state.plan_module_defaults[key] === undefined ? "Compatibilidade anterior" : state.plan_module_defaults[key] ? "Habilitado" : "Desabilitado"}</td>
          <td><select aria-label={`Exceção: ${workshopModuleLabels[key]}`} disabled={busy || !canEdit} value={modules[key] === undefined ? "inherit" : modules[key] ? "allow" : "deny"} onChange={event => setModules(current => { const next = { ...current }; if (event.target.value === "inherit") delete next[key]; else next[key] = event.target.value === "allow"; return next; })}><option value="inherit">Usar padrão</option><option value="allow">Habilitar</option><option value="deny">Desabilitar</option></select></td>
          <td><input aria-label={`Validade: ${workshopModuleLabels[key]}`} type="datetime-local" disabled={busy || !canEdit || modules[key] === undefined} value={expiry[key] || ""} onChange={event => setExpiryFor(key, event.target.value)} /></td>
          <td>{state.modules[key] === false ? "Bloqueado" : key === "external_plate_lookup" ? (state.plate_lookup?.status === "available" ? "Liberado" : state.plate_lookup?.status === "not_configured" ? "Integração não configurada" : "Não autorizado") : key === "technical_catalog" ? (state.effective_plan_code === "premium" && catalogStatus !== "revoked" ? "Incluído no Premium" : catalogStatus === "active" ? "Liberado" : "Exige autorização do catálogo") : "Liberado"}</td></tr>)}
      </tbody></table></div>
      <p>As exceções prevalecem sobre o plano até a validade indicada; sem validade, permanecem ativas. A consulta de placas exige integração configurada. O catálogo mantém dados, tarifas e bloqueios administrativos existentes.</p>
      <form onSubmit={event => { event.preventDefault(); void saveExceptions(); }} className="pa-workshop-state-form">
        <fieldset disabled={busy || !canEdit} className="pa-form-fields">
          <label>Limite máximo de usuários<input type="number" min={1} max={10000} step={1} value={maxUsers} onChange={event => setMaxUsers(event.target.value)} placeholder="Padrão do plano" /></label>
          <label>Validade do limite<input type="datetime-local" disabled={!maxUsers.trim()} value={expiry.max_users || ""} onChange={event => setExpiryFor("max_users", event.target.value)} /></label>
          <label>Período de teste em dias<input type="number" min={1} max={90} step={1} value={trialDays} onChange={event => setTrialDays(event.target.value)} placeholder="14 dias" /></label>
          <label>Validade do período<input type="datetime-local" disabled={!trialDays.trim()} value={expiry.trial_days || ""} onChange={event => setExpiryFor("trial_days", event.target.value)} /></label>
          <label className="pa-full-row">Justificativa das exceções<textarea required minLength={10} maxLength={500} value={reason} onChange={event => setReason(event.target.value)} /></label>
        </fieldset>
        <p>{state.user_count} usuário(s) vinculado(s); limite efetivo: {state.max_users ?? "sem limite"}. O downgrade preserva usuários e dados; novas contas aguardam uma vaga se o limite for ultrapassado. O teste não é reiniciado por alteração de plano.</p>
        <div className="pa-workshop-actions">{canEdit && <><button className="pa-primary" disabled={busy}>{busy ? "Salvando…" : "Salvar exceções"}</button><button type="button" className="pa-quiet" disabled={busy || reason.trim().length < 10} onClick={() => void saveExceptions(true)}>Restaurar padrões do plano</button></>}<button type="button" className="pa-quiet" disabled={busy} onClick={refresh}>Atualizar permissões</button>{dirty && <button type="button" className="pa-quiet" disabled={busy} onClick={() => { if (window.confirm("Descartar alterações de permissões?")) apply(state); }}>Cancelar alterações</button>}</div>
      </form>
    </>}
    {catalogControls}
  </section>;
}
