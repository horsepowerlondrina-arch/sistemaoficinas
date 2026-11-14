import {readUserAccess} from '../services/userAccess';
import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import type { DB } from "../db/database.js";
import { tenantAccessDecision } from "./tenantAccess.js";
import type { Request, Response, NextFunction } from "express";
import { defaultWorkshopModules } from "../../shared/workshopModules.js";
export type Context = { userId: string; tenantId: string; role: string; modules?: Record<string, boolean>; access?: import('../services/userAccess').UserAccess; action?: import('../../shared/userPermissions').Permission };
export function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}
export function verifyPassword(password: string, hash: string) {
  if(!/^[a-f0-9]{32}:[a-f0-9]{128}$/i.test(hash))return false;
  const [salt, key] = hash.split(":");
  return timingSafeEqual(
    Buffer.from(key, "hex"),
    scryptSync(password, salt, 64),
  );
}
export const digest = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export function tokenFrom(req: Request) {
  return (
    req.headers.cookie
      ?.split(";")
      .map((v) => v.trim())
      .find((v) => v.startsWith("hp_session="))
      ?.slice(11) || ""
  );
}
export async function startSession(
  db: DB,
  res: Response,
  userId: string,
  tenantId: string,
) {
  const token = randomBytes(32).toString("hex");
  await db
    .prepare("INSERT INTO sessions VALUES(?,?,?,?)")
    .run(digest(token), userId, tenantId, Date.now() + 86400000);
  const enabled=!db.hasUserAccessSchema||await db.hasUserAccessSchema();
  const count=enabled?await db.prepare('SELECT count(*) n FROM memberships m LEFT JOIN workshop_user_access a ON a.tenant_id=m.tenant_id AND a.user_id=m.user_id WHERE m.user_id=? AND COALESCE(a.active,1)=1').get(userId):null;
  if(Number(count?.n)>1){const save=async()=>{await db.prepare('INSERT INTO session_office_choices(token_hash) VALUES(?)').run(digest(token));};if(db.withRequestContext)await db.withRequestContext({'app.session_hash':digest(token)},save);else await save();}
  res.cookie("hp_session", token, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    maxAge: 86400000,
    path: "/",
  });
}
export function auth(db: DB) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const session = await db
      .prepare(
        'SELECT s.user_id "userId",s.tenant_id "tenantId" FROM sessions s WHERE token_hash=? AND expires_at>?',
      )
      .get(digest(tokenFrom(req)), Date.now());
    if (!session) {
      res.status(401).json({ error: "Entre na sua conta para continuar." });
      return;
    }
    await db.setRequestIdentity?.(String(session.tenantId), String(session.userId));
    const membership = await db.prepare(
      "SELECT role FROM memberships WHERE user_id=? AND tenant_id=?",
    ).get(session.userId, session.tenantId);
    if (!membership) {
      res.status(401).json({ error: "Entre na sua conta para continuar." });
      return;
    }
    const accessState = await db.getTenantAccessState?.(String(session.tenantId)) || "legacy";
    const decision = tenantAccessDecision(accessState, req.method, req.path);
    if (decision === "unavailable") {
      res.status(403).json({ error: "O acesso operacional desta oficina está indisponível." });
      return;
    }
    if (decision === "read_only") {
      res.status(403).json({ error: "Esta oficina está em modo somente leitura." });
      return;
    }
    const modules = await db.getTenantModuleAccess?.(String(session.tenantId)) || { ...defaultWorkshopModules };
    const ctx:Context = { userId:String(session.userId),tenantId:String(session.tenantId), role: membership.role, modules };
    if(!db.hasUserAccessSchema||await db.hasUserAccessSchema())ctx.access=await readUserAccess(db,ctx);
    if(ctx.access&&!ctx.access.active){res.status(401).json({error:"Acesso desativado nesta oficina."});return;}
    const choice=ctx.access?await db.prepare('SELECT confirmed FROM session_office_choices WHERE token_hash=?').get(digest(tokenFrom(req))):null;
    if(choice?.confirmed===0&&!['/session','/workspace','/tenant','/logout'].includes(req.path)){res.status(409).json({error:'Selecione a oficina ativa antes de continuar.'});return;}
    res.locals.context = ctx;
    next();
  };
}
