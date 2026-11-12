import { useEffect, useState } from "react";
import { adminRequest } from "../lib/adminPresentation";
type Monitoring={checked_at:string;database_available:boolean;integrations:{name:string;configured:boolean;failures:number|null}[];audit_failures:{action:string;count:number}[];support_by_status:{status:string;count:number}[]};
export function PlatformMonitoring(){
  const [value,setValue]=useState<Monitoring|null>(null),[error,setError]=useState("");
  const load=async()=>{setError("");try{setValue(await adminRequest<Monitoring>("/monitoring"));}catch(e){setError((e as Error).message);}};
  useEffect(()=>{void load();},[]);
  return <div className="pa-monitoring"><section className="pa-card"><div className="pa-section-title"><div><h2>Saúde do sistema</h2><p>Estado observado na última consulta, sem dados operacionais das oficinas.</p></div><button className="pa-quiet" onClick={()=>void load()}>Atualizar</button></div>{error&&<p role="alert" className="pa-note pa-note--error">{error}</p>}{value&&<><p>Banco de dados: <strong>{value.database_available?"Respondendo":"Indisponível"}</strong></p><small>Verificado em {new Date(value.checked_at).toLocaleString("pt-BR")}</small></>}</section>
    <section className="pa-card"><h2>Integrações</h2><p>Configuração detectada e falhas registradas nas últimas 24 horas. “Sem telemetria” indica que esta integração ainda não registra incidentes neste painel.</p><div className="pa-monitoring-grid">{value?.integrations.map(item=><article key={item.name}><strong>{item.name}</strong><span>{item.configured?"Configurada":"Configuração ausente"}</span><small>{item.failures===null?"Falhas: sem telemetria":`Falhas registradas: ${item.failures}`}</small></article>)}</div></section>
    <section className="pa-card"><h2>Falhas administrativas recentes</h2>{value?.audit_failures.length?value.audit_failures.map(item=><p key={item.action}>{item.action}: {item.count}</p>):<p>Nenhuma falha administrativa registrada nas últimas 24 horas.</p>}</section></div>;
}
