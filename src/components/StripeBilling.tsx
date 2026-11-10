import "./stripe-billing.css";
import { useEffect,useState } from "react";
import { api,send } from "../lib/api";
import { checkoutUrl,workshopBillingAction } from "../lib/billingDisplay";
import { adminRequest } from "../lib/adminPresentation";
import { useAdminDraft } from "../lib/useAdminDraft";
import { billingDate,billingPlanNames,billingPlans,type BillingSummary,type BillingOverview,type BillingPlan } from "../../shared/stripeBilling";
const money=(cents:number)=>new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(cents/100);
const date=(day:string|null)=>day?day.split("-").reverse().join("/"):"—";
type PlanSummary={plan_code:string|null;status:string|null;trial_ends_at:string|null}|null;
const planLabels:Record<string,string>={basic:"Básico",professional:"Profissional",premium:"Premium"};
const statusLabels:Record<string,string>={active:"Ativo",trial:"Em teste",blocked:"Bloqueado",canceled:"Cancelado"};
let pendingRefresh:{tenant:string;request:Promise<BillingSummary>}|null=null;
function refreshBilling(tenant:string){
 if(pendingRefresh?.tenant===tenant)return pendingRefresh.request;
 const request=send("/account/billing/refresh",{}) as Promise<BillingSummary>;
 pendingRefresh={tenant,request};
 void request.finally(()=>{if(pendingRefresh?.request===request)pendingRefresh=null;}).catch(()=>{});
 return request;
}
export function WorkshopBilling({tenantId}:{tenantId:string}){
 const [data,setData]=useState<BillingSummary|null>(null),[plan,setPlan]=useState<PlanSummary>(null);
 const [error,setError]=useState(""),[planError,setPlanError]=useState(""),[busy,setBusy]=useState(false),[syncing,setSyncing]=useState(false),[syncError,setSyncError]=useState("");
 const [method,setMethod]=useState<"card"|"pix">("card"),[confirmed,setConfirmed]=useState(false),[cancelConfirmed,setCancelConfirmed]=useState(false);
 const [choosing,setChoosing]=useState(false),[priceId,setPriceId]=useState("");
 useEffect(()=>{
  let active=true;
  setChoosing(false);setPriceId("");setConfirmed(false);setData(null);setPlan(null);setError("");setPlanError("");setSyncError("");setSyncing(false);
  api<{plan:PlanSummary}>("/account/plan").then(v=>{if(active)setPlan(v.plan);}).catch(()=>{if(active)setPlanError("Não foi possível consultar o plano agora.");});
  api<BillingSummary>("/account/billing").then(async v=>{
   if(!active)return;
   setData(v);
   if(!v.enabled)return;
   setSyncing(true);
   try{const current=await refreshBilling(tenantId);if(active)setData(current);}
   catch{if(active)setSyncError("Não foi possível conferir o pagamento agora. Os dados abaixo são da última situação registrada.");}
   finally{if(active)setSyncing(false);}
  }).catch(e=>{if(active)setError((e as Error).message);});
  return()=>{active=false;};
 },[tenantId]);
 async function act(action:()=>Promise<void>){if(busy)return;setBusy(true);setError("");try{await action();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 const account=data?.account;
 const currentPlan=account?billingPlanNames[account.plan_code]:plan?.plan_code?planLabels[plan.plan_code]??plan.plan_code:"Nenhum plano contratado";
 const trialActive=plan?.status==="trial"&&!!plan.trial_ends_at&&new Date(plan.trial_ends_at).getTime()>Date.now();
 const today=billingDate(new Date());
 const periodPaid=!!account?.paid_until&&account.paid_until>today;
 const action=data?.enabled?workshopBillingAction(data,trialActive,today):null;
 const status=data?.read_only?"Somente leitura":data?.pending?"Pagamento pendente":trialActive?"Em teste":account?.managed?"Em dia":plan?.status?statusLabels[plan.status]??plan.status:"Sem assinatura";
 const actionReady=!syncing&&!syncError;
 return <div className="billing-workshop">
  <div className="billing-heading"><h2>Assinatura e pagamentos</h2><p>Plano, vencimento e pagamentos da oficina.</p></div>
  {data?.test_mode&&<p className="billing-test-note">Ambiente de teste · pagamentos fictícios</p>}
  {error&&<p role="alert" className="error-box">{error}</p>}
  {planError&&<p role="alert" className="error-box">{planError}</p>}
  {!data&&!error&&<p role="status">Carregando assinatura…</p>}
  {data&&!data.enabled&&<section className="panel settings-card"><h3>Plano atual: {currentPlan}</h3><p>A cobrança está desabilitada neste ambiente.</p></section>}
  {data?.enabled&&<>
   <div className="billing-summary-grid">
    <section className="panel settings-card billing-summary-card">
     <div className="billing-summary-top"><div><span className="billing-label">Plano atual</span><strong className="billing-value">{currentPlan}</strong></div><span className="billing-status">{syncing?"Conferindo":syncError?"Último registro: "+status:status}</span></div>
     <p>{account?(account.method==="card"?"Cartão · renovação mensal automática":"Pix mensal"):"Escolha um plano para começar."}</p>
     {plan?.status==="trial"&&plan.trial_ends_at&&<p>Teste até {new Date(plan.trial_ends_at).toLocaleDateString("pt-BR")}</p>}
     {account?.cancel_at_period_end&&<p>Renovação cancelada. O período já pago será preservado.</p>}
    </section>
    <section className="panel settings-card billing-summary-card">
     <span className="billing-label">Próximo vencimento</span><strong className="billing-value">{date(account?.due_on??null)}</strong>
     <p>{account?.paid_until?"Cobertura paga até "+date(account.paid_until)+".":"Nenhum período pago registrado."}</p>
     {data.read_only&&<p>Mensalidade vencida: acesso somente leitura. Seus dados permanecem disponíveis.</p>}
    </section>
   </div>
   <section className="panel settings-card billing-section">
    <h3>{action?.kind==="success"?"Sua assinatura":"Próxima ação"}</h3>
    {syncing?<p role="status">Conferindo a situação do pagamento…</p>:syncError?<p role="alert">{syncError}</p>:<p className="billing-sync-note">Situação conferida automaticamente ao abrir esta aba.</p>}
    {actionReady&&action?.kind==="link"&&<a className="button primary" href={action.url}>{action.label}</a>}
    {actionReady&&action?.kind==="unavailable"&&<p role="status">{action.message}</p>}
    {actionReady&&action?.kind==="success"&&<p className="billing-success" role="status">Tudo certo com o seu Plano!</p>}
    {actionReady&&action?.kind==="choose"&&<div>
     <button type="button" className="button primary" aria-expanded={choosing} disabled={busy} onClick={()=>{setChoosing(!choosing);setConfirmed(false);setPriceId("");}}>{choosing?"Voltar":action.label}</button>
     {choosing&&<div className="billing-chooser">
      <label>Plano mensal<select value={priceId} disabled={busy} onChange={e=>{setPriceId(e.target.value);setConfirmed(false);}}>
       <option value="">Selecione o plano</option>
       {data.prices.map(p=><option key={p.id} value={p.id}>{billingPlanNames[p.plan_code]} — {money(p.amount_cents)} / mês</option>)}
      </select></label>
      <label>Forma de pagamento<select value={method} disabled={busy} onChange={e=>{setMethod(e.target.value as "card"|"pix");setConfirmed(false);}}><option value="card">Cartão — renovação mensal automática</option><option value="pix">Pix — confirmar pagamento todo mês</option></select></label>
      <label className="billing-check"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/> Li os valores e autorizo {method==="card"?"a renovação mensal no cartão":"a criação das mensalidades Pix, que pagarei a cada mês"}.</label>
      <button type="button" className="button" disabled={busy||!confirmed||!data.prices.some(p=>p.id===priceId)} onClick={()=>void act(async()=>{
       const result=await send("/account/billing/checkout",{price_id:priceId,method}) as {url:string};
       const target=checkoutUrl(result.url);if(!target)throw new Error("Endereço de pagamento inválido.");
       window.location.assign(target);
      })}>Continuar no Stripe</button>
     </div>}
    </div>}
    {periodPaid&&account?.method==="pix"&&<p>A próxima mensalidade poderá ser paga quando terminar o período atual.</p>}
    <p className="billing-policy">O teste gratuito não será reiniciado. Sem pagamento confirmado, o acesso fica somente leitura no dia seguinte ao vencimento, sem excluir dados.</p>
   </section>
   <section className="panel settings-card billing-section">
    <h3>Pagamentos confirmados</h3>
    {data.payments.length?data.payments.map(p=><p key={p.provider_id}>{money(p.amount_cents)} · {date(p.period_start)} a {date(p.period_end)} · {p.status==="paid"?"Confirmado":"Revertido / em disputa"}</p>):<p>Nenhum pagamento confirmado.</p>}
   </section>
   {account&&(account.managed||account.recurring)&&!account.cancel_at_period_end&&<section className="panel settings-card billing-section">
    <h3>Cancelar renovação</h3><p>Você mantém seus dados e o período pago. Para mudar de plano, cancele a renovação e contrate o novo pacote após o período vigente.</p>
    <label className="billing-check"><input type="checkbox" checked={cancelConfirmed} onChange={e=>setCancelConfirmed(e.target.checked)}/> Confirmo o cancelamento das próximas renovações.</label>
    <button type="button" className="button" disabled={busy||!cancelConfirmed} onClick={()=>void act(async()=>{setData(await send("/account/billing/cancel",{confirm:true}));setCancelConfirmed(false);})}>Cancelar renovação</button>
   </section>}
  </>}
 </div>;
}
export function AdminBilling(){
 const [data,setData]=useState<BillingOverview|null>(null),[error,setError]=useState(""),[message,setMessage]=useState(""),[busy,setBusy]=useState(false);
 const [plan,setPlan]=useState<BillingPlan>("basic"),[amount,setAmount]=useState(""),[reason,setReason]=useState("");
 useAdminDraft(Boolean(amount||reason));
 const load=()=>adminRequest<BillingOverview>("/billing").then(setData);
 useEffect(()=>{let active=true;adminRequest<BillingOverview>("/billing").then(v=>{if(active)setData(v);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[]);
 return <div className="billing-admin-grid"><section className="pa-card billing-section"><h2>Preços mensais</h2><p>Stripe em teste. Alterações valem para novas contratações. Os preços dos contratos existentes são preservados.</p>
  {error&&<p role="alert" className="error-box">{error}</p>}{message&&<p role="status">{message}</p>}
  {data?.prices.map(p=><p key={p.id}>{billingPlanNames[p.plan_code]}: {money(p.amount_cents)} / mês</p>)}
  <form className="pa-form" onSubmit={async e=>{e.preventDefault();if(busy)return;setError("");setMessage("");
   if(!/^\d+([.,]\d{1,2})?$/.test(amount)){setError("Informe um valor em reais, com até duas casas decimais.");return;}
   const [whole,fraction=""]=amount.replace(",",".").split(".");const cents=Number(whole)*100+Number(fraction.padEnd(2,"0"));
   if(!Number.isSafeInteger(cents)||cents<50){setError("O valor mínimo é R$ 0,50.");return;}
   setBusy(true);try{await adminRequest("/billing/prices","POST",{plan_code:plan,amount_cents:cents,reason});setAmount("");setReason("");setMessage("Novo preço registrado com auditoria.");await load();}catch(err){setError((err as Error).message);}finally{setBusy(false);}
  }}>
   <label>Plano<select value={plan} onChange={e=>setPlan(e.target.value as BillingPlan)}>{billingPlans.map(p=><option key={p} value={p}>{billingPlanNames[p]}</option>)}</select></label>
   <label>Mensalidade em reais<input required inputMode="decimal" value={amount} onChange={e=>setAmount(e.target.value)}/></label>
   <label>Justificativa<textarea required minLength={10} maxLength={500} value={reason} onChange={e=>setReason(e.target.value)}/></label>
   <button className="pa-primary" disabled={busy||!data?.enabled}>{busy?"Salvando…":"Salvar novo preço"}</button>
  </form></section><section className="pa-card billing-section"><h2>Assinaturas e cobranças</h2><button className="pa-quiet" disabled={busy} onClick={()=>void load().catch(e=>setError(e.message))}>Atualizar</button>
   {data?.accounts.map(a=><article key={a.tenant_id} className="pa-account"><strong>{a.name}</strong><p>{billingPlanNames[a.plan_code]} · {a.method==="card"?"Cartão":"Pix"}</p><p>Pago até {date(a.paid_until)} · vence {date(a.due_on)}</p><p>{a.managed?"Contrato iniciado":"Aguardando primeiro pagamento"}{a.cancel_at_period_end?" · renovação cancelada":""}</p></article>)}
   {data&&!data.accounts.length&&<p>Nenhuma assinatura de teste criada.</p>}
  </section></div>;
}
