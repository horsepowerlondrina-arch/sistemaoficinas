import { useEffect, useRef, useState } from "react";
import { adminRequest } from "../lib/adminPresentation";
import { billingPlanNames, type BillingOverview, type BillingAccountDetails } from "../../shared/stripeBilling";
const money=(v:number)=>new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(v/100);
const day=(v:string|null)=>v?v.split("-").reverse().join("/"):"—";
const time=(v:string|null)=>v?new Date(v).toLocaleString("pt-BR"):"—";
const labels:Record<string,string>={paid:"Confirmado",refunded:"Revertido",disputed:"Em disputa",pending:"Aguardando confirmação da criação",open:"Pagamento pendente",expired:"Expirado"};
export function AdminBillingAccounts(){
 const [search,setSearch]=useState(""),[query,setQuery]=useState(""),[status,setStatus]=useState("all"),[page,setPage]=useState(1);
 const [data,setData]=useState<BillingOverview|null>(null),[details,setDetails]=useState<BillingAccountDetails|null>(null);
 const [selected,setSelected]=useState<string|null>(null),[detailPage,setDetailPage]=useState(1),[version,setVersion]=useState(0);
 const [error,setError]=useState(""),[message,setMessage]=useState(""),[loading,setLoading]=useState(false),[busy,setBusy]=useState(false),[reason,setReason]=useState(""),[jobReason,setJobReason]=useState(""),[jobConfirmed,setJobConfirmed]=useState(false);
 const actionLock=useRef(false);
 useEffect(()=>{
  let active=true;setLoading(true);setError("");setData(null);setDetails(null);
  const url=selected?`/billing/accounts/${encodeURIComponent(selected)}?page=${detailPage}`:`/billing?${new URLSearchParams({search:query,status,page:String(page)})}`;
  (selected?adminRequest<BillingAccountDetails>(url).then(v=>{if(active)setDetails(v);}):adminRequest<BillingOverview>(url).then(v=>{if(active)setData(v);}))
   .catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);});
  return()=>{active=false;};
 },[selected,detailPage,query,status,page,version]);
 async function reconcile(kind:"account"|"checkout"|"payment",id?:string){
  if(!selected||actionLock.current)return;
  actionLock.current=true;setBusy(true);setError("");setMessage("");
  try{await adminRequest(`/billing/accounts/${encodeURIComponent(selected)}/reconcile`,"POST",{kind,id,reason});setMessage("Conferência concluída com os dados atuais do Stripe. Nenhuma nova cobrança foi criada.");setReason("");setVersion(v=>v+1);}
  catch(e){setError((e as Error).message);}finally{actionLock.current=false;setBusy(false);}
 }
 async function runRenewal(){
  if(actionLock.current)return;actionLock.current=true;setBusy(true);setError("");setMessage("");
  try{const r=await adminRequest<{completed:number;failed:number;remaining:number;busy:boolean}>("/billing/renew","POST",{reason:jobReason,confirm:jobConfirmed});setMessage(r.busy?"Já existe uma rotina em execução. Atualize em instantes.":`Rotina concluída: ${r.completed} conta(s), ${r.failed} falha(s), ${r.remaining} aguardando processamento.`);setJobReason("");setJobConfirmed(false);setVersion(v=>v+1);}catch(e){setError((e as Error).message);}finally{actionLock.current=false;setBusy(false);}
 }
 const pagination=(current:number,total:number,size:number,onPage:(v:number)=>void)=><nav className="billing-pagination" aria-label="Páginas de cobranças"><button className="pa-quiet" disabled={loading||busy||current===1} onClick={()=>onPage(current-1)}>Anterior</button><span>Página {current} · {total} registro(s)</span><button className="pa-quiet" disabled={loading||busy||current*size>=total} onClick={()=>onPage(current+1)}>Próxima</button></nav>;
 return <section className="pa-card billing-section">
  <div className="billing-admin-heading"><h2>{selected?"Detalhes da assinatura":"Assinaturas e cobranças"}</h2><button className="pa-quiet" disabled={loading||busy} onClick={()=>setVersion(v=>v+1)}>Atualizar</button></div>
  <p className="billing-test-note">Stripe em teste · nenhum pagamento real</p>
  {error&&<p className="error-box" role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
  {loading&&<p role="status">Consultando registros…</p>}
  {!selected&&<>
   <form className="billing-admin-filters" onSubmit={e=>{e.preventDefault();setQuery(search.trim());setPage(1);setVersion(v=>v+1);}}>
    <label>Buscar oficina<input value={search} maxLength={100} onChange={e=>setSearch(e.target.value)}/></label>
    <label>Situação<select value={status} onChange={e=>{setStatus(e.target.value);setPage(1);}}><option value="all">Todas</option><option value="overdue">Vencidas</option><option value="pending">Com pagamento pendente</option><option value="paid">Com período pago</option><option value="cancelled">Renovação cancelada</option></select></label>
    <button className="pa-quiet" disabled={loading}>Buscar</button>
   </form>
   {data?.renewal&&<aside className="billing-job-summary"><strong>Última rotina de renovação</strong><p>{time(data.renewal.created_at)} · {data.renewal.technical_context.completed} concluída(s) · {data.renewal.technical_context.failed} falha(s) · {data.renewal.technical_context.remaining} aguardando processamento</p><p>Falhas são mantidas para nova tentativa. A cobertura paga só muda após confirmação do Stripe.</p></aside>}
   <details className="billing-reconcile"><summary>Retomar rotina de renovação</summary><p>Processa somente oficinas autorizadas para teste. Pode preparar a mensalidade Pix pendente; cartão é renovado pelo próprio Stripe. Não envia e-mails.</p><label>Justificativa da rotina<textarea value={jobReason} minLength={10} maxLength={500} disabled={busy} onChange={e=>setJobReason(e.target.value)}/></label><label className="billing-check"><input type="checkbox" checked={jobConfirmed} disabled={busy} onChange={e=>setJobConfirmed(e.target.checked)}/> Confirmo o processamento das renovações de teste.</label><button className="pa-quiet" disabled={busy||loading||!jobConfirmed||jobReason.trim().length<10} onClick={()=>void runRenewal()}>{busy?"Processando…":"Executar rotina de teste"}</button></details>
   {data?.accounts.map(a=><article key={a.tenant_id} className="pa-account"><h3>{a.name}</h3><p>{billingPlanNames[a.plan_code]} · {a.method==="card"?"Cartão":"Pix"}</p><p>Pago até {day(a.paid_until)} · vencimento {day(a.due_on)}</p><p>{a.managed?"Contrato iniciado":"Aguardando primeiro pagamento"}{a.cancel_at_period_end?" · renovação cancelada":""}</p><button className="pa-quiet" onClick={()=>{setSelected(a.tenant_id);setDetailPage(1);setMessage("");setReason("");}}>Ver cobranças</button></article>)}
   {data&&!data.accounts.length&&<p>Nenhuma assinatura encontrada.</p>}
   {data&&pagination(page,data.total??data.accounts.length,data.page_size??25,setPage)}
  </>}
  {selected&&<>
   <button className="pa-quiet" disabled={busy} onClick={()=>{setSelected(null);setReason("");setMessage("");}}>Voltar às assinaturas</button>
   {details&&<>
    <h3>{details.account.name}</h3><p>{billingPlanNames[details.account.plan_code]} · {money(details.account.amount_cents)} / mês · {details.account.method==="card"?"Cartão":"Pix"}</p>
    <p>Pago até {day(details.account.paid_until)} · vencimento {day(details.account.due_on)}</p>
    <p>{details.account.cancel_at_period_end?"Renovação cancelada":"Renovação habilitada"} · próxima conferência agendada: {time(details.account.retry_after)}</p>
    {details.account.has_pending_invoice&&<p role="note">Existe uma fatura pendente no Stripe. A oficina pode regularizá-la na aba Assinatura e pagamentos.</p>}
    <div className="billing-reconcile"><h3>Conferir no Stripe</h3><p>Consulta a situação atual e concilia somente pagamentos comprovados. Não cria cobranças, não confirma valores manualmente e não reabre reservas ambíguas.</p><label>Justificativa da conferência<textarea minLength={10} maxLength={500} value={reason} disabled={busy} onChange={e=>setReason(e.target.value)}/></label><button className="pa-quiet" disabled={busy||reason.trim().length<10} onClick={()=>void reconcile("account")}>{busy?"Conferindo…":"Conferir assinatura"}</button></div>
    <h3>Faturas e pagamentos confirmados</h3>
    {!details.payments.length&&<p>Nenhum pagamento confirmado.</p>}
    {details.payments.map(p=><article className="pa-account billing-record" key={p.provider_id}><strong>{money(p.amount_cents)} · {labels[p.status]??"Em conferência"}</strong><p>{p.method==="card"?"Cartão":"Pix"} · {day(p.period_start)} a {day(p.period_end)}</p><p className="billing-reference">Referência: {p.provider_id}</p><button className="pa-quiet" disabled={busy||reason.trim().length<10} onClick={()=>void reconcile("payment",p.provider_id)}>Conferir pagamento</button></article>)}
    <h3>Tentativas e pagamentos pendentes</h3>
    {!details.checkouts.length&&<p>Nenhuma tentativa registrada.</p>}
    {details.checkouts.map(c=><article className="pa-account billing-record" key={c.id}><strong>{money(c.amount_cents)} · {labels[c.status]??"Em conferência"}</strong><p>{c.method==="card"?"Cartão":"Pix"} · {time(c.created_at)}</p><p className="billing-reference">Referência: {c.provider_id??c.id}</p>{c.needs_review&&<p role="note">Reserva sem confirmação há mais de 23 horas. Requer investigação no Stripe; uma nova cobrança permanece bloqueada.</p>}<button className="pa-quiet" disabled={busy||!c.provider_id||reason.trim().length<10} onClick={()=>void reconcile("checkout",c.id)}>Conferir tentativa</button></article>)}
    {pagination(detailPage,details.total,details.page_size,setDetailPage)}
   </>}
  </>}
 </section>;
}
