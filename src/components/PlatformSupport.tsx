import { useEffect, useState, type FormEvent } from "react";
import { adminRequest } from "../lib/adminPresentation";

type Ticket = { id:string; workshop_name:string|null; subject:string; status:string; updated_at:string };
type Message = { id:string; sender_kind:string; body:string; created_at:string };
const statusLabel:Record<string,string>={open:"Aberto",waiting_workshop:"Aguardando oficina",resolved:"Resolvido"};

export function PlatformSupport({canReply}:{canReply:boolean}) {
  const [tickets,setTickets]=useState<Ticket[]>([]),[selected,setSelected]=useState<Ticket|null>(null),[messages,setMessages]=useState<Message[]>([]);
  const [body,setBody]=useState(""),[error,setError]=useState(""),[busy,setBusy]=useState(false);
  const load=async()=>setTickets(await adminRequest<Ticket[]>("/support/tickets"));
  const open=async(ticket:Ticket)=>{setSelected(ticket);setError("");try{setMessages(await adminRequest<Message[]>(`/support/tickets/${ticket.id}/messages`));}catch(e){setError((e as Error).message);}};
  useEffect(()=>{void load().catch(e=>setError(e.message));},[]);
  const reply=async(event:FormEvent)=>{event.preventDefault();if(busy||!selected)return;setBusy(true);setError("");try{
    await adminRequest(`/support/tickets/${selected.id}/messages`,"POST",{body});setBody("");await open(selected);await load();
  }catch(e){setError((e as Error).message);}finally{setBusy(false);}};
  const changeStatus=async(status:"open"|"resolved")=>{if(!selected||busy)return;setBusy(true);setError("");try{
    await adminRequest(`/support/tickets/${selected.id}/status`,"PATCH",{status});setSelected({...selected,status});await load();
  }catch(e){setError((e as Error).message);}finally{setBusy(false);}};
  return <div className="pa-support-layout"><section className="pa-card"><div className="pa-section-title"><div><h2>Chamados das oficinas</h2><p>Mensagens acessíveis somente à oficina e aos administradores autorizados.</p></div><button className="pa-quiet" onClick={()=>void load().catch(e=>setError(e.message))}>Atualizar</button></div>
    {tickets.map(ticket=><button className="pa-support-ticket" key={ticket.id} onClick={()=>void open(ticket)} aria-current={selected?.id===ticket.id?"true":undefined}><strong>{ticket.subject}</strong><span>{ticket.workshop_name||"Oficina"} · {statusLabel[ticket.status]||ticket.status}</span><small>{new Date(ticket.updated_at).toLocaleString("pt-BR")}</small></button>)}
    {tickets.length===0&&<p>Nenhum chamado registrado.</p>}</section>
    <section className="pa-card" aria-label="Conversa do chamado">{error&&<p role="alert" className="pa-note pa-note--error">{error}</p>}{selected?<><h2>{selected.subject}</h2><p>{selected.workshop_name||"Oficina"} · {statusLabel[selected.status]||selected.status}</p><div className="pa-support-messages">{messages.map(message=><article key={message.id}><strong>{message.sender_kind==="admin"?"Administração":"Oficina"}</strong><small>{new Date(message.created_at).toLocaleString("pt-BR")}</small><p>{message.body}</p></article>)}</div>{canReply&&<><form className="pa-support-form" onSubmit={reply}><label>Resposta<textarea value={body} onChange={event=>setBody(event.target.value)} minLength={1} maxLength={4000} required/></label><button className="pa-primary" disabled={busy||!body.trim()}>Enviar resposta</button></form><button className="pa-quiet" disabled={busy} onClick={()=>void changeStatus(selected.status==="resolved"?"open":"resolved")}>{selected.status==="resolved"?"Reabrir chamado":"Marcar como resolvido"}</button></>}</>:<p>Selecione um chamado para acompanhar a conversa.</p>}</section></div>;
}
