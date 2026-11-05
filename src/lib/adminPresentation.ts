export const workshopTabs = [
  ["general", "Dados gerais"], ["access", "Acessos e permissões"],
  ["users", "Usuários"], ["invitations", "Convites"], ["history", "Histórico"],
  ["transfer", "Transferência de dados"],
] as const;
export type WorkshopTab = typeof workshopTabs[number][0];

export const plannedWorkshopPlans = [
  { code: "basic", label: "Básico", users: 2, description: "Atendimento, cadastros, orçamentos, OS, checklists e configurações essenciais." },
  { code: "professional", label: "Profissional", users: 5, description: "Básico, estoque, fornecedores, financeiro e consulta externa de placas." },
  { code: "premium", label: "Premium", users: 10, description: "Profissional e Catálogo Técnico de Tempos." },
] as const;
const actions: Record<string,string> = {
 "admin.stripe.price_changed":"Preço mensal atualizado",
 "stripe.checkout.prepared":"Pagamento da assinatura preparado",
 "stripe.payment.reconciled":"Pagamento da assinatura conferido",
 "stripe.payment.revoked":"Pagamento estornado ou contestado",
 "stripe.subscription.cancel_requested":"Renovação da assinatura cancelada",
 "admin.workshop.created":"Oficina cadastrada", "admin.workshop.updated":"Dados cadastrais atualizados",
 "admin.workshop.status_changed":"Situação de acesso alterada", "admin.workshop.membership_changed":"Vínculo de usuário alterado",
 "admin.workshop.entitlements_changed":"Permissões e limites alterados",
 "admin.workshop.plan_changed":"Plano comercial alterado",
 "admin.catalog_access.enabled":"Catálogo técnico habilitado", "admin.catalog_access.disabled":"Catálogo técnico desabilitado",
 "admin.catalog_access.granted":"Catálogo técnico autorizado", "admin.catalog_access.revoked":"Catálogo técnico revogado",
 "admin.catalog_access.renewed":"Validade do catálogo renovada",
 "admin.workshop.invitation_sent":"Convite enviado", "admin.workshop.invitation_failed":"Falha no envio do convite",
 "admin.workshop.manual_activation_link_created":"Link manual de ativação gerado",
 "admin.workshop.activated":"Ativação concluída",
 "admin.workshop.invitation.created":"Convite de ativação preparado",
 "admin.workshop.invitation.manual_link_created":"Link manual de ativação gerado",
 "admin.workshop.entitlements.updated":"Permissões e limites alterados",
 "admin.account.created":"Conta administrativa criada",
 "admin.account.updated":"Conta administrativa atualizada",
 "admin.invitation.renewed":"Convite administrativo renovado",
 "admin.enrollment.completed":"Ativação administrativa concluída",
 "admin.enrollment.mfa_failed":"Verificação de segundo fator recusada",
 "admin.login.mfa_test_bypass":"Entrada da conta de teste conforme política do ambiente",
 "admin.login":"Entrada no painel", "admin.logout":"Saída do painel",
};
export function adminActionLabel(action:string) {
 return actions[action] || (action.includes("invitation") ? "Convite de ativação atualizado" :
 action.includes("entitlement") ? "Permissões e limites alterados" :
 action.includes("activation") ? "Ativação da oficina atualizada" :
 action.includes("data_transfer") ? "Operação de transferência de dados" : "Alteração administrativa");
}
export function adminResultLabel(result:string) {
 return ({success:"Concluída",failure:"Falhou",denied:"Negada",pending:"Pendente"} as Record<string,string>)[result] || "Registrada";
}
export function adminReason(context:Record<string,unknown> | null | undefined) {
 return typeof context?.reason === "string" ? context.reason : "Justificativa não registrada neste evento.";
}
export function optionalWholeNumber(value:string, max:number):number|null {
 if (!value.trim()) return null;
 const number=Number(value);
 if(!Number.isInteger(number)||number<1||number>max) throw new Error(`Informe um número inteiro entre 1 e ${max}.`);
 return number;
}
export function localDateInput(value:string|null) {
 if(!value) return "";
 const date=new Date(value);if(!Number.isFinite(date.getTime()))return "";
 return new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,16);
}
export async function adminRequest<T>(path:string,method="GET",body?:unknown):Promise<T> {
 let response:Response;
 try { response=await fetch(`/admin-api${path}`,{method,credentials:"same-origin",
 ...(body===undefined?{}:{headers:{"Content-Type":"application/json"},body:JSON.stringify(body)})}); }
 catch {throw new Error("Não foi possível conectar ao painel. Verifique a conexão e tente novamente.");}
 const result=await response.json().catch(()=>null);
 if(!response.ok) {
  if(response.status===401)throw new Error("Sua sessão expirou. Entre novamente no painel.");
  if(response.status===403)throw new Error("Sua conta não tem permissão para esta ação.");
  throw new Error(typeof result?.error==="string"?result.error:"Não foi possível concluir a operação. Tente novamente.");
 }
 if(result===null)throw new Error("O servidor retornou uma resposta inválida. Atualize e tente novamente.");
 return result as T;
}
