import { randomBytes, randomUUID } from "node:crypto";
import type { DB } from "../db/database.js";
import { transaction } from "../db/database.js";
import { digest, hashPassword } from "../auth/session.js";

export const passwordResetTtlMinutes = 30;
export const newPasswordResetToken = () => randomBytes(32).toString("hex");

export function passwordResetUrl(appOrigin: string, token: string) {
  const base = new URL(appOrigin);
  if (base.username || base.password ||
      (base.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(base.hostname)))
    throw new Error("password_reset_origin_invalid");
  const url = new URL("/recuperar-senha", base.origin);
  url.hash = token;
  return url.toString();
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]!);
}

export type PasswordResetMailConfig = {
  apiKey?: string;
  from?: string;
  appOrigin?: string;
  fetchImpl?: typeof fetch;
};

export async function sendPasswordResetEmail(
  input: { email: string; token: string; requestId: string },
  config: PasswordResetMailConfig = {},
) {
  const apiKey = config.apiKey ?? process.env.RESEND_API_KEY;
  const from = config.from ?? process.env.WORKSHOP_ACTIVATION_FROM;
  const appOrigin = config.appOrigin ?? process.env.APP_ORIGIN;
  if (!apiKey || !from || !appOrigin) throw new Error("password_reset_mail_not_configured");
  const resetUrl = passwordResetUrl(appOrigin, input.token);
  const response = await (config.fetchImpl ?? globalThis.fetch)("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `workshop-password-reset/${input.requestId}`,
    },
    body: JSON.stringify({
      from,
      to: [input.email],
      subject: "Redefina sua senha no OSDrive",
      text: `Recebemos um pedido para redefinir a senha da sua conta de oficina. Abra o link: ${resetUrl}\n\nO link expira em ${passwordResetTtlMinutes} minutos e funciona uma única vez. Se não foi você, ignore esta mensagem.`,
      html: `<p>Recebemos um pedido para redefinir a senha da sua conta de oficina.</p><p><a href="${escapeHtml(resetUrl)}">Redefinir senha</a></p><p>O link expira em ${passwordResetTtlMinutes} minutos e funciona uma única vez. Se não foi você, ignore esta mensagem.</p>`,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error("password_reset_mail_delivery_failed");
}

export async function issuePasswordReset(db: DB, email: string, ipHash: string, tokenHash: string): Promise<string | null> {
  if (db.withRequestContext) {
    const row = await db.withRequestContext({}, () =>
      Promise.resolve(db.prepare("SELECT horse_power.issue_password_reset(?,?,?) AS email").get(email, ipHash, tokenHash)));
    return typeof row?.email === "string" ? row.email : null;
  }
  return transaction(db, async () => {
    const now = Date.now(), hourAgo = now - 60 * 60_000;
    await db.prepare("DELETE FROM password_reset_attempts WHERE requested_at<?").run(now - 24 * 60 * 60_000);
    const emailHash = digest(email.trim().toLowerCase());
    const byIp = await db.prepare("SELECT count(*) AS n FROM password_reset_attempts WHERE ip_hash=? AND requested_at>?").get(ipHash, hourAgo);
    const byEmail = await db.prepare("SELECT count(*) AS n FROM password_reset_attempts WHERE email_hash=? AND requested_at>?").get(emailHash, hourAgo);
    if (Number(byIp?.n) >= 10 || Number(byEmail?.n) >= 3) return null;
    await db.prepare("INSERT INTO password_reset_attempts(email_hash,ip_hash,requested_at) VALUES(?,?,?)").run(emailHash, ipHash, now);
    const user = await db.prepare("SELECT u.id,u.email FROM users u WHERE lower(u.email)=lower(?) AND EXISTS(SELECT 1 FROM memberships m WHERE m.user_id=u.id)").get(email.trim());
    if (!user) return null;
    await db.prepare("INSERT INTO password_reset_tokens(token_hash,user_id,created_at,expires_at) VALUES(?,?,?,?)")
      .run(tokenHash, user.id, now, now + passwordResetTtlMinutes * 60_000);
    return String(user.email);
  });
}

export async function cancelPasswordReset(db: DB, tokenHash: string): Promise<void> {
  if (db.withRequestContext) {
    await db.withRequestContext({}, () =>
      Promise.resolve(db.prepare("SELECT horse_power.cancel_password_reset(?)").get(tokenHash)));
    return;
  }
  await transaction(db, () => db.prepare("UPDATE password_reset_tokens SET revoked_at=? WHERE token_hash=? AND used_at IS NULL AND revoked_at IS NULL").run(Date.now(), tokenHash));
}

export async function completePasswordReset(db: DB, tokenHash: string, newPassword: string): Promise<boolean> {
  const passwordHash = hashPassword(newPassword);
  if (db.withRequestContext) {
    const row = await db.withRequestContext({}, () =>
      Promise.resolve(db.prepare("SELECT horse_power.complete_password_reset(?,?) AS completed").get(tokenHash, passwordHash)));
    return row?.completed === true;
  }
  return transaction(db, async () => {
    const now = Date.now();
    const token = await db.prepare("SELECT user_id,expires_at,used_at,revoked_at FROM password_reset_tokens WHERE token_hash=?").get(tokenHash);
    if (!token || token.used_at !== null || token.revoked_at !== null || Number(token.expires_at) <= now) return false;
    await db.prepare("UPDATE users SET password_hash=? WHERE id=?").run(passwordHash, token.user_id);
    await db.prepare("DELETE FROM sessions WHERE user_id=?").run(token.user_id);
    await db.prepare("UPDATE password_reset_tokens SET revoked_at=? WHERE user_id=? AND token_hash<>? AND used_at IS NULL AND revoked_at IS NULL")
      .run(now, token.user_id, tokenHash);
    await db.prepare("UPDATE password_reset_tokens SET used_at=? WHERE token_hash=?").run(now, tokenHash);
    return true;
  });
}

export function passwordResetRequestId() { return randomUUID(); }
