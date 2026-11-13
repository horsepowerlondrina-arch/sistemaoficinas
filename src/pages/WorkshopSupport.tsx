import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, send } from "../lib/api";
import "../platform-admin.css";
type Ticket={id:string;subject:string;status:string;updated_at:string};
type Message={id:string;sender_kind:string;body:string;created_at:string};
const statusLabel:Record<string,string>={open:"Aberto",waiting_workshop:"Aguardando sua resposta",resolved:"Resolvido"};
export function WorkshopSupport(){
  const sequence=useRef(0);
  const refreshInFlight=useRef(false);
  const [refreshing,setRefreshing]=useState(false);
  const [loading,setLoading]=useState(false);
  const [tickets,setTickets]=useState<Ticket[]>([]),[selected,setSelected]=useState<Ticket|null>(null),[messages,setMessages]=useState<Message[]>([]);
  const [subject,setSubject]=useState(""),[body,setBody]=useState(""),[error,setError]=useState(""),[busy,setBusy]=useState(false);
  const load=async()=>setTickets(await api<Ticket[]>("/support/tickets"));
  const open=async(ticket:Ticket)=>{const current=++sequence.current;setSelected(ticket);setMessages([]);setLoading(true);setError("");try{const result=await api<Message[]>(`/support/tickets/${ticket.id}/messages`);if(current===sequence.current)setMessages(result);}catch(e){if(current===sequence.current)setError((e as Error).message);}finally{if(current===sequence.current)setLoading(false);}};
  // Refresh keeps the draft and selection; stale responses cannot replace another conversation.
  const refresh=async()=>{
    if(refreshInFlight.current||busy||loading)return;
    refreshInFlight.current=true;setRefreshing(true);setError("");
    const current=sequence.current,ticket=selected;
    try{
      const [items,conversation]=await Promise.all([
        api<Ticket[]>("/support/tickets"),
        ticket?api<Message[]>(`/support/tickets/${ticket.id}/messages`):Promise.resolve(null),
      ]);
      if(current!==sequence.current)return;
      setTickets(items);
      if(ticket){setSelected(items.find(item=>item.id===ticket.id)||ticket);if(conversation)setMessages(conversation);}
    }catch(e){if(current===sequence.current)setError((e as Error).message);}
    finally{refreshInFlight.current=false;setRefreshing(false);}
  };
  useEffect(()=>{void load().catch(e=>setError(e.message));return()=>{sequence.current++;};},[]);
  const submit=async(event:FormEvent)=>{event.preventDefault();if(busy||loading||refreshing)return;setBusy(true);setError("");try{
    if(selected){await send(`/support/tickets/${selected.id}/messages`,{body});await open({...selected,status:"open"});await load();}else{const created=await api<{id:string}>("/support/tickets",{method:"POST",body:JSON.stringify({subject,body})});await load();const ticket={id:created.id,subject,status:"open",updated_at:new Date().toISOString()};setSelected(ticket);setMessages([{id:created.id,sender_kind:"workshop",body,created_at:new Date().toISOString()}]);}
    setSubject("");setBody("");
  }catch(e){setError((e as Error).message);}finally{setBusy(false);}};
  return <div className="workshop-support"><header><h1>Suporte</h1><p>Abra um chamado e acompanhe as respostas da equipe OSDrive.</p></header>{error&&<p role="alert" className="pa-note pa-note--error">{error}</p>}
    <div className="pa-support-layout"><section className="pa-card"><button className="pa-quiet" disabled={busy} onClick={()=>{sequence.current++;setLoading(false);setSelected(null);setMessages([]);setError("");}}>Novo chamado</button><button className="pa-quiet" disabled={busy||loading||refreshing} onClick={()=>void refresh()}>{refreshing?"Atualizando…":"Atualizar"}</button>{tickets.map(ticket=><button className="pa-support-ticket" key={ticket.id} disabled={busy} onClick={()=>void open(ticket)} aria-current={selected?.id===ticket.id?"true":undefined}><strong>{ticket.subject}</strong><span>{statusLabel[ticket.status]||ticket.status}</span><small>{new Date(ticket.updated_at).toLocaleString("pt-BR")}</small></button>)}{tickets.length===0&&<p>Você ainda não abriu chamados.</p>}</section>
      <section className="pa-card">{selected?<><h2>{selected.subject}</h2>{loading&&<p role="status">Carregando conversa…</p>}<div className="pa-support-messages">{messages.map(message=><article key={message.id}><strong>{message.sender_kind==="admin"?"Suporte OSDrive":"Oficina"}</strong><small>{new Date(message.created_at).toLocaleString("pt-BR")}</small><p>{message.body}</p></article>)}</div></>:<h2>Novo chamado</h2>}
        <form className="pa-support-form" onSubmit={submit}>{!selected&&<label>Assunto<input value={subject} onChange={event=>setSubject(event.target.value)} minLength={5} maxLength={160} required/></label>}<label>Mensagem<textarea value={body} onChange={event=>setBody(event.target.value)} minLength={1} maxLength={4000} required/></label><button className="pa-primary" disabled={busy||loading||refreshing||!body.trim()}>{selected?"Enviar mensagem":"Abrir chamado"}</button></form></section></div></div>;
}
