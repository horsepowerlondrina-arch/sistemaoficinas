import {useCallback,useEffect,useRef,useState,type ReactNode} from "react";
import {workshopModuleKeys,workshopModuleLabels,type WorkshopModules} from "../../shared/workshopModules";
import {adminRequest,optionalWholeNumber,plannedWorkshopPlans} from "../lib/adminPresentation";
import {useAdminDraft} from "../lib/useAdminDraft";
type Entitlements={plate_lookup?:{status:string;enabled:boolean;configured:boolean;authorized:boolean};plan_code:string|null;plan_configured:boolean;plan_module_defaults:Partial<WorkshopModules>;module_overrides:Partial<WorkshopModules>;modules:WorkshopModules;max_users_override:number|null;max_users:number|null;trial_days_override:number|null;trial_days:number;user_count:number};
export function PlatformWorkshopEntitlements({tenantId,canEdit=true,onSaved,catalogStatus,catalogControls}:{tenantId:string;canEdit?:boolean;onSaved?:()=>void;catalogStatus?:string;catalogControls?:ReactNode}){
 const [state,setState]=useState<Entitlements|null>(null),[modules,setModules]=useState<Partial<WorkshopModules>>({}),[maxUsers,setMaxUsers]=useState(""),[trialDays,setTrialDays]=useState(""),[reason,setReason]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState(""),[message,setMessage]=useState("");
 const lock=useRef(false);
 const apply=(value:Entitlements)=>{setState(value);setModules(value.module_overrides||{});setMaxUsers(value.max_users_override==null?"":String(value.max_users_override));setTrialDays(value.trial_days_override==null?"":String(value.trial_days_override));setReason("");};
 const dirty=!!state&&(JSON.stringify(modules)!==JSON.stringify(state.module_overrides||{})||maxUsers!==(state.max_users_override==null?"":String(state.max_users_override))||trialDays!==(state.trial_days_override==null?"":String(state.trial_days_override))||!!reason);
 useAdminDraft(dirty);
 const load=useCallback(async()=>{setBusy(true);setError("");try{apply(await adminRequest<Entitlements>(`/workshops/${encodeURIComponent(tenantId)}/entitlements`));}catch(e){setError((e as Error).message);}finally{setBusy(false);}},[tenantId]);
 useEffect(()=>{void load();},[load]);
 const refresh=()=>{if(dirty&&!window.confirm("Descartar as alterações de permissões não salvas?"))return;void load();};
 const save=async(restore=false)=>{
  if(lock.current||!canEdit)return;
  if(reason.trim().length<10||reason.trim().length>500){setError("Informe uma justificativa entre 10 e 500 caracteres.");return;}
  if(restore&&!window.confirm("Remover as exceções administrativas e restaurar os padrões atuais?"))return;
  lock.current=true;setBusy(true);setError("");setMessage("");
  try{const result=await adminRequest<{entitlements:Entitlements}>(`/workshops/${encodeURIComponent(tenantId)}/entitlements`,"PUT",{
   module_overrides:restore?{}:modules,max_users:restore?null:optionalWholeNumber(maxUsers,10000),trial_days:restore?null:optionalWholeNumber(trialDays,90),reason:reason.trim()});
   apply(result.entitlements);setMessage(restore?"Padrões atuais restaurados e auditados.":"Permissões e limites salvos e auditados.");onSaved?.();
  }catch(e){setError((e as Error).message);}finally{lock.current=false;setBusy(false);}
 };
 return <section className="pa-workshop-state-form" aria-labelledby="workshop-entitlements-title">
 <h3 id="workshop-entitlements-title">Permissões e limites da oficina</h3>
 {error&&<p role="alert" className="pa-note pa-note--error">{error}</p>}{message&&<p role="status" className="pa-note">{message}</p>}
 {!state?<><p>{busy?"Carregando configurações…":"Configurações indisponíveis."}</p><button type="button" className="pa-quiet" disabled={busy} onClick={()=>void load()}>Tentar novamente</button></>:<>
 <p>Plano associado: <strong>{plannedWorkshopPlans.find(p=>p.code===state.plan_code)?.label||state.plan_code||"Sem plano"}</strong>. {state.plan_configured?"Padrões cadastrados no sistema.":"Sem padrões comerciais configurados; os acessos existentes são preservados."}</p>
 <details className="pa-plans"><summary>Estrutura comercial planejada</summary><ul>{plannedWorkshopPlans.map(p=><li key={p.code}><strong>{p.label}</strong>: {p.description}</li>)}</ul><p>Planejamento futuro, sem cobrança ou alteração de contratos. Nenhum acesso é concedido ou removido por esta apresentação.</p></details>
 <div className="pa-permissions-table"><table><thead><tr><th>Funcionalidade</th><th>Padrão atual</th><th>Exceção administrativa</th><th>Acesso salvo</th></tr></thead><tbody>
 {workshopModuleKeys.map(key=><tr key={key}><th scope="row">{workshopModuleLabels[key]}</th><td>{state.plan_module_defaults[key]===undefined?"Compatibilidade atual":state.plan_module_defaults[key]?"Habilitado":"Desabilitado"}</td><td><select aria-label={`Exceção: ${workshopModuleLabels[key]}`} disabled={busy||!canEdit} value={modules[key]===undefined?"inherit":modules[key]?"allow":"deny"} onChange={e=>setModules(current=>{const next={...current};if(e.target.value==="inherit")delete next[key];else next[key]=e.target.value==="allow";return next;})}><option value="inherit">Usar padrão</option><option value="allow">Habilitar</option><option value="deny">Desabilitar</option></select></td><td>{key==="external_plate_lookup"?(state.plate_lookup?.status==="available"?"Liberado":state.plate_lookup?.status==="not_configured"?"Integração não configurada":state.plate_lookup?.status==="unauthorized"?"Não autorizado":"Consultar configuração"):state.modules[key]===false?"Bloqueado":key==="technical_catalog"?(catalogStatus===undefined?"Consultar disponibilidade":catalogStatus==="active"?"Liberado":"Indisponível pela validade ou autorização"):"Liberado"}</td></tr>)}
 </tbody></table></div>
 <p>A consulta externa de placas é independente do Catálogo Técnico e exige uma chave já configurada para esta oficina. Usar padrão preserva a autorização anterior quando não há padrão do plano. Nenhuma chave é exibida ou alterada aqui.</p>
 <p>As exceções prevalecem sobre o plano. O catálogo também exige autorização válida abaixo; suas tarifas e dados permanecem preservados.</p>
 <form onSubmit={e=>{e.preventDefault();void save();}} className="pa-workshop-state-form">
 <fieldset disabled={busy||!canEdit} className="pa-form-fields">
 <label>Limite máximo de usuários<input type="number" min={1} max={10000} step={1} value={maxUsers} onChange={e=>setMaxUsers(e.target.value)} placeholder="Padrão atual"/></label>
 <label>Período padrão de teste em dias<input type="number" min={1} max={90} step={1} value={trialDays} onChange={e=>setTrialDays(e.target.value)} placeholder="Padrão atual"/></label>
 <label className="pa-full-row">Justificativa das permissões<textarea required minLength={10} maxLength={500} value={reason} onChange={e=>setReason(e.target.value)}/></label>
 </fieldset>
 <p>{state.user_count} usuário(s) vinculado(s); limite salvo: {state.max_users??"sem limite"}. Teste padrão salvo: {state.trial_days} dias. Reduzir o limite não remove usuários. O período padrão não reinicia um teste em curso.</p>
 <div className="pa-workshop-actions">{canEdit&&<><button className="pa-primary" disabled={busy}>{busy?"Salvando…":"Salvar permissões"}</button><button type="button" className="pa-quiet" disabled={busy||reason.trim().length<10} onClick={()=>void save(true)}>Restaurar padrões</button></>}<button type="button" className="pa-quiet" disabled={busy} onClick={refresh}>Atualizar permissões</button>{dirty&&<button type="button" className="pa-quiet" disabled={busy} onClick={()=>{if(window.confirm("Descartar alterações de permissões?"))apply(state);}}>Cancelar alterações</button>}</div>
 </form>
 </>}
 {catalogControls}
 </section>;
}
