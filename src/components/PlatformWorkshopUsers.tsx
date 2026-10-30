import {useCallback,useEffect,useRef,useState} from "react";
import {adminRequest} from "../lib/adminPresentation";
import {useAdminDraft} from "../lib/useAdminDraft";
type Member={user_id:string;name:string;email:string;role:"owner"|"operator"};
export function PlatformWorkshopUsers({tenantId,primaryOwnerEmail,canEdit=true,onSaved}:{tenantId:string;primaryOwnerEmail:string;canEdit?:boolean;onSaved?:()=>void}){
 const [items,setItems]=useState<Member[]>([]),[reason,setReason]=useState(""),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState(""),[message,setMessage]=useState("");
 const lock=useRef(false);useAdminDraft(!!reason);
 const load=useCallback(async()=>{setLoading(true);setError("");try{setItems((await adminRequest<{items:Member[]}>(`/workshops/${encodeURIComponent(tenantId)}/users`)).items);}catch(e){setError((e as Error).message);}finally{setLoading(false);}},[tenantId]);
 useEffect(()=>{void load();},[load]);
 const change=async(m:Member,action:"set_role"|"remove",role:"owner"|"operator"|null)=>{
 if(lock.current||!canEdit)return;
 if(reason.trim().length<10||reason.trim().length>500){setError("Informe uma justificativa entre 10 e 500 caracteres.");return;}
 if(!window.confirm(action==="remove"?`Remover o acesso de ${m.name} somente desta oficina?`:`Alterar o papel de ${m.name} para ${role==="owner"?"proprietário":"operador"}?`))return;
 lock.current=true;setBusy(true);setError("");setMessage("");
 try{await adminRequest(`/workshops/${encodeURIComponent(tenantId)}/users/${encodeURIComponent(m.user_id)}`,"PATCH",{action,role,reason:reason.trim()});setReason("");await load();setMessage("Vínculo atualizado e auditado.");onSaved?.();}
 catch(e){setError((e as Error).message);}finally{lock.current=false;setBusy(false);}};
 const owners=items.filter(m=>m.role==="owner").length;
 return <section className="pa-workshop-state-form" aria-labelledby="workshop-users-title"><div className="pa-section-title"><h3 id="workshop-users-title">Proprietários e colaboradores</h3><button type="button" className="pa-quiet" disabled={busy||loading} onClick={()=>void load()}>Atualizar usuários</button></div><p>As ações afetam somente o vínculo com esta oficina. A conta é preservada e o último proprietário não pode ser removido.</p>
 {error&&<p role="alert" className="pa-note pa-note--error">{error}</p>}{message&&<p role="status" className="pa-note">{message}</p>}
 {canEdit&&<label>Justificativa para alterar um vínculo<textarea disabled={busy} minLength={10} maxLength={500} value={reason} onChange={e=>setReason(e.target.value)}/></label>}
 <div className="pa-members">{items.map(m=>{const last=m.role==="owner"&&owners===1;return <article className="pa-member" key={m.user_id}><div><strong>{m.name}</strong><p>{m.role==="owner"?(m.email.toLowerCase()===primaryOwnerEmail.toLowerCase()?"Proprietário principal":"Proprietário"):"Colaborador · Operador"}</p><small>{m.email}</small>{last&&<small>Último proprietário: vínculo protegido.</small>}</div>{canEdit&&<div className="pa-workshop-actions"><button type="button" className="pa-quiet" disabled={busy||loading||last||reason.trim().length<10} onClick={()=>void change(m,"set_role",m.role==="owner"?"operator":"owner")}>{m.role==="owner"?"Tornar operador":"Tornar proprietário"}</button><button type="button" className="pa-quiet pa-danger" disabled={busy||loading||last||reason.trim().length<10} onClick={()=>void change(m,"remove",null)}>Remover desta oficina</button></div>}</article>;})}
 {!loading&&!error&&items.length===0&&<p>Nenhum usuário vinculado à oficina.</p>}{loading&&<p role="status">Carregando usuários…</p>}</div></section>;
}
