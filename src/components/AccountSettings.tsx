import { useEffect, useState, type FormEvent } from "react";
import { ShieldCheck } from "lucide-react";
import { useApp } from "../lib/context";
import { api, send } from "../lib/api";

type BillingOffer = { plan: string; monthlyPriceCents: number; currency: "BRL"; status: string };
type PlanSummary = { plan_code: string | null; status: string | null; trial_ends_at: string | null } | null;
const planLabel: Record<string,string> = { basic:"Básico", professional:"Profissional", premium:"Premium" };
const statusLabel: Record<string,string> = { active:"Ativo", trial:"Período de teste", blocked:"Bloqueado", canceled:"Cancelado" };

export function AccountSettings() {
  const { session } = useApp();
  const [plan,setPlan] = useState<PlanSummary>(null);
  const [loading,setLoading] = useState(true);
  const [offer,setOffer] = useState<BillingOffer|null>(null);
  const [accepted,setAccepted] = useState(false);
  const [checkoutBusy,setCheckoutBusy] = useState(false);
  const [checkoutError,setCheckoutError] = useState("");
  const [planError,setPlanError] = useState("");
  const [passwordBusy,setPasswordBusy] = useState(false);
  const [passwordMessage,setPasswordMessage] = useState("");
  const [passwordError,setPasswordError] = useState("");
  useEffect(() => {
    let active = true;
    setLoading(true);setPlanError("");setPlan(null);
    api<{plan:PlanSummary}>("/account/plan").then(result => {if(active)setPlan(result.plan);})
      .catch(() => {if(active)setPlanError("Não foi possível consultar o plano agora.");})
      .finally(() => {if(active)setLoading(false);});
    api<{offer:BillingOffer|null}>("/account/billing/offer")
      .then(result => { if(active)setOffer(result.offer); })
      .catch(() => { if(active)setOffer(null); });
    return () => {active=false;};
  },[session.tenant.id]);
  async function startCheckout() {
    if (!offer || !accepted || checkoutBusy) return;
    setCheckoutBusy(true);setCheckoutError("");
    try {
      const result = await send("/account/billing/checkout", {
        confirm_contract:true, expected_price_cents:offer.monthlyPriceCents,
      }) as { checkout_url:string };
      const destination = new URL(result.checkout_url);
      if (destination.protocol !== "https:" || !/(^|\.)mercadopago\.com(\.br)?$/.test(destination.hostname))
        throw new Error("O provedor retornou um endereço inválido.");
      window.location.assign(destination.toString());
    } catch(e) { setCheckoutError((e as Error).message);setCheckoutBusy(false); }
  }
  async function requestPasswordChange(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();if(passwordBusy)return;
    setPasswordBusy(true);setPasswordError("");setPasswordMessage("");
    try {
      await send("/password-reset/request",{email:session.user.email});
      setPasswordMessage("Se este e-mail tem acesso à oficina, enviaremos um link válido por 30 minutos. Após alterar a senha, entre novamente.");
    } catch(e) {setPasswordError((e as Error).message);}
    finally {setPasswordBusy(false);}
  }
  return <>
    <section className="panel settings-card">
      <ShieldCheck size={23}/><h2>Administrador da conta</h2>
      <p><strong>{session.user.name}</strong> · Administrador</p>
      <p>{session.user.email}</p>
      <p>Usuários, permissões de módulos e situação de acesso da oficina são administrados pelo painel central. Solicite alterações ao responsável pela plataforma.</p>
    </section>
    <section className="panel settings-card">
      <h2>Alterar senha</h2>
      <p>Enviaremos um link de redefinição para o e-mail do administrador acima. O link expira em 30 minutos e funciona uma única vez.</p>
      <form onSubmit={requestPasswordChange}>
        <button className="button" type="submit" disabled={passwordBusy}>{passwordBusy?"Enviando…":"Enviar link para alterar senha"}</button>
      </form>
      {passwordMessage&&<p role="status">{passwordMessage}</p>}
      {passwordError&&<p role="alert" className="error-box">{passwordError}</p>}
    </section>
    <section className="panel settings-card">
      <h2>Plano da oficina</h2>
      {loading?<p>Carregando plano…</p>:planError?<p role="alert">{planError}</p>:plan?
        <><p><strong>{plan.plan_code ? planLabel[plan.plan_code]??plan.plan_code : "Nenhum plano contratado"}</strong></p>
        <p>Situação: {plan.status ? statusLabel[plan.status]??plan.status : "Não informada"}</p>
        {plan.status==="trial"&&plan.trial_ends_at&&<p>Teste até {new Date(plan.trial_ends_at).toLocaleDateString("pt-BR")}</p>}</>
        :<p>Plano ainda não atribuído pela administração central.</p>}
      {offer ? <>
        <p>Mensalidade: <strong>{(offer.monthlyPriceCents/100).toLocaleString("pt-BR",{style:"currency",currency:"BRL"})}</strong> por mês.</p>
        <label><input type="checkbox" checked={accepted} onChange={event=>setAccepted(event.target.checked)}/>
          Confirmo que conheço o valor mensal e quero continuar no checkout seguro do Mercado Pago.
        </label>
        <div className="form-actions">
          <button className="button" type="button" disabled={!accepted||checkoutBusy} onClick={()=>void startCheckout()}>
            {checkoutBusy?"Preparando pagamento…":"Continuar para o pagamento"}
          </button>
        </div>
        {checkoutError&&<p role="alert" className="error-box">{checkoutError}</p>}
        <p className="muted">Cartão pode cobrar automaticamente a cada mês. Pix exige pagamento pelo cliente a cada mês. O acesso só muda após confirmação do provedor.</p>
      </> : <p className="muted">A contratação online ainda não está disponível. Seu acesso atual permanece preservado.</p>}
    </section>
  </>;
}
