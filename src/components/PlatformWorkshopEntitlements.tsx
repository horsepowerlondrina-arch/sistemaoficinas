import { useCallback, useEffect, useRef, useState } from "react";
import { adminRequest, plannedWorkshopPlans } from "../lib/adminPresentation";
import { useAdminDraft } from "../lib/useAdminDraft";

type AccessChoice = "" | "none" | "basic" | "professional" | "premium";
type Entitlements = {
  plan_code: string | null;
  effective_plan_code: string | null;
  plan_policy_activated_at: string | null;
  trial_active: boolean;
  max_users: number | null;
  user_count: number;
};
const planLabel = (code: string | null) =>
  plannedWorkshopPlans.find(plan => plan.code === code)?.label || "Nenhum plano";

function selectedAccess(status: string, state: Entitlements): AccessChoice {
  if (status === "read_only" || status === "blocked") return "none";
  return state.plan_code === "basic" || state.plan_code === "professional" || state.plan_code === "premium"
    ? state.plan_code : "";
}

export function PlatformWorkshopEntitlements({ tenantId, status, canEdit = true, onSaved }: {
  tenantId: string;
  status: string;
  canEdit?: boolean;
  onSaved?: () => void;
}) {
  const [state, setState] = useState<Entitlements | null>(null);
  const [currentStatus, setCurrentStatus] = useState(status);
  const [access, setAccess] = useState<AccessChoice>("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const lock = useRef(false);

  const apply = (value: Entitlements, workshopStatus: string) => {
    setState(value);
    setCurrentStatus(workshopStatus);
    setAccess(selectedAccess(workshopStatus, value));
    setReason("");
  };
  const load = useCallback(async () => {
    setBusy(true); setError("");
    try {
      const value = await adminRequest<Entitlements>(`/workshops/${encodeURIComponent(tenantId)}/entitlements`);
      apply(value, status);
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }, [tenantId, status]);
  useEffect(() => { void load(); }, [load]);

  const original = state ? selectedAccess(currentStatus, state) : "";
  const changed = !!state && access !== "" && (access !== original || (access !== "none" && !state.plan_policy_activated_at));
  const dirty = changed || !!reason;
  useAdminDraft(dirty);
  const save = async () => {
    if (lock.current || !canEdit || !changed || reason.trim().length < 10 || reason.trim().length > 500) return;
    if (access === "none" && !window.confirm("Colocar esta oficina em somente leitura? Os dados e usuários serão preservados.")) return;
    lock.current = true; setBusy(true); setError(""); setMessage("");
    try {
      const result = await adminRequest<{ status: string; entitlements: Entitlements }>(
        `/workshops/${encodeURIComponent(tenantId)}/access`, "PUT",
        { access, reason: reason.trim() },
      );
      apply(result.entitlements, result.status);
      setMessage(access === "none"
        ? "Oficina em somente leitura. A alteração foi registrada no histórico."
        : "Plano aplicado. Os acessos padrão foram atualizados e registrados no histórico.");
      onSaved?.();
    } catch (cause) { setError((cause as Error).message); }
    finally { lock.current = false; setBusy(false); }
  };

  return <section className="pa-workshop-state-form" aria-labelledby="workshop-entitlements-title">
    <h3 id="workshop-entitlements-title">Plano e acesso da oficina</h3>
    {error && <p role="alert" className="pa-note pa-note--error">{error}</p>}
    {message && <p role="status" className="pa-note">{message}</p>}
    {!state ? <><p>{busy ? "Carregando acesso…" : "Acesso indisponível."}</p><button type="button" className="pa-quiet" disabled={busy} onClick={() => void load()}>Tentar novamente</button></> : <>
      <p>Situação atual: <strong>{currentStatus === "read_only" ? "Somente leitura" : currentStatus === "trial" ? "Teste gratuito" : currentStatus === "active" ? "Acesso ativo" : "Acesso bloqueado"}</strong>. Plano registrado: <strong>{planLabel(state.plan_code)}</strong>.</p>
      {state.trial_active && <p className="pa-note">O teste gratuito usa os recursos Premium. Escolher um plano encerra o teste ativo sem apagar seu histórico nem iniciar outro.</p>}
      {!state.plan_policy_activated_at && state.plan_code && <p className="pa-note">Este plano foi registrado antes da aplicação automática dos pacotes. Selecione-o e salve para aplicar seus recursos.</p>}
      <div className="pa-form-fields">
        <label>Acesso da oficina
          <select aria-label="Acesso da oficina" value={access} disabled={busy || !canEdit || currentStatus === "pending_verification" || currentStatus === "archived" || currentStatus === "legacy"}
            onChange={event => { setAccess(event.target.value as AccessChoice); setMessage(""); }}>
            <option value="" disabled>Selecione um acesso</option>
            <option value="none">Sem acesso · somente leitura</option>
            {plannedWorkshopPlans.map(item => <option key={item.code} value={item.code}>{item.label} · até {item.users} usuários</option>)}
          </select>
        </label>
        <label className="pa-full-row">Justificativa
          <textarea value={reason} onChange={event => setReason(event.target.value)} minLength={10} maxLength={500} disabled={busy || !canEdit} />
        </label>
      </div>
      <p>Sem acesso mantém os dados para consulta e impede alterações. Um plano aplica todos os recursos e o limite de usuários do pacote. Integrações externas também dependem de configuração do provedor.</p>
      <p>{state.user_count} usuário(s) vinculado(s); limite atual: {state.max_users ?? "sem limite"}. Reduzir o plano preserva usuários e dados existentes.</p>
      <div className="pa-workshop-actions">
        {canEdit && <button type="button" className="pa-primary" disabled={busy || !changed || reason.trim().length < 10} onClick={() => void save()}>{busy ? "Salvando…" : "Registrar acesso"}</button>}
        <button type="button" className="pa-quiet" disabled={busy} onClick={() => { if (dirty && !window.confirm("Descartar alterações não salvas?")) return; void load(); }}>Atualizar</button>
      </div>
      <details className="pa-plans"><summary>O que está incluído em cada plano</summary><ul>{plannedWorkshopPlans.map(item => <li key={item.code}><strong>{item.label} · {item.users} usuários</strong>: {item.description}</li>)}</ul></details>
    </>}
  </section>;
}
