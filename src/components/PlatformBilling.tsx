import { useEffect, useState } from "react";
import { adminRequest, plannedWorkshopPlans } from "../lib/adminPresentation";
import { useAdminDraft } from "../lib/useAdminDraft";

type Price = { plan_code: string; monthly_price_cents: number | null; currency_code: string; price_version: number; updated_at: string };
const formatMoney = (cents: number | null) => cents == null ? "Não definido" : (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
function parseReais(value: string): number | null {
  if (!/^\d{1,7}(,\d{1,2})?$/.test(value.trim())) return null;
  const [whole, fraction = ""] = value.trim().split(",");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

export function PlatformBilling() {
  const [prices, setPrices] = useState<Price[]>([]);
  const [values, setValues] = useState<Record<string,string>>({});
  const [reasons, setReasons] = useState<Record<string,string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const dirty = Object.values(values).some(Boolean) || Object.values(reasons).some(Boolean);
  useAdminDraft(dirty);

  const load = async () => {
    const result = await adminRequest<{ prices: Price[] }>("/billing/prices");
    setPrices(result.prices); setValues({}); setReasons({});
  };
  useEffect(() => { void load().catch(e => setError(e.message)); }, []);

  const save = async (price: Price) => {
    const cents = parseReais(values[price.plan_code] || "");
    const reason = reasons[price.plan_code]?.trim() || "";
    if (cents == null || cents <= 0 || reason.length < 10) {
      setError("Informe valor mensal válido e justificativa com pelo menos 10 caracteres."); return;
    }
    setBusy(true); setError(""); setMessage("");
    try {
      await adminRequest(`/billing/prices/${price.plan_code}`, "PUT", {
        monthly_price_cents: cents, expected_version: price.price_version, reason,
      });
      await load();
      setMessage("Preço salvo. Assinaturas existentes mantêm o valor contratado.");
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  return <section className="pa-card">
    <div className="pa-section-title"><div><h2>Preços mensais dos planos</h2>
      <p>Defina valores em reais. A alteração vale somente para novas assinaturas; nenhuma cobrança é emitida ao salvar.</p></div>
      <button className="pa-quiet" disabled={busy} onClick={() => void load().catch(e => setError(e.message))}>Atualizar</button></div>
    {error && <p className="pa-note pa-note--error" role="alert">{error}</p>}
    {message && <p className="pa-note" role="status">{message}</p>}
    <div className="pa-grid">{plannedWorkshopPlans.map(plan => {
      const price = prices.find(item => item.plan_code === plan.code);
      return <article className="pa-card" key={plan.code}>
        <h3>{plan.label}</h3><p>{plan.description}</p>
        <p>Preço atual: <strong>{formatMoney(price?.monthly_price_cents ?? null)}</strong></p>
        <label>Valor mensal (R$)<input inputMode="decimal" value={values[plan.code] || ""}
          placeholder="Ex.: 99,90" onChange={event => setValues({ ...values, [plan.code]: event.target.value })}/></label>
        <label>Justificativa<input value={reasons[plan.code] || ""} maxLength={500}
          onChange={event => setReasons({ ...reasons, [plan.code]: event.target.value })}/></label>
        <button className="pa-primary" disabled={busy || !price} onClick={() => price && void save(price)}>Salvar preço</button>
      </article>;
    })}</div>
    <p className="pa-footnote">Cartão poderá ter cobrança recorrente. Pix exigirá pagamento do cliente a cada mês. A cobrança permanece desativada até concluir a integração segura.</p>
  </section>;
}
