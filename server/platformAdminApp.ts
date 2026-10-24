import express, { type NextFunction, type Request, type Response } from "express";
import { randomBytes, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { z } from "zod";
import {
  decryptTotpSecret, digestAdminToken, encryptTotpSecret, hashAdminPassword,
  platformPermissions, platformRoles, verifyAdminPassword, verifyTotp,
  writeAdminAudit, type PlatformPermission, type PlatformRole,
} from "./auth/platformAdmin.js";
import { isTestAdminPasswordOnlyLoginAllowed } from "./platformAdminMfa.js";
import { workshopRegistrationSchema, workshopStatusChangeSchema, canManuallyTransitionWorkshop, effectiveWorkshopStatus, workshopStatuses } from "./services/platformWorkshops.js";

const sessionCookie = "hp_platform_session";
const sessionMs = 8 * 60 * 60 * 1000;
const noCache = (_req: Request, res: Response, next: NextFunction) => {
  res.set({ "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "X-Frame-Options": "DENY" }); next();
};
function cookieValue(req: Request) {
  return req.headers.cookie?.split(";").map(x => x.trim()).find(x => x.startsWith(`${sessionCookie}=`))?.slice(sessionCookie.length + 1) || "";
}
function setSessionCookie(res: Response, value: string, clear = false) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader("Set-Cookie", `${sessionCookie}=${value}; Path=/; HttpOnly; SameSite=Strict${secure}${clear ? "; Max-Age=0" : `; Max-Age=${sessionMs / 1000}`}`);
}
function ipHash(req: Request) {
  return digestAdminToken(req.ip || req.socket.remoteAddress || "local").slice(0, 32);
}
function permissionsOf(value: unknown): PlatformPermission[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is PlatformPermission => platformPermissions.includes(item));
}
function validOrigin(req: Request, res: Response) {
  const origin = req.headers.origin;
  const allowed = new Set([
    "http://127.0.0.1:5173",
    "http://localhost:5173",
    process.env.APP_ORIGIN,
    ...(process.env.APP_ORIGINS || "").split(",").map((value) => value.trim()),
  ].filter((value): value is string => Boolean(value)));
  if (origin && !allowed.has(origin)) {
    res.status(403).json({ error: "Origem não autorizada." }); return false;
  }
  return true;
}
type AdminContext = { id: string; email: string; display_name: string; role: PlatformRole; permissions: PlatformPermission[] };
export function createPlatformAdminApp(pool: Pool, encryptionKey: string) {
  const app = express(); app.disable("x-powered-by"); app.use(noCache); app.use(express.json({ limit: "32kb" }));
  app.use("/admin-api", (req, res, next) => { if (!["GET", "HEAD", "OPTIONS"].includes(req.method) && !validOrigin(req, res)) return; next(); });
  const requireSession = async (req: Request, res: Response, next: NextFunction) => {
    const token = cookieValue(req);
    if (!token) { res.status(401).json({ error: "Entre no painel central." }); return; }
    const result = await pool.query(
      `SELECT a.id,a.email,a.display_name,a.role,a.permissions FROM platform_admin.sessions s
       JOIN platform_admin.administrators a ON a.id=s.administrator_id
       WHERE s.token_hash=$1 AND s.expires_at>now() AND a.active=true AND a.enrolled=true`,
      [digestAdminToken(token)],
    );
    if (!result.rowCount) { res.status(401).json({ error: "Entre no painel central." }); return; }
    res.locals.admin = result.rows[0] as AdminContext; next();
  };
  const requirePermission = (permission: PlatformPermission) => (req: Request, res: Response, next: NextFunction) => {
    const admin = res.locals.admin as AdminContext | undefined;
    if (!admin) { res.status(401).json({ error: "Entre no painel central." }); return; }
    if (!permissionsOf(admin.permissions).includes(permission)) { res.status(403).json({ error: "Permissão insuficiente." }); return; }
    next();
  };

  app.post("/admin-api/login", async (req, res) => {
    const input = z.object({ email: z.string().email().max(254), password: z.string().min(1).max(200), code: z.string().regex(/^\d{6}$/).optional() }).safeParse(req.body);
    if (!input.success) { res.status(400).json({ error: "Informe e-mail, senha e código autenticador válidos." }); return; }
    const email = input.data.email.toLowerCase(), key = digestAdminToken(`${ipHash(req)}:${email}`);
    const testPasswordOnlyLogin = !input.data.code && isTestAdminPasswordOnlyLoginAllowed(email, req.hostname);
    if (!input.data.code && !testPasswordOnlyLogin) { res.status(400).json({ error: "Informe e-mail, senha e código autenticador válidos." }); return; }
    const attempt = await pool.query(
      `INSERT INTO platform_admin.login_attempts(attempt_key,count,window_started_at,locked_until)
       VALUES($1,1,now(),NULL) ON CONFLICT(attempt_key) DO UPDATE SET
       count=CASE WHEN platform_admin.login_attempts.window_started_at < now()-interval '5 minutes' THEN 1 ELSE platform_admin.login_attempts.count+1 END,
       window_started_at=CASE WHEN platform_admin.login_attempts.window_started_at < now()-interval '5 minutes' THEN now() ELSE platform_admin.login_attempts.window_started_at END,
       locked_until=CASE WHEN platform_admin.login_attempts.locked_until>now() THEN platform_admin.login_attempts.locked_until
          WHEN platform_admin.login_attempts.window_started_at < now()-interval '5 minutes' THEN NULL
          WHEN platform_admin.login_attempts.count+1>=5 THEN now()+interval '15 minutes' ELSE NULL END
       RETURNING count,locked_until`, [key]);
    const adminResult = await pool.query("SELECT * FROM platform_admin.administrators WHERE email=$1", [email]);
    const account = adminResult.rows[0];
    let accepted = false, failureAction = "admin.login.failed";
    if (account?.active && account.enrolled && (!account.locked_until || new Date(account.locked_until).getTime() <= Date.now())) {
      const passwordOk = verifyAdminPassword(input.data.password, String(account.password_hash));
      if (!passwordOk) failureAction = "admin.login.password_failed";
      else if (testPasswordOnlyLogin) {
        accepted = true;
      } else {
        try {
          const secret = decryptTotpSecret(String(account.totp_secret_ciphertext), encryptionKey);
          accepted = verifyTotp(secret, input.data.code!);
          if (!accepted) failureAction = "admin.login.mfa_failed";
        } catch { accepted = false; failureAction = "admin.login.mfa_failed"; }
      }
    }
    if (attempt.rows[0]?.locked_until && new Date(attempt.rows[0].locked_until).getTime() > Date.now()) accepted = false;
    if (!accepted) {
      if (account) {
        await pool.query("UPDATE platform_admin.administrators SET failed_attempts=failed_attempts+1,locked_until=CASE WHEN failed_attempts+1>=10 THEN now()+interval '15 minutes' ELSE locked_until END WHERE id=$1", [account.id]);
      }
      await writeAdminAudit(pool, { actorId: account?.id, actorEmail: email, action: failureAction, result: attempt.rows[0]?.locked_until ? "blocked" : "failure", technical: { ip_hash: ipHash(req) } });
      setSessionCookie(res, "", true); res.status(attempt.rows[0]?.locked_until ? 429 : 401).json({ error: "E-mail, senha ou código incorretos." }); return;
    }
    const token = randomBytes(32).toString("hex");
    await pool.query("DELETE FROM platform_admin.sessions WHERE expires_at<=now() OR administrator_id=$1", [account.id]);
    await pool.query("INSERT INTO platform_admin.sessions(token_hash,administrator_id,expires_at) VALUES($1,$2,now()+interval '8 hours')", [digestAdminToken(token), account.id]);
    await pool.query("UPDATE platform_admin.administrators SET failed_attempts=0,locked_until=NULL,last_login_at=now() WHERE id=$1", [account.id]);
    await pool.query("DELETE FROM platform_admin.login_attempts WHERE attempt_key=$1", [key]);
    if (testPasswordOnlyLogin) await writeAdminAudit(pool, { actorId: account.id, actorEmail: email, action: "admin.login.mfa_test_bypass", result: "success", technical: { ip_hash: ipHash(req) } });
    await writeAdminAudit(pool, { actorId: account.id, actorEmail: email, action: "admin.login", result: "success", technical: { ip_hash: ipHash(req) } });
    setSessionCookie(res, token); res.json({ ok: true });
  });

  app.post("/admin-api/enroll/start", async (req, res) => {
    const input = z.object({ token: z.string().regex(/^[a-f0-9]{64}$/), password: z.string().min(14).max(200), secret: z.string().regex(/^[A-Z2-7]{32}$/) }).safeParse(req.body);
    if (!input.success) { res.status(400).json({ error: "Use uma senha com pelo menos 14 caracteres e um convite válido." }); return; }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const found = await client.query(`SELECT t.token_hash,t.expires_at,t.started_at,t.used_at,a.id,a.email FROM platform_admin.setup_tokens t
        JOIN platform_admin.administrators a ON a.id=t.administrator_id WHERE t.token_hash=$1 FOR UPDATE OF t,a`, [digestAdminToken(input.data.token)]);
      const row = found.rows[0];
      if (!row || row.used_at || row.started_at || new Date(row.expires_at).getTime() < Date.now()) {
        await client.query("ROLLBACK"); res.status(400).json({ error: "Convite inválido, expirado ou já utilizado." }); return;
      }
      await client.query("UPDATE platform_admin.administrators SET password_hash=$1,totp_secret_ciphertext=$2 WHERE id=$3", [hashAdminPassword(input.data.password), encryptTotpSecret(input.data.secret, encryptionKey), row.id]);
      await client.query("UPDATE platform_admin.setup_tokens SET started_at=now() WHERE token_hash=$1", [row.token_hash]);
      await client.query("COMMIT");
      res.json({ ok: true, email: row.email });
    } catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; } finally { client.release(); }
  });
  app.post("/admin-api/enroll/confirm", async (req, res) => {
    const input = z.object({ token: z.string().regex(/^[a-f0-9]{64}$/), code: z.string().regex(/^\d{6}$/) }).safeParse(req.body);
    if (!input.success) { res.status(400).json({ error: "Convite e código autenticador inválidos." }); return; }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const found = await client.query(`SELECT t.token_hash,t.expires_at,t.started_at,t.used_at,t.failed_attempts,t.created_by,a.id,a.email,a.totp_secret_ciphertext FROM platform_admin.setup_tokens t
        JOIN platform_admin.administrators a ON a.id=t.administrator_id WHERE t.token_hash=$1 FOR UPDATE OF t,a`, [digestAdminToken(input.data.token)]);
      const row = found.rows[0];
      const tokenUsable = !!row && !row.used_at && !!row.started_at && Number(row.failed_attempts) < 10 && new Date(row.expires_at).getTime() >= Date.now();
      let codeValid = false;
      if (tokenUsable) { try { codeValid = verifyTotp(decryptTotpSecret(row.totp_secret_ciphertext, encryptionKey), input.data.code); } catch { codeValid = false; } }
      if (!tokenUsable || !codeValid) {
        if (tokenUsable) {
          await client.query("UPDATE platform_admin.setup_tokens SET failed_attempts=failed_attempts+1,used_at=CASE WHEN failed_attempts+1>=10 THEN now() ELSE used_at END WHERE token_hash=$1", [row.token_hash]);
          await writeAdminAudit(client, { subjectId: row.id, actorEmail: row.email, action: "admin.enrollment.mfa_failed", result: "failure", technical: { ip_hash: ipHash(req) } });
          await client.query("COMMIT");
        } else await client.query("ROLLBACK");
        res.status(400).json({ error: "Código inválido ou convite expirado." }); return;
      }
      await client.query("UPDATE platform_admin.administrators SET active=true,enrolled=true WHERE id=$1", [row.id]);
      await client.query("UPDATE platform_admin.setup_tokens SET used_at=now() WHERE token_hash=$1", [row.token_hash]);
      await client.query("COMMIT");
      await writeAdminAudit(pool, { actorId: row.created_by, subjectId: row.id, action: "admin.enrollment.completed", result: "success" });
      res.json({ ok: true });
    } catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; } finally { client.release(); }
  });

  app.get("/admin-api/session", requireSession, (req, res) => {
    const admin = res.locals.admin as AdminContext;
    res.json({ administrator: { id: admin.id, email: admin.email, name: admin.display_name, role: admin.role, permissions: permissionsOf(admin.permissions) } });
  });
  app.post("/admin-api/logout", requireSession, async (req, res) => {
    const admin = res.locals.admin as AdminContext;
    await pool.query("DELETE FROM platform_admin.sessions WHERE token_hash=$1", [digestAdminToken(cookieValue(req))]);
    await writeAdminAudit(pool, { actorId: admin.id, actorEmail: admin.email, action: "admin.logout", result: "success" });
    setSessionCookie(res, "", true); res.json({ ok: true });
  });
  app.get("/admin-api/administrators", requireSession, requirePermission("administrators:manage"), async (_req, res) => {
    const rows = await pool.query(`SELECT a.id,a.email,a.display_name,a.role,a.permissions,a.active,a.enrolled,a.created_at,a.last_login_at,
      EXISTS(SELECT 1 FROM platform_admin.setup_tokens t WHERE t.administrator_id=a.id AND t.used_at IS NULL AND t.expires_at>now()) AS invite_pending
      FROM platform_admin.administrators a ORDER BY a.created_at`);
    res.json(rows.rows.map((row) => ({ ...row, permissions: permissionsOf(row.permissions) })));
  });
  app.post("/admin-api/administrators", requireSession, requirePermission("administrators:manage"), async (req, res) => {
    const actor = res.locals.admin as AdminContext;
    if (actor.role !== "principal") { res.status(403).json({ error: "Somente o administrador principal pode criar contas." }); return; }
    const input = z.object({ email: z.string().email().max(254), name: z.string().trim().min(2).max(120), role: z.enum(platformRoles), permissions: z.array(z.enum(platformPermissions)).max(platformPermissions.length), setup_token: z.string().regex(/^[a-f0-9]{64}$/) }).safeParse(req.body);
    if (!input.success) { res.status(400).json({ error: "Dados da conta inválidos." }); return; }
    const email = input.data.email.toLowerCase(), id = randomBytes(16).toString("hex"), rawToken = input.data.setup_token;
    const permissions = input.data.role === "principal" ? [...platformPermissions] : [...new Set(input.data.permissions)];
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`INSERT INTO platform_admin.administrators(id,email,display_name,role,permissions) VALUES($1,$2,$3,$4,$5::jsonb)`, [id,email,input.data.name,input.data.role,JSON.stringify(permissions)]);
      await client.query("INSERT INTO platform_admin.setup_tokens(token_hash,administrator_id,created_by,expires_at) VALUES($1,$2,$3,now()+interval '30 minutes')", [digestAdminToken(rawToken),id,actor.id]);
      await writeAdminAudit(client, { actorId: actor.id, subjectId: id, actorEmail: actor.email, action: "admin.account.created", result: "success", technical: { role: input.data.role } });
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK").catch(() => {}); if ((error as { code?: string }).code === "23505") { res.status(409).json({ error: "Já existe uma conta administrativa com esse e-mail." }); return; } throw error; } finally { client.release(); }
    res.status(201).json({ administrator: { id, email, name: input.data.name, role: input.data.role, permissions }, expires_in_minutes: 30 });
  });
  app.post("/admin-api/administrators/:id/reissue", requireSession, requirePermission("administrators:manage"), async (req, res) => {
    const actor = res.locals.admin as AdminContext;
    if (actor.role !== "principal") { res.status(403).json({ error: "Somente o administrador principal pode renovar convites." }); return; }
    const input = z.object({ setup_token: z.string().regex(/^[a-f0-9]{64}$/) }).safeParse(req.body);
    if (!input.success) { res.status(400).json({ error: "Novo convite inválido." }); return; }
    const token = input.data.setup_token, tokenHash = digestAdminToken(token), id = String(req.params.id);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const target = await client.query("SELECT id,email,active,enrolled FROM platform_admin.administrators WHERE id=$1 FOR UPDATE", [id]);
      if (!target.rowCount || target.rows[0].active || target.rows[0].enrolled || id === actor.id) { await client.query("ROLLBACK"); res.status(409).json({ error: "Esta conta não pode receber um novo convite." }); return; }
      await client.query("UPDATE platform_admin.setup_tokens SET used_at=now() WHERE administrator_id=$1 AND used_at IS NULL", [id]);
      await client.query("UPDATE platform_admin.administrators SET password_hash='',totp_secret_ciphertext='' WHERE id=$1", [id]);
      await client.query("INSERT INTO platform_admin.setup_tokens(token_hash,administrator_id,created_by,expires_at) VALUES($1,$2,$3,now()+interval '30 minutes')", [tokenHash,id,actor.id]);
      await writeAdminAudit(client, { actorId: actor.id, subjectId: id, actorEmail: actor.email, action: "admin.invitation.renewed", result: "success" });
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; } finally { client.release(); }
    res.json({ ok: true, expires_in_minutes: 30 });
  });
  app.patch("/admin-api/administrators/:id", requireSession, requirePermission("administrators:manage"), async (req, res) => {
    const actor = res.locals.admin as AdminContext, id = String(req.params.id);
    if (actor.role !== "principal" || actor.id === id) { res.status(403).json({ error: "Ação exclusiva de outro administrador principal." }); return; }
    const input = z.object({ active: z.boolean().optional(), role: z.enum(platformRoles).optional(), permissions: z.array(z.enum(platformPermissions)).max(platformPermissions.length).optional() }).strict().safeParse(req.body);
    if (!input.success || !Object.keys(input.data || {}).length) { res.status(400).json({ error: "Alteração de conta inválida." }); return; }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const target = await client.query("SELECT id,email,role,permissions,active,enrolled FROM platform_admin.administrators WHERE id=$1 FOR UPDATE", [id]);
      if (!target.rowCount) { await client.query("ROLLBACK"); res.status(404).json({ error: "Administrador não encontrado." }); return; }
      const previous = target.rows[0], nextRole = input.data.role || previous.role;
      if (input.data.active === false && previous.role === "principal") {
        const principals = await client.query("SELECT count(*)::int AS count FROM platform_admin.administrators WHERE role='principal' AND active=true AND enrolled=true");
        if (principals.rows[0].count <= 1) { await client.query("ROLLBACK"); res.status(409).json({ error: "Mantenha ao menos um administrador principal ativo." }); return; }
      }
      const nextPermissions = nextRole === "principal" ? [...platformPermissions] : (input.data.permissions ?? permissionsOf(previous.permissions));
      await client.query(`UPDATE platform_admin.administrators SET active=COALESCE($1,active),role=$2,permissions=$3::jsonb WHERE id=$4`, [input.data.active ?? null,nextRole,JSON.stringify(nextPermissions),id]);
      if (input.data.active === false) await client.query("DELETE FROM platform_admin.sessions WHERE administrator_id=$1", [id]);
      const action = input.data.active !== undefined ? "admin.account.status_changed" : "admin.permissions.changed";
      await writeAdminAudit(client, { actorId: actor.id, subjectId: id, actorEmail: actor.email, action, result: "success", technical: { role: nextRole, active: input.data.active ?? previous.active, permissions: nextPermissions.join(",") } });
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; } finally { client.release(); }
    res.json({ ok: true });
  });
  app.get("/admin-api/workshops", requireSession, requirePermission("workshops:read"), async (req, res) => {
    const search = z.string().trim().max(120).catch("").parse(req.query.search);
    const status = z.enum(["all", ...workshopStatuses]).catch("all").parse(req.query.status);
    const page = z.coerce.number().int().min(1).max(100000).catch(1).parse(req.query.page);
    const pageSize = z.coerce.number().int().min(1).max(100).catch(25).parse(req.query.page_size);
    const rows = await pool.query("SELECT * FROM platform_admin.workshop_directory($1,$2,$3,$4,NULL)", [search,status,pageSize,(page-1)*pageSize]);
    res.json({ items: rows.rows, page, page_size: pageSize, total: Number(rows.rows[0]?.total_count || 0) });
  });
  app.get("/admin-api/workshops/:id/history", requireSession, requirePermission("workshops:read"), async (req, res) => {
    const tenantId = String(req.params.id);
    const rows = await pool.query(`SELECT id,actor_administrator_id,actor_email,action,result,technical_context,created_at
      FROM platform_admin.audit_events WHERE subject_tenant_id=$1 ORDER BY created_at DESC LIMIT 100`, [tenantId]);
    res.json(rows.rows);
  });
  app.get("/admin-api/workshops/:id", requireSession, requirePermission("workshops:read"), async (req, res) => {
    const tenantId = String(req.params.id);
    const rows = await pool.query("SELECT * FROM platform_admin.workshop_directory('','all',1,0,$1)", [tenantId]);
    if (!rows.rowCount) { res.status(404).json({ error: "Oficina não encontrada." }); return; }
    res.json(rows.rows[0]);
  });
  app.post("/admin-api/workshops", requireSession, requirePermission("workshops:manage"), async (req, res) => {
    const input = workshopRegistrationSchema.safeParse(req.body);
    if (!input.success) { res.status(400).json({ error: "Confira os dados cadastrais da oficina." }); return; }
    const actor = res.locals.admin as AdminContext, tenantId = randomUUID();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT platform_admin.create_workshop_admin($1,$2,$3,$4,$5,$6,$7)",
        [tenantId,input.data.name,input.data.responsible_name,input.data.responsible_email.toLowerCase(),input.data.phone,input.data.document,actor.id]);
      await writeAdminAudit(client, { actorId:actor.id, actorEmail:actor.email, subjectTenantId:tenantId,
        action:"admin.workshop.created", result:"success", technical:{ status:"pending_verification", source:"admin" } });
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(()=>{});
      if ((error as {code?:string}).code === "23505") { res.status(409).json({ error: "E-mail, CPF ou CNPJ já cadastrado." }); return; }
      throw error;
    } finally { client.release(); }
    res.status(201).json({ tenant_id:tenantId, status:"pending_verification" });
  });
  app.put("/admin-api/workshops/:id", requireSession, requirePermission("workshops:manage"), async (req, res) => {
    const input = workshopRegistrationSchema.safeParse(req.body);
    if (!input.success) { res.status(400).json({ error: "Confira os dados cadastrais da oficina." }); return; }
    const actor = res.locals.admin as AdminContext, tenantId = String(req.params.id), client = await pool.connect();
    try {
      await client.query("BEGIN");
      const updated = await client.query("SELECT platform_admin.update_workshop_admin($1,$2,$3,$4,$5,$6) AS updated",
        [tenantId,input.data.name,input.data.responsible_name,input.data.responsible_email.toLowerCase(),input.data.phone,input.data.document]);
      if (!updated.rows[0]?.updated) { await client.query("ROLLBACK"); res.status(404).json({ error:"Oficina não encontrada ou não gerenciada pelo painel." }); return; }
      await writeAdminAudit(client,{actorId:actor.id,actorEmail:actor.email,subjectTenantId:tenantId,action:"admin.workshop.updated",result:"success",technical:{fields:"name,responsible_name,responsible_email,phone,document"}});
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(()=>{});
      if ((error as {code?:string}).code === "23505") { res.status(409).json({ error:"E-mail, CPF ou CNPJ já cadastrado." }); return; }
      throw error;
    } finally { client.release(); }
    res.json({ ok:true });
  });
  app.patch("/admin-api/workshops/:id/status", requireSession, requirePermission("workshops:manage"), async (req, res) => {
    const input = workshopStatusChangeSchema.safeParse(req.body);
    if (!input.success) { res.status(400).json({ error:"Informe uma situação manual permitida e uma justificativa." }); return; }
    const actor = res.locals.admin as AdminContext, tenantId = String(req.params.id), client = await pool.connect();
    try {
      await client.query("BEGIN");
      const current = await client.query("SELECT status,trial_ends_at FROM platform_admin.workshops WHERE tenant_id=$1 FOR UPDATE",[tenantId]);
      if (!current.rowCount) { await client.query("ROLLBACK"); res.status(404).json({ error:"Oficina gerenciada não encontrada." }); return; }
      const from = effectiveWorkshopStatus(current.rows[0].status,current.rows[0].trial_ends_at);
      if (!canManuallyTransitionWorkshop(from,input.data.status)) { await client.query("ROLLBACK"); res.status(409).json({ error:"Transição indisponível. Teste, assinatura e tolerância dependem de confirmação ou cobrança." }); return; }
      const changed = await client.query("SELECT platform_admin.set_workshop_status_admin($1,$2,$3,$4) AS previous_status",[tenantId,input.data.status,input.data.reason,actor.id]);
      await writeAdminAudit(client,{actorId:actor.id,actorEmail:actor.email,subjectTenantId:tenantId,action:"admin.workshop.status_changed",result:"success",technical:{from:changed.rows[0].previous_status,to:input.data.status,reason:input.data.reason}});
      await client.query("COMMIT");
    } catch(error) { await client.query("ROLLBACK").catch(()=>{}); throw error; }
    finally { client.release(); }
    res.json({ok:true});
  });
  app.get("/admin-api/audit", requireSession, requirePermission("audit:read"), async (req, res) => {
    const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 100));
    const rows = await pool.query(`SELECT id,actor_administrator_id,subject_administrator_id,actor_email,action,result,technical_context,created_at
      FROM platform_admin.audit_events ORDER BY created_at DESC LIMIT $1`, [limit]);
    res.json(rows.rows);
  });
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error("Falha na API de administração central.");
    if (!res.headersSent) res.status(500).json({ error: "Não foi possível concluir a operação." });
  });
  return app;
}

export async function assertPlatformAdminDatabase(pool: Pool) {
  const result = await pool.query(`SELECT current_user AS role,
    rolsuper,rolcreaterole,rolcreatedb,rolbypassrls,
    has_schema_privilege(current_user,'platform_admin','USAGE') AS admin_schema,
    has_schema_privilege(current_user,'horse_power','USAGE') AS workshop_schema,
    has_schema_privilege(current_user,'service_catalog','USAGE') AS catalog_schema
    FROM pg_roles WHERE rolname=current_user`);
  const role = result.rows[0];
  if (!role || role.role !== "hp_platform_admin_app" || role.rolsuper || role.rolcreaterole || role.rolcreatedb || role.rolbypassrls || !role.admin_schema || role.workshop_schema || role.catalog_schema)
    throw new Error("O painel central exige papel restrito ao schema administrativo local.");
  return role;
}
