import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { PlatformBrand } from "../components/PlatformBrand";
import { billingPlanNames, billingPlans } from "../../shared/stripeBilling";

export function RegisterWorkshop() {
  const [enabled, setEnabled] = useState(false), [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [error, setError] = useState("");
  useEffect(() => { void fetch("/admin-api/workshop-registration").then(r => r.json()).then(v => setEnabled(v.enabled === true)).catch(() => {}).finally(() => setLoading(false)); }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return;
    const form = new FormData(event.currentTarget);
    setBusy(true); setError("");
    try {
      const response = await fetch("/admin-api/workshop-registration", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        workshop: Object.fromEntries(["name", "responsible_name", "responsible_email", "phone", "document"].map(k => [k, String(form.get(k) || "")])),
        plan_code: form.get("plan_code"),
      }) });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error || "Não foi possível concluir o cadastro.");
      setMessage(value.message);
    } catch (cause) { setError((cause as Error).message); } finally { setBusy(false); }
  }
  return <main className="activation-page"><section className="activation-card" aria-label="Cadastro da oficina">
    <PlatformBrand /><h1>Criar minha oficina</h1>
    {loading ? <p role="status">Carregando…</p> : !enabled ? <p>O cadastro de oficinas ainda não está disponível.</p> : message ? <p role="status">{message}</p> : <>
      <p>Confirme seu e-mail para ativar a oficina. Depois, confira os valores e contrate pelo seu acesso Master.</p>
      <form onSubmit={submit}>
        <label>Nome da oficina<input name="name" required minLength={2} maxLength={160} disabled={busy}/></label>
        <label>Nome do responsável<input name="responsible_name" required minLength={2} maxLength={120} disabled={busy}/></label>
        <label>E-mail do responsável<input name="responsible_email" type="email" required maxLength={254} disabled={busy}/></label>
        <label>Telefone<input name="phone" type="tel" maxLength={40} disabled={busy}/></label>
        <label>CPF ou CNPJ (opcional)<input name="document" maxLength={32} disabled={busy}/></label>
        <label>Plano inicial<select name="plan_code" disabled={busy}>{billingPlans.map(p => <option key={p} value={p}>{billingPlanNames[p]}</option>)}</select></label>
        {error && <p role="alert">{error}</p>}
        <button className="button primary" disabled={busy}>{busy ? "Enviando…" : "Receber ativação por e-mail"}</button>
      </form>
    </>}
    <Link to="/inicio">Já tenho uma conta</Link>
  </section></main>;
}
