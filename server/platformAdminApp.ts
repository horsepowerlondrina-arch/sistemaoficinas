import { plateLookupStatus } from "./services/vehicleLookup.js";
import express, { type NextFunction, type Request, type Response } from "express";
import { randomBytes, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { z } from "zod";
import {
  decryptTotpSecret, digestAdminToken, encryptTotpSecret, hashAdminPassword,
  platformPermissions, platformRoles, verifyAdminPassword, verifyTotp,
  writeAdminAudit, type PlatformPermission, type PlatformRole,
} from "./auth/platformAdmin.js";
import { hashPassword } from "./auth/session.js";
import { isTestAdminPasswordOnlyLoginAllowed } from "./platformAdminMfa.js";
import { catalogHomologationProjectId } from "./catalogHomologation.js";
import { workshopRegistrationSchema, workshopStatusChangeSchema, workshopStatuses } from "./services/platformWorkshops.js";
import { newWorkshopActivationId, newWorkshopActivationToken, sendWorkshopActivationEmail, workshopActivationTtlHours, workshopActivationUrl } from "./services/workshopActivation.js";
import { createPlatformAdminDataTransferRoutes } from "./platformAdminDataTransferRoutes.js";
import type { PlatformAdminDataTransfer } from "./services/platformAdminDataTransfer.js";

const sessionCookie = "hp_platform_session";
const sessionMs = 8 * 60 * 60 * 1000;
const baselinePrincipalPermissions = platformPermissions.filter(permission => permission !== "data-transfer:manage");
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

type InvitationView = {
  invitation_status: "none" | "pending" | "sent" | "failed" | "expired" | "cancelled" | "activated" | "manual_link_created";
  invitation_expires_at: Date | null;
  invitation_sent_at: Date | null;
};

function maskedEmail(value: string) {
  const [local = "", domain = ""] = value.split("@");
  return `${local.slice(0, 1)}***@${domain}`;
}

async function invitationViews(pool: Pool, tenantIds: string[]) {
  if (!tenantIds.length) return new Map<string, InvitationView>();
  const result = await pool.query(`SELECT DISTINCT ON (i.tenant_id) i.tenant_id,i.delivery_status,i.expires_at,i.sent_at,i.used_at,i.revoked_at,
      EXISTS (SELECT 1 FROM platform_admin.audit_events a
        WHERE a.subject_tenant_id=i.tenant_id AND a.action='admin.workshop.invitation.manual_link_created'
          AND a.technical_context->>'invite_id'=i.id) AS manual_link_created
    FROM platform_admin.workshop_activation_invites i WHERE i.tenant_id=ANY($1::text[])
    ORDER BY i.tenant_id,i.created_at DESC,i.id DESC`, [tenantIds]);
  const views = new Map<string, InvitationView>();
  for (const row of result.rows) {
    const expired = row.used_at === null && row.revoked_at === null && new Date(row.expires_at).getTime() <= Date.now();
    const invitation_status = row.used_at ? "activated" : row.revoked_at ? "cancelled" : expired ? "expired"
      : row.manual_link_created ? "manual_link_created" : row.delivery_status;
    views.set(String(row.tenant_id), {
      invitation_status,
      invitation_expires_at: row.expires_at,
      invitation_sent_at: row.sent_at,
    });
  }
  return views;
}

type PreparedWorkshopInvitation = {
  status: 200;
  inviteId: string;
  token: string;
  expiresAt: Date;
  workshop: { name: string; responsible_email: string };
} | { status: 404 } | { status: 409 } | { status: 429 };

async function prepareWorkshopInvitation(
  pool: Pool, tenantId: string, actor: AdminContext,
  verificationMethod?: "phone" | "in_person" | "video_call" | "other",
): Promise<PreparedWorkshopInvitation> {
  const token = newWorkshopActivationToken();
  const inviteId = newWorkshopActivationId();
  const expiresAt = new Date(Date.now() + workshopActivationTtlHours * 60 * 60 * 1000);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Serialize invitation creation without requiring UPDATE privilege on platform_admin.workshops.
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [tenantId]);
    const found = await client.query(`SELECT name,responsible_email,source,status,email_verified_at,trial_started_at
      FROM platform_admin.workshops WHERE tenant_id=$1`, [tenantId]);
    const workshop = found.rows[0] as { name: string; responsible_email: string; source: string; status: string; email_verified_at: Date | null; trial_started_at: Date | null } | undefined;
    if (!workshop || workshop.source !== "admin") {
      await client.query("ROLLBACK");
      return { status: 404 };
    }
    if (workshop.status !== "pending_verification" || workshop.email_verified_at || workshop.trial_started_at) {
      await client.query("ROLLBACK");
      return { status: 409 };
    }
    const recent = await client.query(`SELECT 1 FROM platform_admin.workshop_activation_invites
      WHERE tenant_id=$1 AND delivery_status IN ('pending','sent','failed') AND created_at>now()-interval '1 minute'
      ORDER BY created_at DESC LIMIT 1`, [tenantId]);
    if (recent.rowCount) {
      await client.query("ROLLBACK");
      return { status: 429 };
    }
    await client.query(`UPDATE platform_admin.workshop_activation_invites SET revoked_at=now(),delivery_status='revoked'
      WHERE tenant_id=$1 AND used_at IS NULL AND revoked_at IS NULL`, [tenantId]);
    await client.query(`INSERT INTO platform_admin.workshop_activation_invites
      (id,tenant_id,token_hash,responsible_email,created_by_admin_id,expires_at,delivery_status)
      VALUES($1,$2,$3,lower($4),$5,$6,'pending')`, [inviteId,tenantId,digestAdminToken(token),workshop.responsible_email,actor.id,expiresAt]);
    await writeAdminAudit(client, { actorId:actor.id, actorEmail:actor.email, subjectTenantId:tenantId,
      action:"admin.workshop.invitation.created", result:"success", technical:{ invite_id:inviteId, expires_at:expiresAt.toISOString() } });
    if (verificationMethod) {
      await writeAdminAudit(client, { actorId:actor.id, actorEmail:actor.email, subjectTenantId:tenantId,
        action:"admin.workshop.invitation.manual_link_created", result:"success",
        technical:{ invite_id:inviteId, identity_verified:true, verification_method:verificationMethod, expires_at:expiresAt.toISOString() } });
    }
    await client.query("COMMIT");
    return { status:200, inviteId, token, expiresAt, workshop: { name:workshop.name, responsible_email:workshop.responsible_email } };
  } catch (error) {
    await client.query("ROLLBACK").catch(()=>{});
    throw error;
  } finally { client.release(); }
}

async function sendWorkshopInvitation(pool: Pool, tenantId: string, actor: AdminContext) {
  const prepared = await prepareWorkshopInvitation(pool, tenantId, actor);
  if (prepared.status !== 200) return prepared;

  let deliveryStatus: "sent" | "failed" = "sent";
  try {
    await sendWorkshopActivationEmail({
      inviteId:prepared.inviteId, token:prepared.token, email:prepared.workshop.responsible_email,
      workshopName:prepared.workshop.name, expiresAt:prepared.expiresAt,
    });
  } catch {
    deliveryStatus = "failed";
  }
  const sentAt = deliveryStatus === "sent" ? new Date() : null;
  await pool.query(`UPDATE platform_admin.workshop_activation_invites
    SET delivery_status=$1,sent_at=$2 WHERE id=$3`, [deliveryStatus,sentAt,prepared.inviteId]);
  await writeAdminAudit(pool, { actorId:actor.id, actorEmail:actor.email, subjectTenantId:tenantId,
    action:deliveryStatus === "sent" ? "admin.workshop.invitation.sent" : "admin.workshop.invitation.delivery_failed",
    result:deliveryStatus === "sent" ? "success" : "failure",
    technical:{ reason:deliveryStatus === "sent" ? "accepted_by_provider" : "provider_unavailable_or_rejected" } });
  return { status:200 as const, invitation_status:deliveryStatus, invitation_expires_at:prepared.expiresAt, invitation_sent_at:sentAt };
}

function approvedActivationOrigin(req: Request) {
  const origin = req.headers.origin;
  if (!origin) return null;
  const allowed = new Set([
    "http://127.0.0.1:5173", "http://localhost:5173",
    process.env.APP_ORIGIN,
    ...(process.env.APP_ORIGINS || "").split(",").map(value => value.trim()),
  ].filter((value): value is string => Boolean(value)));
  if (!allowed.has(origin)) return null;
  try {
    const parsed = new URL(origin);
    if (parsed.origin !== origin || parsed.username || parsed.password
      || (parsed.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(parsed.hostname))) return null;
  } catch {
    return null;
  }
  return origin;
}
export function createPlatformAdminApp(pool: Pool, encryptionKey: string, transfer?: PlatformAdminDataTransfer) {
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

  app.use(createPlatformAdminDataTransferRoutes(pool, transfer, requireSession, requirePermission));

  const activationFailure = async (tokenHash: string) => {
    const result = await pool.query(`SELECT used_at,revoked_at,expires_at
      FROM platform_admin.workshop_activation_invites WHERE token_hash=$1`, [tokenHash]);
    const row = result.rows[0];
    if (!row) return "Convite inválido.";
    if (row.used_at) return "Este convite já foi utilizado.";
    if (row.revoked_at) return "Este convite foi cancelado ou substituído.";
    if (new Date(row.expires_at).getTime() <= Date.now()) return "Este convite expirou. Solicite um novo convite ao administrador.";
    return "Este convite não está disponível para ativação.";
  };
  app.post("/admin-api/workshop-activation/validate", async (req, res) => {
    const input = z.object({ token:z.string().regex(/^[a-f0-9]{64}$/) }).strict().safeParse(req.body);
    if (!input.success) { res.status(400).json({ error:"Convite inválido ou expirado." }); return; }
    const result = await pool.query(`SELECT * FROM platform_admin.inspect_workshop_activation($1)`, [digestAdminToken(input.data.token)]);
    const row = result.rows[0];
    if (!row?.valid) { res.status(400).json({ error:await activationFailure(digestAdminToken(input.data.token)) }); return; }
    res.json({ workshop_name:row.workshop_name, masked_email:maskedEmail(String(row.responsible_email)), account_exists:!!row.account_exists, expires_at:row.expires_at });
  });

  app.post("/admin-api/workshop-activation/complete", async (req, res) => {
    const input = z.object({ token:z.string().regex(/^[a-f0-9]{64}$/), password:z.string().min(12).max(200).optional() }).strict().safeParse(req.body);
    if (!input.success) { res.status(400).json({ error:"Convite inválido ou expirado." }); return; }
    const tokenHash = digestAdminToken(input.data.token);
    const preview = await pool.query(`SELECT valid,account_exists FROM platform_admin.inspect_workshop_activation($1)`, [tokenHash]);
    if (!preview.rows[0]?.valid) { res.status(400).json({ error:await activationFailure(tokenHash) }); return; }
    if (!preview.rows[0].account_exists && !input.data.password) {
      res.status(400).json({ error:"Defina uma senha com pelo menos 12 caracteres." }); return;
    }
    const sessionToken = randomBytes(32).toString("hex");
    try {
      const client = await pool.connect();
      let row: Record<string,unknown> | undefined;
      try {
        await client.query("BEGIN");
        const homologationProjectId = catalogHomologationProjectId(req.hostname);
        await client.query("SELECT set_config('app.vercel_project_id',$1,true),set_config('app.vercel_env',$2,true)",
          [homologationProjectId || "", homologationProjectId ? process.env.VERCEL_ENV || "" : ""]);
        row = (await client.query(`SELECT * FROM platform_admin.complete_workshop_activation($1,$2,$3,$4,$5,$6)`, [
          tokenHash,randomUUID(),!preview.rows[0].account_exists ? hashPassword(input.data.password!) : "",
          digestAdminToken(sessionToken),Date.now()+86400000,randomUUID(),
        ])).rows[0];
        await client.query("COMMIT");
      } catch(error) {
        await client.query("ROLLBACK").catch(()=>{});
        throw error;
      } finally { client.release(); }
      if (!row?.activated) { res.status(400).json({ error:"Convite inválido, expirado ou já utilizado." }); return; }
      if (row.account_created) res.cookie("hp_session",sessionToken,{ httpOnly:true,sameSite:"strict",secure:process.env.NODE_ENV === "production",maxAge:86400000,path:"/" });
      res.json({ account_created:!!row.account_created, tenant_id:row.tenant_id });
    } catch (error) {
      if ((error as {code?:string}).code === "23505") { res.status(409).json({ error:"Este e-mail já possui um vínculo operacional incompatível com proprietário. Contate a administração." }); return; }
      if ((error as {code?:string}).code === "22023") { res.status(400).json({ error:"Defina uma senha com pelo menos 12 caracteres." }); return; }
      throw error;
    }
  });

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
    const permissions = input.data.role === "principal" ? [...baselinePrincipalPermissions, ...(input.data.permissions.includes("data-transfer:manage") ? ["data-transfer:manage" as PlatformPermission] : [])] : [...new Set(input.data.permissions)];
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
      const requestedPermissions = input.data.permissions ?? permissionsOf(previous.permissions);
      const keepTransferPermission = input.data.permissions === undefined ? permissionsOf(previous.permissions).includes("data-transfer:manage") : requestedPermissions.includes("data-transfer:manage");
      const nextPermissions = nextRole === "principal" ? [...baselinePrincipalPermissions, ...(keepTransferPermission ? ["data-transfer:manage" as PlatformPermission] : [])] : [...new Set(requestedPermissions)];
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
    const invitations = await invitationViews(pool, rows.rows.map(row => String(row.tenant_id)));
    const items = rows.rows.map(row => ({ ...row, ...(invitations.get(String(row.tenant_id)) || { invitation_status:"none", invitation_expires_at:null, invitation_sent_at:null }) }));
    res.json({ items, page, page_size: pageSize, total: Number(rows.rows[0]?.total_count || 0) });
  });
  app.get("/admin-api/workshops/:id/invitations", requireSession, requirePermission("workshops:read"), async (req, res) => {
    const tenantId = String(req.params.id);
    const workshop = await pool.query("SELECT source FROM platform_admin.workshops WHERE tenant_id=$1", [tenantId]);
    if (!workshop.rowCount || workshop.rows[0].source !== "admin") {
      res.status(404).json({ error:"Oficina administrada não encontrada." }); return;
    }
    const result = await pool.query(`SELECT i.id,i.created_at,i.expires_at,i.sent_at,i.used_at,i.revoked_at,i.delivery_status,
      EXISTS (SELECT 1 FROM platform_admin.audit_events a
        WHERE a.subject_tenant_id=i.tenant_id AND a.action='admin.workshop.invitation.manual_link_created'
        AND a.technical_context->>'invite_id'=i.id) AS manual_link_created
      FROM platform_admin.workshop_activation_invites i WHERE i.tenant_id=$1
      ORDER BY i.created_at DESC,i.id DESC LIMIT 50`, [tenantId]);
    res.json(result.rows.map(row => ({
      id:row.id, created_at:row.created_at, expires_at:row.expires_at, sent_at:row.sent_at,
      status:row.used_at ? "activated" : row.revoked_at ? "cancelled" :
        new Date(row.expires_at).getTime() <= Date.now() ? "expired" :
        row.manual_link_created ? "manual_link_created" : row.delivery_status,
    })));
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
    const invitations = await invitationViews(pool, [tenantId]);
    const catalogAccess = permissionsOf((res.locals.admin as AdminContext).permissions).includes("modules:manage")
      ? (await pool.query("SELECT * FROM platform_admin.catalog_access_status($1)",[tenantId])).rows[0]
      : undefined;
    res.json({ ...rows.rows[0], ...(catalogAccess ? { catalog_access:catalogAccess } : {}), ...(invitations.get(tenantId) || { invitation_status:"none", invitation_expires_at:null, invitation_sent_at:null }) });
  });
  app.get("/admin-api/workshops/:id/users", requireSession, requirePermission("workshops:read"), async (req,res) => {
    const token=cookieValue(req); if(!token){res.status(401).json({error:"Entre no painel central."});return;}
    try{
      const result=await pool.query("SELECT * FROM platform_admin.workshop_member_directory($1,$2)",[String(req.params.id),digestAdminToken(token)]);
      res.json({items:result.rows});
    }catch(error){const code=(error as {code?:string}).code;if(code==="P0002"){res.status(404).json({error:"Oficina não encontrada."});return;}if(code==="42501"){res.status(403).json({error:"Permissão administrativa insuficiente."});return;}throw error;}
  });
  app.patch("/admin-api/workshops/:id/users/:userId", requireSession, requirePermission("workshops:manage"), async (req,res) => {
    const input=z.object({action:z.enum(["set_role","remove"]),role:z.enum(["owner","operator"]).nullable(),reason:z.string().trim().min(10).max(500)}).strict().safeParse(req.body);
    if(!input.success||(input.success&&input.data.action==="set_role"&&!input.data.role)||(input.success&&input.data.action==="remove"&&input.data.role!==null)){res.status(400).json({error:"Informe a operação e uma justificativa válida."});return;}
    const token=cookieValue(req);if(!token){res.status(401).json({error:"Entre no painel central."});return;}
    const tenantId=String(req.params.id),client=await pool.connect();
    try{
      await client.query("BEGIN");
      const result=await client.query("SELECT platform_admin.manage_workshop_membership($1,$2,$3,$4,$5,$6) AS change",
        [tenantId,digestAdminToken(token),String(req.params.userId),input.data.action,input.data.role,input.data.reason]);
      const detail=result.rows[0]?.change||{};
      await client.query("COMMIT");res.json({ok:true,...detail});
    }catch(error){
      await client.query("ROLLBACK").catch(()=>{});const code=(error as {code?:string}).code;
      if(code==="P0002"){res.status(404).json({error:"Vínculo da oficina não encontrado."});return;}
      if(code==="42501"){res.status(403).json({error:"Permissão administrativa insuficiente."});return;}
      if(code==="23514"){res.status(409).json({error:"A operação manteria a oficina sem proprietário."});return;}
      if(code==="22023"){res.status(400).json({error:"Operação ou justificativa inválida."});return;}throw error;
    }finally{client.release();}
  });
  app.get("/admin-api/workshops/:id/entitlements", requireSession, requirePermission("workshops:read"), async (req,res) => {
    try {
      const result = await pool.query("SELECT platform_admin.workshop_entitlement_status($1) AS entitlements", [String(req.params.id)]);
      const entitlements = result.rows[0]?.entitlements || {};
      res.json({...entitlements,plate_lookup:plateLookupStatus(String(req.params.id),entitlements.modules?.external_plate_lookup)});
    } catch (error) {
      if ((error as {code?:string}).code === "P0002") { res.status(404).json({error:"Oficina não encontrada."}); return; }
      throw error;
    }
  });
  app.put("/admin-api/workshops/:id/plan", requireSession, requirePermission("workshops:manage"), async (req,res) => {
    const input=z.object({plan_code:z.enum(["basic","professional","premium"]),reason:z.string().trim().min(10).max(500)}).strict().safeParse(req.body);
    if(!input.success){res.status(400).json({error:"Informe o plano e uma justificativa de 10 a 500 caracteres."});return;}
    const token=cookieValue(req);
    if(!token){res.status(401).json({error:"Entre no painel central."});return;}
    const client=await pool.connect();
    try{
      await client.query("BEGIN");
      const result=await client.query("SELECT platform_admin.set_workshop_plan($1,$2,$3,$4) AS entitlements",
        [String(req.params.id),digestAdminToken(token),input.data.plan_code,input.data.reason]);
      await client.query("COMMIT");
      const entitlements=result.rows[0]?.entitlements||{};
      res.json({ok:true,entitlements:{...entitlements,plate_lookup:plateLookupStatus(String(req.params.id),entitlements.modules?.external_plate_lookup)}});
    }catch(error){
      await client.query("ROLLBACK").catch(()=>{});
      const code=(error as {code?:string}).code;
      if(code==="42501"){res.status(403).json({error:"Permissão administrativa insuficiente."});return;}
      if(code==="P0002"){res.status(404).json({error:"Oficina gerenciada não encontrada."});return;}
      if(code==="22023"){res.status(400).json({error:"Plano ou justificativa inválida."});return;}
      throw error;
    }finally{client.release();}
  });
  app.put("/admin-api/workshops/:id/entitlements", requireSession, requirePermission("workshops:manage"), async (req,res) => {
    const input = z.object({
      module_overrides: z.record(z.string(),z.boolean()),
      max_users: z.number().int().min(1).max(10000).nullable(),
      trial_days: z.number().int().min(1).max(90).nullable(),
      override_expires_at: z.record(z.string(),z.string().datetime()).default({}),
      reason: z.string().trim().min(10).max(500),
    }).strict().safeParse(req.body);
    if (!input.success) { res.status(400).json({error:"Confira as permissões, limites e justificativa informados."}); return; }
    const token = cookieValue(req);
    if (!token) { res.status(401).json({error:"Entre no painel central."}); return; }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        "SELECT platform_admin.set_workshop_entitlements($1,$2,$3::jsonb,$4,$5,$6,$7::jsonb) AS entitlements",
        [String(req.params.id),digestAdminToken(token),JSON.stringify(input.data.module_overrides),input.data.max_users,input.data.trial_days,input.data.reason,JSON.stringify(input.data.override_expires_at)],
      );
      await client.query("COMMIT");
      const entitlements = result.rows[0]?.entitlements || {};
      res.json({ok:true,entitlements:{...entitlements,plate_lookup:plateLookupStatus(String(req.params.id),entitlements.modules?.external_plate_lookup)}});
    } catch (error) {
      await client.query("ROLLBACK").catch(()=>{});
      const code=(error as {code?:string}).code;
      if (code==="42501") { res.status(403).json({error:"Permissão administrativa insuficiente."}); return; }
      if (code==="P0002") { res.status(404).json({error:"Oficina não encontrada."}); return; }
      if (code==="22023") { res.status(400).json({error:"Permissões, limites ou justificativa inválidos."}); return; }
      throw error;
    } finally { client.release(); }
  });
  app.patch("/admin-api/workshops/:id/catalog-access", requireSession, requirePermission("modules:manage"), async (req,res) => {
    const input=z.object({enabled:z.boolean(),valid_until:z.string().datetime().nullable().optional(),reason:z.string().trim().min(10).max(500)}).strict().safeParse(req.body);
    if(!input.success){res.status(400).json({error:"Informe a situação, validade e justificativa do módulo."});return;}
    const token=cookieValue(req); if(!token){res.status(401).json({error:"Entre no painel central."});return;}
    const client=await pool.connect();
    try{
      await client.query("BEGIN");
      const result=await client.query("SELECT * FROM platform_admin.manage_catalog_access($1,$2,$3,$4,$5)",[
        String(req.params.id),digestAdminToken(token),input.data.enabled,
        input.data.enabled && input.data.valid_until ? input.data.valid_until : null,input.data.reason,
      ]);
      await client.query("COMMIT");
      res.json({ok:true,status:input.data.enabled?"active":"revoked",actor_email:result.rows[0]?.actor_email||""});
    }catch(error){
      await client.query("ROLLBACK").catch(()=>{});
      const code=(error as {code?:string}).code;
      if(code==="42501"){res.status(403).json({error:"Permissão administrativa insuficiente."});return;}
      if(code==="P0002"){res.status(404).json({error:"Oficina não encontrada."});return;}
      if(code==="22023"){res.status(400).json({error:"Período ou justificativa inválidos."});return;}
      throw error;
    }finally{client.release();}
  });
  app.get("/admin-api/catalog-test-access",requireSession,requirePermission("modules:manage"),async(req,res)=>{
    const projectId=catalogHomologationProjectId(req.hostname);
    if(!projectId){res.status(403).json({error:"A liberação coletiva está disponível somente no projeto autorizado de homologação."});return;}
    const state=await pool.query("SELECT * FROM platform_admin.catalog_test_access_status()");
    res.json({available:true,...state.rows[0]});
  });
  app.put("/admin-api/catalog-test-access",requireSession,requirePermission("modules:manage"),async(req,res)=>{
    const input=z.object({enabled:z.boolean(),valid_until:z.string().datetime().nullable().optional(),reason:z.string().trim().min(10).max(500)}).strict().safeParse(req.body);
    if(!input.success){res.status(400).json({error:"Informe a validade temporária e a justificativa."});return;}
    const projectId=catalogHomologationProjectId(req.hostname);
    if(!projectId){res.status(403).json({error:"A liberação coletiva está disponível somente no projeto autorizado de homologação."});return;}
    const token=cookieValue(req);if(!token){res.status(401).json({error:"Entre no painel central."});return;}
    const client=await pool.connect();
    try{
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.vercel_project_id',$1,true),set_config('app.vercel_env',$2,true)",[projectId,process.env.VERCEL_ENV||""]);
      const result=await client.query("SELECT * FROM platform_admin.set_catalog_test_access($1,$2,$3,$4,$5)",[
        digestAdminToken(token),projectId,input.data.enabled,input.data.enabled?input.data.valid_until||null:null,input.data.reason,
      ]);
      await writeAdminAudit(client,{actorId:result.rows[0]?.actor_id,actorEmail:result.rows[0]?.actor_email,action:input.data.enabled?"admin.catalog_test_access.enabled":"admin.catalog_test_access.disabled",result:"success",technical:{changed_count:result.rows[0]?.changed_count,valid_until:input.data.enabled?input.data.valid_until||null:null,reason:input.data.reason}});
      await client.query("COMMIT");
      res.json({ok:true,changed_count:result.rows[0]?.changed_count||0});
    }catch(error){
      await client.query("ROLLBACK").catch(()=>{});
      const code=(error as {code?:string}).code;
      if(code==="42501"){res.status(403).json({error:"Permissão ou ambiente não autorizado."});return;}
      if(code==="22023"){res.status(400).json({error:"Período ou justificativa inválidos."});return;}
      throw error;
    }finally{client.release();}
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
    const invitation = await sendWorkshopInvitation(pool, tenantId, actor);
    res.status(201).json({ tenant_id:tenantId, status:"pending_verification", invitation_status:invitation.status === 200 ? invitation.invitation_status : "failed" });
  });
  app.post("/admin-api/workshops/:id/invitation", requireSession, requirePermission("workshops:manage"), async (req, res) => {
    const result = await sendWorkshopInvitation(pool, String(req.params.id), res.locals.admin as AdminContext);
    if (result.status === 404) { res.status(404).json({ error:"Oficina administrada não encontrada." }); return; }
    if (result.status === 409) { res.status(409).json({ error:"Somente oficinas pendentes podem receber convite." }); return; }
    if (result.status === 429) { res.status(429).json({ error:"Um convite acabou de ser enviado. Aguarde um minuto antes de tentar novamente." }); return; }
    res.json({ invitation_status:result.invitation_status, invitation_expires_at:result.invitation_expires_at, invitation_sent_at:result.invitation_sent_at });
  });

  app.post("/admin-api/workshops/:id/invitation/cancel", requireSession, requirePermission("workshops:manage"), async (req, res) => {
    const tenantId = String(req.params.id), actor = res.locals.admin as AdminContext;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [tenantId]);
      const workshop = await client.query("SELECT source,status FROM platform_admin.workshops WHERE tenant_id=$1", [tenantId]);
      if (!workshop.rowCount || workshop.rows[0].source !== "admin") {
        await client.query("ROLLBACK"); res.status(404).json({ error:"Oficina administrada não encontrada." }); return;
      }
      if (workshop.rows[0].status !== "pending_verification") {
        await client.query("ROLLBACK"); res.status(409).json({ error:"A ativação desta oficina já foi concluída." }); return;
      }
      const cancelled = await client.query(`UPDATE platform_admin.workshop_activation_invites
        SET revoked_at=now(), delivery_status='revoked'
        WHERE id=(SELECT id FROM platform_admin.workshop_activation_invites
          WHERE tenant_id=$1 AND used_at IS NULL AND revoked_at IS NULL AND expires_at>now()
          ORDER BY created_at DESC,id DESC LIMIT 1)
        RETURNING id`, [tenantId]);
      if (!cancelled.rowCount) {
        await client.query("ROLLBACK"); res.status(409).json({ error:"Não há convite ativo para cancelar." }); return;
      }
      await writeAdminAudit(client, { actorId:actor.id, actorEmail:actor.email, subjectTenantId:tenantId,
        action:"admin.workshop.invitation.cancelled", result:"success",
        technical:{ invite_id:cancelled.rows[0].id } });
      await client.query("COMMIT");
      res.json({ invitation_status:"cancelled" });
    } catch (error) {
      await client.query("ROLLBACK").catch(()=>{});
      throw error;
    } finally { client.release(); }
  });

  app.post("/admin-api/workshops/:id/manual-activation-link", requireSession, requirePermission("workshops:manage"), async (req, res) => {
    const input = z.object({
      identity_verified:z.literal(true),
      verification_method:z.enum(["phone","in_person","video_call","other"]),
    }).strict().safeParse(req.body);
    if (!input.success) { res.status(400).json({ error:"Confirme a verificação externa da titularidade antes de gerar o link." }); return; }
    const origin = approvedActivationOrigin(req);
    if (!origin) { res.status(400).json({ error:"Não foi possível confirmar a origem autorizada para gerar o link." }); return; }
    const result = await prepareWorkshopInvitation(
      pool, String(req.params.id), res.locals.admin as AdminContext, input.data.verification_method,
    );
    if (result.status === 404) { res.status(404).json({ error:"Oficina administrada não encontrada." }); return; }
    if (result.status === 409) { res.status(409).json({ error:"Somente oficinas pendentes podem receber link de ativação." }); return; }
    if (result.status === 429) { res.status(429).json({ error:"Um convite foi criado há pouco. Aguarde um minuto antes de gerar outro link." }); return; }
    res.json({
      activation_url:workshopActivationUrl(origin, result.token),
      invitation_expires_at:result.expiresAt,
    });
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
    if (!input.success) { res.status(400).json({ error:"Informe uma situação permitida, o prazo de teste quando aplicável e uma justificativa." }); return; }
    const tenantId=String(req.params.id),token=cookieValue(req);
    if(!token){res.status(401).json({error:"Entre no painel central."});return;}
    const client=await pool.connect();
    try{
      await client.query("BEGIN");
      const result=await client.query("SELECT platform_admin.manage_workshop_lifecycle($1,$2,$3,$4,$5) AS change",
        [tenantId,digestAdminToken(token),input.data.status,input.data.trial_days??null,input.data.reason]);
      const detail=result.rows[0]?.change||{};
      await client.query("COMMIT");
      res.json({ok:true,...detail});
    }catch(error){
      await client.query("ROLLBACK").catch(()=>{});
      const code=(error as {code?:string}).code;
      if(code==="P0002"){res.status(404).json({error:"Oficina gerenciada não encontrada."});return;}
      if(code==="42501"){res.status(403).json({error:"Permissão administrativa insuficiente."});return;}
      if(code==="23514"){res.status(409).json({error:"Transição indisponível para a situação atual."});return;}
      if(code==="22023"){res.status(400).json({error:"Período de teste ou justificativa inválidos."});return;}
      throw error;
    }finally{client.release();}
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
