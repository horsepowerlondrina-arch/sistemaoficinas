import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import type { DB } from "../db/database.js";
import { tenantAccessDecision } from "./tenantAccess.js";
import type { Request, Response, NextFunction } from "express";
export type Context = { userId: string; tenantId: string; role: string };
export function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}
export function verifyPassword(password: string, hash: string) {
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
        'SELECT s.user_id "userId",s.tenant_id "tenantId",m.role FROM sessions s JOIN memberships m ON m.user_id=s.user_id AND m.tenant_id=s.tenant_id WHERE token_hash=? AND expires_at>?',
      )
      .get(digest(tokenFrom(req)), Date.now());
    if (!session) {
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
    res.locals.context = session;
    next();
  };
}
