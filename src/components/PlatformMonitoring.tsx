import { useEffect, useState } from "react";
import { adminActionLabel, adminRequest } from "../lib/adminPresentation";
type Monitoring={checked_at:string;database_available:boolean;integrations:{name:string;configured:boolean;failures:number|null}[];audit_failures:{action:string;count:number}[]};
export function PlatformMonitoring(){
 const [value,setValue]=useState<Monitoring|null>(null),[error,setError]=useState(""),[busy,setBusy]=useState(false),[tab,setTab]=useState("health");
 const load=async()=>{setBusy(true);setError("");try{setValue(await adminRequest<Monitoring>("/monitoring"));}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
 useEffect(()=>{void load();},[]);
 return <div className="pa-monitoring">
  <div className="pa-section-title"><p>Última consulta: {value?new Date(value.checked_at).toLocaleString("pt-BR"):"ainda não realizada"}</p><button className="pa-quiet" disabled={busy} onClick={()=>void load()}>{busy?"Atualizando…":"Atualizar"}</button></div>
  {error&&<p role="alert" className="pa-note pa-note--error">{error} Os dados anteriores podem estar desatualizados.</p>}
  <div role="tablist" aria-label="Monitoramento" className="pa-workshop-tabs">{[["health","Saúde e integrações"],["failures","Falhas registradas"]].map(([id,label])=><button id={`monitor-tab-${id}`} aria-controls={`monitor-panel-${id}`} role="tab" key={id} aria-selected={tab===id} onClick={()=>setTab(id)}>{label}</button>)}</div>
  <section className="pa-card" role="tabpanel" id="monitor-panel-health" aria-labelledby="monitor-tab-health" hidden={tab!=="health"}>
   <h2>Disponibilidade observada</h2>{value?<><p>Banco de dados: <strong>{value.database_available?"Respondendo":"Indisponível"}</strong></p><div className="pa-monitoring-grid">{value.integrations.map(item=><article key={item.name}><h3>{item.name}</h3><span>{item.configured?"Configuração presente":"Configuração incompleta"}</span><strong>{item.failures===null?"Contagem indisponível":`${item.failures} falha(s) em 24 horas`}</strong></article>)}</div></>:<p role="status">{busy?"Consultando disponibilidade…":"Dados indisponíveis."}</p>}
   <p className="pa-help">As falhas são registradas nas tentativas reais do sistema a partir desta versão. Configuração presente não comprova disponibilidade do provedor; nenhuma cobrança ou consulta de placa é feita ao atualizar esta tela.</p>
  </section>
  <section className="pa-card" role="tabpanel" id="monitor-panel-failures" aria-labelledby="monitor-tab-failures" hidden={tab!=="failures"}><h2>Falhas nas últimas 24 horas</h2>{value?value.audit_failures.length?<ul className="pa-event-summary">{value.audit_failures.map(item=><li key={item.action}><span>{adminActionLabel(item.action)}</span><strong>{item.count}</strong></li>)}</ul>:<p>Nenhuma falha registrada neste período.</p>:<p>Consulte os dados para visualizar as falhas.</p>}</section>
 </div>;
}
