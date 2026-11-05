import { useEffect,useState } from "react";
import { api,send } from "../lib/api";
import { adminRequest } from "../lib/adminPresentation";
import { useAdminDraft } from "../lib/useAdminDraft";
import { billingPlanNames,billingPlans,type BillingSummary,type BillingOverview,type BillingPlan } from "../../shared/stripeBilling";
const money=(cents:number)=>new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(cents/100);
const date=(day:string|null)=>day?day.split("-").reverse().join("/"):"—";
export function WorkshopBilling({tenantId}:{tenantId:string}){
 const [data,setData]=useState<BillingSummary|null>(null),[error,setError]=useState(""),[busy,setBusy]=useState(false);
 const [method,setMethod]=useState<"card"|"pix">("card"),[confirmed,setConfirmed]=useState(false),[cancelConfirmed,setCancelConfirmed]=useState(false);
 useEffect(()=>{let active=true;setData(null);setError("");api<BillingSummary>("/account/billing").then(v=>{if(active)setData(v);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[tenantId]);
 async function act(action:()=>Promise<void>){if(busy)return;setBusy(true);setError("");try{await action();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <section className="panel settings-card">
  <h2>Assinatura e pagamentos</h2>
  {error&&<p role="alert" className="error-box">{error}</p>}
  {data&&!data.enabled&&<p>A cobrança está desabilitada neste ambiente.</p>}
  {data?.enabled&&<>
   <p>Ambiente de teste Stripe. Use somente dados e cartões de teste; não faça pagamentos reais.</p>
   {data.account&&<div><p>Plano contratado: <strong>{billingPlanNames[data.account.plan_code]}</strong> · {data.account.method==="card"?"Cartão recorrente":"Pix mensal"}</p>
    <p>Pago até: {date(data.account.paid_until)} · Vencimento: {date(data.account.due_on)}</p>
    <p>{data.read_only?"Mensalidade vencida: acesso somente leitura.":"O acesso também respeita a situação definida pela administração."}</p>
    {data.account.cancel_at_period_end&&<p>Renovação cancelada. O período já pago será preservado.</p>}
   </div>}
   <button type="button" className="button" disabled={busy} onClick={()=>void act(async()=>{setData(await send("/account/billing/refresh",{}));})}>{busy?"Aguarde…":"Atualizar situação do pagamento"}</button>
   {data.pending&&<p><a className="button" href={data.pending.url.startsWith("https://checkout.stripe.com/")?data.pending.url:undefined}>Abrir pagamento pendente</a></p>}
   <p>O teste gratuito não será reiniciado. Contrate ao final do teste. Sem pagamento confirmado, o acesso fica somente leitura no dia seguinte ao vencimento, sem excluir dados.</p>
   <label>Forma de pagamento<select value={method} disabled={busy} onChange={e=>{setMethod(e.target.value as "card"|"pix");setConfirmed(false);}}><option value="card">Cartão — renovação mensal automática</option><option value="pix">Pix — confirmar pagamento todo mês</option></select></label>
   <label><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/> Li os valores e autorizo {method==="card"?"a renovação mensal no cartão":"a criação das mensalidades Pix, que pagarei a cada mês"}.</label>
   <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(min(100%,220px),1fr))",gap:16}}>
    {data.prices.map(p=><article key={p.id} className="panel"><h3>{billingPlanNames[p.plan_code]}</h3><p>{money(p.amount_cents)} / mês</p><button type="button" className="button" disabled={busy||!confirmed||data.account?.recurring===true} onClick={()=>void act(async()=>{
     const result=await send("/account/billing/checkout",{price_id:p.id,method}) as {url:string};
     const target=new URL(result.url);if(target.protocol!=="https:"||target.hostname!=="checkout.stripe.com")throw new Error("Endereço de pagamento inválido.");
     window.location.assign(target.href);
    })}>Continuar no Stripe</button></article>)}
   </div>
   {!data.prices.length&&<p>Os valores ainda serão configurados pela administração.</p>}
   {data.account?.managed&&!data.account.cancel_at_period_end&&<div><h3>Cancelar renovação</h3><p>Você mantém seus dados e o período pago. Para mudar de plano, cancele a renovação e contrate o novo pacote após o período vigente.</p><label><input type="checkbox" checked={cancelConfirmed} onChange={e=>setCancelConfirmed(e.target.checked)}/> Confirmo o cancelamento das próximas renovações.</label><button type="button" className="button" disabled={busy||!cancelConfirmed} onClick={()=>void act(async()=>{setData(await send("/account/billing/cancel",{confirm:true}));setCancelConfirmed(false);})}>Cancelar renovação</button></div>}
   <h3>Pagamentos confirmados</h3>{data.payments.length?data.payments.map(p=><p key={p.provider_id}>{money(p.amount_cents)} · {date(p.period_start)} a {date(p.period_end)} · {p.status==="paid"?"Confirmado":"Revertido / em disputa"}</p>):<p>Nenhum pagamento confirmado.</p>}
  </>}
 </section>;
}
export function AdminBilling(){
 const [data,setData]=useState<BillingOverview|null>(null),[error,setError]=useState(""),[message,setMessage]=useState(""),[busy,setBusy]=useState(false);
 const [plan,setPlan]=useState<BillingPlan>("basic"),[amount,setAmount]=useState(""),[reason,setReason]=useState("");
 useAdminDraft(Boolean(amount||reason));
 const load=()=>adminRequest<BillingOverview>("/billing").then(setData);
 useEffect(()=>{let active=true;adminRequest<BillingOverview>("/billing").then(v=>{if(active)setData(v);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[]);
 return <div className="pa-grid"><section className="pa-card"><h2>Preços mensais</h2><p>Stripe em teste. Alterações valem para novas contratações. Os preços dos contratos existentes são preservados.</p>
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
  </form></section><section className="pa-card"><h2>Assinaturas e cobranças</h2><button className="pa-quiet" disabled={busy} onClick={()=>void load().catch(e=>setError(e.message))}>Atualizar</button>
   {data?.accounts.map(a=><article key={a.tenant_id} className="pa-account"><strong>{a.name}</strong><p>{billingPlanNames[a.plan_code]} · {a.method==="card"?"Cartão":"Pix"}</p><p>Pago até {date(a.paid_until)} · vence {date(a.due_on)}</p><p>{a.managed?"Contrato iniciado":"Aguardando primeiro pagamento"}{a.cancel_at_period_end?" · renovação cancelada":""}</p></article>)}
   {data&&!data.accounts.length&&<p>Nenhuma assinatura de teste criada.</p>}
  </section></div>;
}
