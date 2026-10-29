import { useCallback, useEffect, useState } from "react";
import { workshopModuleKeys, workshopModuleLabels, type WorkshopModuleKey, type WorkshopModules } from "../../shared/workshopModules";

type Entitlements = {
  plan_code: string | null;
  plan_configured: boolean;
  plan_module_defaults: Partial<WorkshopModules>;
  module_overrides: Partial<WorkshopModules>;
  modules: WorkshopModules;
  max_users_override: number | null;
  max_users: number | null;
  trial_days_override: number | null;
  trial_days: number;
  user_count: number;
};

async function requestEntitlements<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(`/admin-api${path}`, {
    method,
    credentials: "same-origin",
    ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(value.error || "Não foi possível carregar as permissões.");
  return value as T;
}

export function PlatformWorkshopEntitlements({ tenantId }: { tenantId: string }) {
  const [state, setState] = useState<Entitlements | null>(null);
  const [modules, setModules] = useState<Partial<WorkshopModules>>({});
  const [maxUsers, setMaxUsers] = useState("");
  const [trialDays, setTrialDays] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const value = await requestEntitlements<Entitlements>(`/workshops/${encodeURIComponent(tenantId)}/entitlements`);
      setState(value);
      setModules(value.module_overrides || {});
      setMaxUsers(value.max_users_override == null ? "" : String(value.max_users_override));
      setTrialDays(value.trial_days_override == null ? "" : String(value.trial_days_override));
    } catch (cause) { setError((cause as Error).message); }
  }, [tenantId]);
  useEffect(() => { void load(); }, [load]);

  const toggle = (key: WorkshopModuleKey, enabled: boolean) => {
    setModules(current => ({ ...current, [key]: enabled }));
  };
  const save = async (restore = false) => {
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await requestEntitlements<{ok:boolean;entitlements:Entitlements}>(
        `/workshops/${encodeURIComponent(tenantId)}/entitlements`,
        "PUT",
        {
          module_overrides: restore ? {} : modules,
          max_users: restore || maxUsers.trim() === "" ? null : Number(maxUsers),
          trial_days: restore || trialDays.trim() === "" ? null : Number(trialDays),
          reason,
        },
      );
      setState(result.entitlements);
      setModules(result.entitlements.module_overrides || {});
      setMaxUsers(result.entitlements.max_users_override == null ? "" : String(result.entitlements.max_users_override));
      setTrialDays(result.entitlements.trial_days_override == null ? "" : String(result.entitlements.trial_days_override));
      setReason("");
      setMessage(restore ? "Padrões do plano restaurados e registrados no histórico." : "Permissões e limites salvos e registrados no histórico.");
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  };

  return <section className="pa-workshop-state-form" aria-labelledby="workshop-entitlements-title">
    <h3 id="workshop-entitlements-title">Permissões e limites da oficina</h3>
    <p>As permissões administrativas são individuais e independentes do plano. O Catálogo Técnico mantém seu controle de acesso separado.</p>
    {!state ? <p>Carregando configurações…</p> : <>
      <p>
        Plano: <strong>{state.plan_code || "sem plano associado"}</strong>
        {state.plan_configured ? " · padrões do plano configurados" : " · padrões Básico/Profissional ainda não configurados; mantendo as funcionalidades atuais"}
      </p>
      <p>Usuários existentes: <strong>{state.user_count}</strong>{state.max_users == null ? " · sem limite" : ` · limite efetivo de ${state.max_users}`}</p>
      <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: "12px 0" }}>
        <legend>Funcionalidades habilitadas</legend>
        {workshopModuleKeys.map(key => {
          const enabled = modules[key] ?? state.plan_module_defaults[key] ?? true;
          return <label key={key} style={{ display: "flex", gap: 8, alignItems: "center", margin: "8px 0" }}>
            <input type="checkbox" checked={enabled} onChange={event => toggle(key, event.target.checked)} />
            <span>{workshopModuleLabels[key]}</span>
            {Object.prototype.hasOwnProperty.call(modules,key) && <small>(exceção administrativa)</small>}
          </label>;
        })}
      </fieldset>
      <label>Limite máximo de usuários (vazio: padrão do plano ou sem limite)
        <input type="number" min={1} max={10000} step={1} value={maxUsers} onChange={event => setMaxUsers(event.target.value)} disabled={busy} />
      </label>
      <label>Período de teste em dias (vazio: padrão de 14 dias ou do plano)
        <input type="number" min={1} max={90} step={1} value={trialDays} onChange={event => setTrialDays(event.target.value)} disabled={busy} />
      </label>
      <p>Período efetivo: <strong>{state.trial_days} dias</strong>. Reduzir o limite de usuários não remove contas existentes; impede apenas novas associações acima do limite. Ajustar o teste não muda a situação da oficina.</p>
      <label>Justificativa obrigatória<textarea required minLength={10} maxLength={500} value={reason} onChange={event => setReason(event.target.value)} disabled={busy} /></label>
      <div className="pa-workshop-actions">
        <button type="button" className="pa-primary" disabled={busy || reason.trim().length < 10} onClick={() => void save(false)}>{busy ? "Salvando…" : "Salvar permissões"}</button>
        <button type="button" className="pa-quiet" disabled={busy || reason.trim().length < 10} onClick={() => void save(true)}>Restaurar padrões</button>
        <button type="button" className="pa-quiet" disabled={busy} onClick={() => void load()}>Atualizar</button>
      </div>
    </>}
    {error && <p role="alert" className="pa-error">{error}</p>}
    {message && <p role="status" className="pa-success">{message}</p>}
  </section>;
}
