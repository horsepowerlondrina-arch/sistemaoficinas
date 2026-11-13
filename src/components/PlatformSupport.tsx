import { useEffect, useRef, useState, type FormEvent } from "react";
import { adminRequest } from "../lib/adminPresentation";

type Ticket = { id:string; workshop_name:string|null; subject:string; status:string; updated_at:string };
type Message = { id:string; sender_kind:string; body:string; created_at:string };
const statusLabel:Record<string,string>={open:"Aberto",waiting_workshop:"Aguardando oficina",resolved:"Resolvido"};

export function PlatformSupport({canReply}:{canReply:boolean}) {
  const sequence=useRef(0);
  const [filter,setFilter]=useState("all"),[loading,setLoading]=useState(false);
  const [tickets,setTickets]=useState<Ticket[]>([]),[selected,setSelected]=useState<Ticket|null>(null),[messages,setMessages]=useState<Message[]>([]);
  const [body,setBody]=useState(""),[error,setError]=useState(""),[busy,setBusy]=useState(false);
  const load=async()=>setTickets(await adminRequest<Ticket[]>("/support/tickets"));
  const open=async(ticket:Ticket)=>{if(body.trim()&&!window.confirm("Descartar a resposta ainda não enviada?"))return;const current=++sequence.current;setSelected(ticket);setMessages([]);setBody("");setLoading(true);setError("");try{const result=await adminRequest<Message[]>(`/support/tickets/${ticket.id}/messages`);if(current===sequence.current)setMessages(result);}catch(e){if(current===sequence.current)setError((e as Error).message);}finally{if(current===sequence.current)setLoading(false);}};
  useEffect(()=>{void load().catch(e=>setError(e.message));},[]);
  const reply=async(event:FormEvent)=>{event.preventDefault();if(busy||!selected)return;setBusy(true);setError("");try{
    await adminRequest(`/support/tickets/${selected.id}/messages`,"POST",{body});setBody("");setSelected({...selected,status:"waiting_workshop"});setMessages(await adminRequest<Message[]>(`/support/tickets/${selected.id}/messages`));await load();
  }catch(e){setError((e as Error).message);}finally{setBusy(false);}};
  const changeStatus=async(status:"open"|"resolved")=>{if(!selected||busy)return;setBusy(true);setError("");try{
    await adminRequest(`/support/tickets/${selected.id}/status`,"PATCH",{status});setSelected({...selected,status});await load();
  }catch(e){setError((e as Error).message);}finally{setBusy(false);}};
  return <div className="pa-support-layout"><section className="pa-card"><div className="pa-section-title"><div><h2>Chamados das oficinas</h2><p>Mensagens acessíveis somente à oficina e aos administradores autorizados.</p></div><button className="pa-quiet" onClick={()=>void load().catch(e=>setError(e.message))}>Atualizar</button></div>
    <div className="pa-workshop-tabs" role="tablist" aria-label="Situação dos chamados">{[["all","Todos"],["open","Abertos"],["waiting_workshop","Aguardando"],["resolved","Resolvidos"]].map(([id,label])=><button key={id} role="tab" aria-selected={filter===id} onClick={()=>setFilter(id)}>{label}</button>)}</div>{tickets.filter(ticket=>filter==="all"||ticket.status===filter).map(ticket=><button className="pa-support-ticket" key={ticket.id} disabled={busy} onClick={()=>void open(ticket)} aria-current={selected?.id===ticket.id?"true":undefined}><strong>{ticket.subject}</strong><span>{ticket.workshop_name||"Oficina"} · {statusLabel[ticket.status]||ticket.status}</span><small>{new Date(ticket.updated_at).toLocaleString("pt-BR")}</small></button>)}
    {tickets.length===0&&<p>Nenhum chamado registrado.</p>}</section>
    <section className="pa-card" aria-label="Conversa do chamado">{error&&<p role="alert" className="pa-note pa-note--error">{error}</p>}{selected?<><h2>{selected.subject}</h2><p>{selected.workshop_name||"Oficina"} · {statusLabel[selected.status]||selected.status}</p>{loading&&<p role="status">Carregando conversa…</p>}<div className="pa-support-messages">{messages.map(message=><article key={message.id}><strong>{message.sender_kind==="admin"?"Administração":"Oficina"}</strong><small>{new Date(message.created_at).toLocaleString("pt-BR")}</small><p>{message.body}</p></article>)}</div>{canReply&&<><form className="pa-support-form" onSubmit={reply}><label>Resposta<textarea value={body} onChange={event=>setBody(event.target.value)} minLength={1} maxLength={4000} required/></label><button className="pa-primary" disabled={busy||loading||!body.trim()}>Enviar resposta</button></form><button className="pa-quiet" disabled={busy||loading} onClick={()=>void changeStatus(selected.status==="resolved"?"open":"resolved")}>{selected.status==="resolved"?"Reabrir chamado":"Marcar como resolvido"}</button></>}</>:<p>Selecione um chamado para acompanhar a conversa.</p>}</section></div>;
}
