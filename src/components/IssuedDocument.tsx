import { useEffect,useState } from "react";
import { api,send } from "../lib/api";
import { OrderPrint } from "./OrderPrint";
import { ChecklistPrint } from "./ChecklistPrint";
import { useApp } from "../lib/context";
import { ShareOrder } from "./ShareOrder";
export function IssuedDocument({kind,id}:{kind:"order"|"checklist";id:string}){
 const {session}=useApp(),admin=session.role==="owner";
 const [history,setHistory]=useState<{legacy:boolean;revisions:Record<string,any>[]}>({legacy:false,revisions:[]});
 const [payload,setPayload]=useState<Record<string,any>|null>(null),[error,setError]=useState(""),[busy,setBusy]=useState(false),[printing,setPrinting]=useState(false);
 const endpoint="/documents/"+kind+"/"+id;
 useEffect(()=>{
  let active=true;setPayload(null);setError("");
  api<typeof history>(endpoint).then(async h=>{if(!active)return;setHistory(h);if(h.revisions.length){const document=await api<Record<string,any>>(endpoint+"?revision="+h.revisions[0].revision);if(active)setPayload(document);}}).catch(e=>{if(active)setError(e.message);});
  return()=>{active=false;};
 },[endpoint]);
 useEffect(()=>{if(printing&&payload){const frame=requestAnimationFrame(()=>{window.print();setPrinting(false);});return()=>cancelAnimationFrame(frame);}},[printing,payload]);
 async function issue(newRevision:boolean){
  setBusy(true);setError("");
  try{const value=await send(endpoint,{new_revision:newRevision});setPayload(value);setHistory(await api(endpoint));setPrinting(true);}catch(e){setError((e as Error).message);}finally{setBusy(false);}
 }
 return <>
  <section className="panel no-print issued-document-controls">
   <h2>Documento emitido</h2>
   {history.legacy&&!history.revisions.length?<p role="status">Registro legado sem snapshot. A identidade e o documento originalmente emitidos não foram registrados e não serão reconstruídos com dados atuais. Uma nova emissão será identificada como revisão do legado.</p>:<p>Emissões são imutáveis. Alterar dados da oficina, itens ou pagamentos não modifica revisões já emitidas.</p>}
   {history.revisions.length>0&&<label>Revisão para reimprimir<select disabled={busy} value={payload?.revision||""} onChange={async e=>{setBusy(true);setError("");try{setPayload(await api(endpoint+"?revision="+e.target.value));}catch(error){setError((error as Error).message);}finally{setBusy(false);}}}>{history.revisions.map(r=><option key={r.revision} value={r.revision}>Revisão {r.revision} · {new Date(r.issued_at).toLocaleString("pt-BR")}</option>)}</select></label>}
   <div className="capture-actions">
    {payload?<button type="button" className="button" disabled={busy} onClick={()=>setPrinting(true)}>Reimprimir revisão {payload.revision}</button>:!history.legacy&&<button type="button" className="button" disabled={busy} onClick={()=>void issue(false)}>Emitir e imprimir / PDF</button>}
    {admin&&(history.legacy||history.revisions.length>0)&&<button type="button" className="button" disabled={busy} onClick={()=>{if(window.confirm("Emitir uma nova revisão com os dados atuais? As anteriores e seus links serão preservados."))void issue(true);}}>Emitir nova revisão com dados atuais</button>}
   </div>
   {kind==="order"&&admin&&payload&&<ShareOrder key={`${id}-${payload.revision}`} revision={payload.revision} shopName={payload.shop.name} customerPhone={payload.customer?.phone} order={{id,number:payload.order.number,status:payload.order.status,total:payload.order.total,plate:payload.vehicle?.plate||payload.order.guest_plate||"",customer_id:payload.customer?.id||"",customer_name:payload.customer?.name||payload.order.guest_name||"Cliente não informado"}}/>}
   {error&&<p role="alert" className="error-box">{error}</p>}
  </section>
  {payload&&<div className="issued-document">
   <div className="print-only document-revision-label">Revisão {payload.revision} · Emitido em {new Date(payload.issued_at).toLocaleString("pt-BR")}{payload.reissued_legacy?" · Nova emissão de registro legado":""}</div>
   {kind==="order"?<OrderPrint order={{...payload.order,quote_valid_until:payload.quote_valid_until}} tenant={payload.shop} customer={payload.customer||undefined} vehicle={payload.vehicle||undefined}/>:<ChecklistPrint checklist={payload.checklist} tenant={payload.shop}/>}
  </div>}
 </>;
}
