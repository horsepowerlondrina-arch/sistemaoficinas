import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Activity, ArrowLeft, Check, Clipboard, KeyRound, LockKeyhole, LogOut, Plus, Shield, Users, Wrench } from "lucide-react";
import { PlatformBrand } from "../components/PlatformBrand";
import { PlatformWorkshops } from "../components/PlatformWorkshops";
import "../platform-admin.css";
import {adminRequest as call,adminActionLabel,adminResultLabel,adminReason} from "../lib/adminPresentation";
import {confirmAdminNavigation,useAdminDraft} from "../lib/useAdminDraft";

type Role = "principal" | "finance" | "technical_support" | "commercial";
type Permission = "audit:read" | "administrators:manage" | "platform:settings" | "critical:request" | "critical:approve" | "workshops:read" | "workshops:manage" | "data-transfer:manage" | "modules:manage";
type Admin = { id: string; email: string; name: string; role: Role; permissions: Permission[] };
type Administrator = Admin & { active: boolean; enrolled: boolean; invite_pending: boolean; created_at: string; last_login_at: string | null };
type AuditEvent = { id: string; actor_email: string; action: string; result: string; technical_context: Record<string, unknown>; created_at: string };
const roles: { value: Role; label: string }[] = [
  { value: "principal", label: "Administrador principal" },
  { value: "finance", label: "Financeiro" },
  { value: "technical_support", label: "Suporte técnico" },
  { value: "commercial", label: "Comercial" },
];
const permissions: { value: Permission; label: string }[] = [
  { value: "audit:read", label: "Consultar auditoria" },
  { value: "administrators:manage", label: "Administrar contas" },
  { value: "platform:settings", label: "Configurações da plataforma" },
  { value: "critical:request", label: "Solicitar operação crítica" },
  { value: "critical:approve", label: "Aprovar operação crítica" },
  { value: "workshops:read", label: "Consultar oficinas" },
  { value: "workshops:manage", label: "Cadastrar e editar oficinas" },
  { value: "data-transfer:manage", label: "Transferir dados completos das oficinas" },
  { value: "modules:manage", label: "Gerenciar módulos adicionais das oficinas" },
];
const roleLabel = (value: Role) => roles.find(role => role.value === value)?.label || value;
function randomClientToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, byte => byte.toString(16).padStart(2,"0")).join("");
}
function randomTotpSecret() {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567", bytes = crypto.getRandomValues(new Uint8Array(20));
  let bits = 0, accumulator = 0, result = "";
  for (const byte of bytes) { accumulator = (accumulator << 8) | byte; bits += 8; while (bits >= 5) { result += alphabet[(accumulator >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits) result += alphabet[(accumulator << (5 - bits)) & 31];
  return result;
}
function enrollmentUri(secret: string, email: string) {
  const label = encodeURIComponent(`Sistema Oficinas:${email}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=Sistema%20Oficinas&algorithm=SHA1&digits=6&period=30`;
}

function ErrorNote({ children }: { children: string }) { return children ? <p className="pa-note pa-note--error" role="alert">{children}</p> : null; }

export function PlatformAdmin() {
  const environmentLabel = import.meta.env.DEV ? "Ambiente local" : "Ambiente de homologação";
  const [loginEmail, setLoginEmail] = useState("");
  const [inviteToken, setInviteToken] = useState(() => new URLSearchParams(window.location.hash.replace(/^#/, "")).get("invite") || "");
  const [admin, setAdmin] = useState<Admin | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [section, setSection] = useState<"overview" | "administrators" | "audit" | "workshops">("overview");
  const [enrollment, setEnrollment] = useState<{ secret: string; uri: string } | null>(null);
  const [accounts, setAccounts] = useState<Administrator[]>([]);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [invite, setInvite] = useState("");
  const [copied, setCopied] = useState(false);
  const [newRole, setNewRole] = useState<Role>("finance");
  const [newPermissions, setNewPermissions] = useState<Permission[]>([]);
  const [editing, setEditing] = useState<Record<string, Permission[]>>({});
  const [roleEdits, setRoleEdits] = useState<Record<string, Role>>({});
  const [busy, setBusy] = useState(false);
  const [newAccountDirty,setNewAccountDirty]=useState(false);
  useAdminDraft(newAccountDirty||Object.keys(editing).length>0||Object.keys(roleEdits).length>0||!!invite);
  const navigate=(next:typeof section)=>{if(busy||next===section||!confirmAdminNavigation())return;setSection(next);setError("");setMessage("");setInvite("");setEditing({});setRoleEdits({});setNewAccountDirty(false);};

  useEffect(() => {
    if (inviteToken) { window.history.replaceState(null, "", "/admin"); setReady(true); return; }
    void call<{ administrator: Admin }>("/session").then(value => setAdmin(value.administrator)).catch(() => {}).finally(() => setReady(true));
  }, []);
  useEffect(() => { document.title = "Administração da plataforma · Sistema Oficinas"; return () => { document.title = "Sistema Oficinas"; }; }, []);
  const canManage = admin?.role === "principal" && admin.permissions.includes("administrators:manage");
  const canReadAudit = !!admin?.permissions.includes("audit:read");
  const canReadWorkshops = !!admin?.permissions.includes("workshops:read");
  const canManageWorkshops = !!admin?.permissions.includes("workshops:manage");
  const canTransferWorkshops = !!admin?.permissions.includes("data-transfer:manage");
  const canRequestCritical = !!admin?.permissions.includes("critical:request");
  const canApproveCritical = !!admin?.permissions.includes("critical:approve");
  const loadAccounts = async () => {const values=await call<(Administrator & {display_name?:string})[]>("/administrators");setAccounts(values.map(value=>({...value,name:value.name||value.display_name||"Administrador"})));};
  const loadAudit = async () => setEvents(await call<AuditEvent[]>("/audit?limit=100"));
  useEffect(() => { if (!admin) return; if (section === "administrators" && canManage) void loadAccounts().catch(e => setError(e.message)); if (section === "audit" && canReadAudit) void loadAudit().catch(e => setError(e.message)); }, [section, admin?.id]);

  const login = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setBusy(true); setError("");
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") || "").trim();
    const code = String(form.get("code") || "").trim();
    try { await call("/login", "POST", { email, password: form.get("password"), ...(code ? { code } : {}) }); const next = await call<{ administrator: Admin }>("/session"); setAdmin(next.administrator); setMessage("Acesso autorizado."); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  const beginEnrollment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setBusy(true); setError("");
    const form = new FormData(event.currentTarget);
    try { const secret=randomTotpSecret(); const result=await call<{email:string}>("/enroll/start", "POST", { token: inviteToken, password: form.get("password"), secret }); setEnrollment({secret,uri:enrollmentUri(secret,result.email)}); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  const finishEnrollment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setBusy(true); setError("");
    const form = new FormData(event.currentTarget);
    try { await call("/enroll/confirm", "POST", { token: inviteToken, code: form.get("code") }); setInviteToken(""); setEnrollment(null); setMessage("Conta configurada. Entre com sua senha e seu código autenticador."); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  const logout = async () => {if(busy||!confirmAdminNavigation())return;setBusy(true);try{await call("/logout","POST",{});setAdmin(null);setSection("overview");setInvite("");setEditing({});setRoleEdits({});setNewAccountDirty(false);}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
  const createAccount = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setBusy(true); setError(""); setInvite("");
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    try {
      const rawToken=randomClientToken();
      const result = await call<{ administrator: Administrator; expires_in_minutes: number }>("/administrators", "POST", { name: form.get("name"), email: form.get("email"), role: newRole, permissions: newRole === "principal" ? [...permissions.filter(p => p.value !== "data-transfer:manage").map(p => p.value), ...newPermissions.filter(p => p === "data-transfer:manage")] : newPermissions, setup_token: rawToken });
      setInvite(`${window.location.origin}/admin#invite=${rawToken}`); setMessage(`Convite criado. Válido por ${result.expires_in_minutes} minutos.`); await loadAccounts(); formElement.reset();setNewAccountDirty(false);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  const reissueInvite = async (id: string) => {
    setBusy(true); setError("");
    try { const rawToken=randomClientToken(); const result = await call<{ expires_in_minutes: number }>(`/administrators/${id}/reissue`, "POST", {setup_token:rawToken}); setInvite(`${window.location.origin}/admin#invite=${rawToken}`); setMessage("Novo convite gerado; o anterior foi invalidado."); await loadAccounts(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  const updateAccount = async (account: Administrator, patch: { active?: boolean; role?: Role; permissions?: Permission[] }) => {
    if(patch.active===false&&!window.confirm("Desativar o acesso desta conta administrativa?"))return;
    setBusy(true); setError("");
    try { await call(`/administrators/${account.id}`, "PATCH", patch); await loadAccounts();setEditing(current=>{const next={...current};delete next[account.id];return next;});setRoleEdits(current=>{const next={...current};delete next[account.id];return next;}); setMessage("Dados administrativos atualizados e registrados na auditoria."); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  const copyInvite = async () => { try{await navigator.clipboard.writeText(invite); setCopied(true); setTimeout(() => setCopied(false), 1800);}catch{setError("Não foi possível copiar. Selecione o link e copie manualmente.");} };
  const enrollmentInstructions = useMemo(() => "No aplicativo autenticador, adicione uma conta usando o segredo abaixo. Depois informe o código atual de seis dígitos para concluir.", []);

  if (!ready) return <main className="pa-shell"><div className="pa-loading">Carregando administração…</div></main>;
  if (inviteToken && !admin) return <main className="pa-shell pa-shell--center"><section className="pa-card pa-auth-card"><PlatformBrand /><span className="pa-kicker">Convite administrativo</span><h1>Ativar sua conta</h1>
    {!enrollment ? <form onSubmit={beginEnrollment} className="pa-form"><p>Crie uma senha exclusiva e configure seu segundo fator.</p><label>Senha forte<input required type="password" name="password" minLength={14} autoComplete="new-password" /></label><small>Use pelo menos 14 caracteres. A senha da oficina não vale neste painel.</small><ErrorNote>{error}</ErrorNote><button className="pa-primary" disabled={busy}>{busy ? "Validando…" : "Configurar autenticação"}</button></form> : <><p>{enrollmentInstructions}</p><div className="pa-secret"><small>Segredo TOTP — copie para seu autenticador</small><code>{enrollment.secret}</code><a href={enrollment.uri}>Abrir aplicativo compatível</a></div><form onSubmit={finishEnrollment} className="pa-form"><label>Código autenticador<input required name="code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="one-time-code" /></label><ErrorNote>{error}</ErrorNote><button className="pa-primary" disabled={busy}>Confirmar e ativar conta</button></form></>}
    <ErrorNote>{error}</ErrorNote><a className="pa-back" href="/admin"><ArrowLeft size={16}/> Voltar ao login</a></section></main>;
  if (!admin) return <main className="pa-shell pa-shell--center"><section className="pa-card pa-auth-card"><PlatformBrand /><span className="pa-kicker">Área exclusiva</span><h1>Administração da plataforma</h1><p>Entre com sua conta administrativa, senha e código do aplicativo autenticador.</p><form onSubmit={login} className="pa-form"><label>E-mail<input required type="email" name="email" autoComplete="username" value={loginEmail} onChange={event => setLoginEmail(event.target.value)} /></label><label>Senha<input required type="password" name="password" autoComplete="current-password" /></label><label>Código de duas etapas<input required name="code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="one-time-code" /></label><ErrorNote>{error}</ErrorNote><button className="pa-primary" disabled={busy}>{busy ? "Verificando…" : <><LockKeyhole size={17}/> Entrar no painel central</>}</button></form><p className="pa-private"><Shield size={16}/> Autenticação e sessão separadas do sistema das oficinas.</p>{message && <p className="pa-note">{message}</p>}</section></main>;

  return <main className="pa-shell"><header className="pa-topbar"><PlatformBrand compact /><div className="pa-top-actions"><span className="pa-user"><strong>{admin.name}</strong><small>{roleLabel(admin.role)}</small></span><button className="pa-quiet" onClick={() => void logout()}><LogOut size={17}/> Sair</button></div></header>
    <div className="pa-layout"><aside className="pa-nav"><span className="pa-kicker">Painel central</span><button className={section === "overview" ? "active" : ""} onClick={() => navigate("overview")}><Activity size={18}/> Visão geral</button>{canReadWorkshops && <button className={section === "workshops" ? "active" : ""} onClick={() => navigate("workshops")}><Wrench size={18}/> Oficinas</button>}{canManage && <button className={section === "administrators" ? "active" : ""} onClick={() => navigate("administrators")}><Users size={18}/> Administradores</button>}{canReadAudit && <button className={section === "audit" ? "active" : ""} onClick={() => navigate("audit")}><Shield size={18}/> Auditoria</button>}<div className="pa-nav-divider"/><span className="pa-kicker">Módulos da plataforma</span><span className="pa-planned"><Wrench size={16}/>Catálogo técnico<small>Implementado · em teste</small></span>{["Assinaturas", "Cobranças", "Monitoramento", "Suporte"].map(item => <span key={item} className="pa-planned"><Wrench size={16}/>{item}<small>Em etapa futura</small></span>)}</aside>
      <section className="pa-content"><div className="pa-heading"><div><span className="pa-kicker">Sistema Oficinas</span><h1>{section === "overview" ? "Visão geral" : section === "administrators" ? "Administradores" : section === "workshops" ? "Oficinas" : "Auditoria"}</h1></div><span className="pa-local"><span/> {environmentLabel}</span></div><ErrorNote>{error}</ErrorNote>{message && <p className="pa-note" role="status">{message}</p>}
        {section === "overview" && <><div className="pa-welcome"><div className="pa-welcome-icon"><Shield size={24}/></div><div><h2>Administração da plataforma</h2><p>Área isolada para governar o software. As operações por oficina exigem permissões específicas e são auditadas.</p></div></div><div className="pa-grid"><article className="pa-card"><Users/><span>Contas administrativas</span><strong>{canManage ? accounts.length || "—" : "Acesso controlado"}</strong><small>Perfis com privilégio mínimo</small></article><article className="pa-card"><Shield/><span>Autenticação</span><strong>Autenticação protegida</strong><small>Segundo fator conforme a política do ambiente</small></article><article className="pa-card"><Activity/><span>Auditoria</span><strong>365 dias</strong><small>Eventos imutáveis, sem dados operacionais</small></article></div><p className="pa-footnote">Os planos são gerenciados em Oficinas → selecione a oficina → Acessos e permissões. Assinaturas, cobranças e suporte comercial serão definidos em etapas futuras.</p></>}
        {section === "administrators" && canManage && <div className="pa-admin-columns"><section className="pa-card"><div className="pa-section-title"><div><h2>Contas cadastradas</h2><p>Somente outro administrador principal pode alterar uma conta.</p></div><button className="pa-quiet" disabled={busy} onClick={() => {if(confirmAdminNavigation())void loadAccounts().then(()=>{setEditing({});setRoleEdits({});}).catch(e=>setError(e.message));}}><Users size={16}/> Atualizar</button></div><div className="pa-account-list">{accounts.map(account => <article className="pa-account" key={account.id}><div className="pa-account-head"><div><strong>{account.name}</strong><small>{account.email}</small></div><span className={`pa-status ${account.active ? "is-active" : ""}`}>{account.active ? "Ativa" : account.invite_pending ? "Convite pendente" : "Inativa"}</span></div><p>{roleLabel(account.role)} · {account.enrolled ? "2FA configurado" : "2FA pendente"}</p>{account.id !== admin.id && account.active && <label className="pa-role-editor">Perfil<select value={roleEdits[account.id] || account.role} onChange={event => setRoleEdits({...roleEdits,[account.id]:event.target.value as Role})}>{roles.map(role => <option key={role.value} value={role.value}>{role.label}</option>)}</select><button className="pa-quiet" disabled={busy || !roleEdits[account.id] || roleEdits[account.id]===account.role} onClick={() => { const role=roleEdits[account.id]; void updateAccount(account,{role,permissions:role==="principal"?[...permissions.filter(p=>p.value!=="data-transfer:manage").map(p=>p.value),...(account.permissions.includes("data-transfer:manage")?["data-transfer:manage" as Permission]:[])]:[]}); }}>Salvar perfil</button></label>}{account.id !== admin.id && account.active && account.role === "principal" && <div className="pa-permission-editor"><label><input type="checkbox" checked={editing[account.id]?.includes("data-transfer:manage") ?? account.permissions.includes("data-transfer:manage")} onChange={event => { const current = editing[account.id] || account.permissions; setEditing({ ...editing, [account.id]: event.target.checked ? [...current, "data-transfer:manage"] : current.filter(value => value !== "data-transfer:manage") }); }} />Transferir dados completos das oficinas</label><button className="pa-quiet" disabled={busy} onClick={() => void updateAccount(account,{permissions:editing[account.id] || account.permissions})}>Salvar permissões</button></div>}{account.id !== admin.id && account.active && account.role !== "principal" && <div className="pa-permission-editor">{permissions.map(item => <label key={item.value}><input type="checkbox" checked={editing[account.id]?.includes(item.value) ?? account.permissions.includes(item.value)} onChange={event => { const current = editing[account.id] || account.permissions; setEditing({ ...editing, [account.id]: event.target.checked ? [...current, item.value] : current.filter(value => value !== item.value) }); }} />{item.label}</label>)}<button className="pa-quiet" disabled={busy} onClick={() => void updateAccount(account,{permissions:editing[account.id] || account.permissions})}>Salvar permissões</button></div>}{account.id !== admin.id && <div className="pa-account-actions">{!account.active && !account.enrolled && <button className="pa-quiet" disabled={busy} onClick={() => void reissueInvite(account.id)}><KeyRound size={15}/> Gerar novo convite</button>}<button className="pa-quiet" disabled={busy} onClick={() => void updateAccount(account,{active:!account.active})}>{account.active ? "Desativar conta" : "Ativar conta"}</button></div>}</article>)}{accounts.length === 0 && <p>Nenhuma conta administrativa encontrada.</p>}</div></section>
          <section className="pa-card"><div className="pa-section-title"><div><h2>Convidar administrador</h2><p>O convite expira em 30 minutos e só pode ser usado uma vez.</p></div><Plus size={20}/></div><form onSubmit={createAccount} onChange={()=>setNewAccountDirty(true)} className="pa-form"><label>Nome<input name="name" required minLength={2} maxLength={120}/></label><label>E-mail<input name="email" required type="email" maxLength={254}/></label><label>Perfil<select value={newRole} onChange={e => { setNewRole(e.target.value as Role); setNewPermissions([]); }}>{roles.map(role => <option value={role.value} key={role.value}>{role.label}</option>)}</select></label>{newRole !== "principal" ? <fieldset className="pa-permission-editor"><legend>Permissões explícitas</legend>{permissions.map(item => <label key={item.value}><input type="checkbox" checked={newPermissions.includes(item.value)} onChange={event => setNewPermissions(event.target.checked ? [...newPermissions,item.value] : newPermissions.filter(value=>value!==item.value))}/>{item.label}</label>)}</fieldset> : <fieldset className="pa-permission-editor"><legend>Permissão adicional explícita</legend>{permissions.filter(item => item.value === "data-transfer:manage").map(item => <label key={item.value}><input type="checkbox" checked={newPermissions.includes(item.value)} onChange={event => setNewPermissions(event.target.checked ? [...newPermissions,item.value] : newPermissions.filter(value=>value!==item.value))}/>{item.label}</label>)}</fieldset>}<button className="pa-primary" disabled={busy}><Plus size={16}/> Criar convite</button></form>{invite && <div className="pa-secret"><strong>Link de configuração — copie e entregue à pessoa</strong><code>{invite}</code><button className="pa-quiet" onClick={() => void copyInvite()}>{copied ? <Check size={16}/> : <Clipboard size={16}/>} {copied ? "Copiado" : "Copiar link"}</button><small>O token não pode ser consultado novamente após fechar esta tela.</small></div>}</section></div>}
        {section === "audit" && canReadAudit && <section className="pa-card"><div className="pa-section-title"><div><h2>Eventos administrativos</h2><p>Retenção configurada para 365 dias. Os registros não podem ser alterados pelo painel.</p></div><button className="pa-quiet" disabled={busy} onClick={() => void loadAudit().catch(e=>setError(e.message))}><Activity size={16}/> Atualizar</button></div><div className="pa-audit-list">{events.map(event => <article className="pa-audit-event" key={event.id}><span className={`pa-status ${event.result === "success" ? "is-active" : ""}`}>{adminResultLabel(event.result)}</span><div><strong>{adminActionLabel(event.action)}</strong><small>{event.actor_email || "Sistema"} · {new Date(event.created_at).toLocaleString("pt-BR")}</small><small>Justificativa: {adminReason(event.technical_context)}</small></div></article>)}{events.length === 0 && <p>Ainda não há eventos de auditoria.</p>}</div></section>}
        {section === "workshops" && canReadWorkshops && <PlatformWorkshops canManage={canManageWorkshops} canTransfer={canTransferWorkshops} canRequestCritical={canRequestCritical} canApproveCritical={canApproveCritical} environmentLabel={environmentLabel} />}
      </section>
    </div>
    <footer className="pa-footer"><PlatformBrand compact/><span>Administração central · {import.meta.env.DEV ? "acesso local" : "homologação"}</span></footer>
  </main>;
}
