import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { Pool, PoolClient } from "pg";

export const platformRoles = ["principal", "finance", "technical_support", "commercial"] as const;
export type PlatformRole = typeof platformRoles[number];
export const platformPermissions = ["audit:read", "administrators:manage", "platform:settings", "critical:request", "critical:approve", "workshops:read", "workshops:manage", "data-transfer:manage", "modules:manage"] as const;
export type PlatformPermission = typeof platformPermissions[number];
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export const digestAdminToken = (token: string) => createHash("sha256").update(token).digest("hex");
export function hashAdminPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}
export function verifyAdminPassword(password: string, encoded: string) {
  const [salt, key, extra] = encoded.split(":");
  if (!salt || !key || extra || !/^[a-f0-9]{128}$/i.test(key)) return false;
  const expected = Buffer.from(key, "hex");
  const actual = scryptSync(password, salt, expected.length);
  return timingSafeEqual(actual, expected);
}
export function newTotpSecret() {
  const bytes = randomBytes(20);
  let bits = 0, value = 0, out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += alphabet[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits) out += alphabet[(value << (5 - bits)) & 31];
  return out;
}
function decodeBase32(value: string) {
  let bits = 0, accumulator = 0;
  const out: number[] = [];
  for (const character of value.toUpperCase().replace(/=+$/g, "")) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error("Segredo TOTP inválido.");
    accumulator = (accumulator << 5) | index; bits += 5;
    if (bits >= 8) { out.push((accumulator >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}
export function totpCode(secret: string, at = Date.now()) {
  const counter = Math.floor(at / 30000);
  const message = Buffer.alloc(8); message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", decodeBase32(secret)).update(message).digest();
  const offset = digest[digest.length - 1] & 15;
  const binary = (digest.readUInt32BE(offset) & 0x7fffffff) % 1000000;
  return String(binary).padStart(6, "0");
}
export function verifyTotp(secret: string, code: string, at = Date.now()) {
  if (!/^\d{6}$/.test(code)) return false;
  const supplied = Buffer.from(code);
  return [-1, 0, 1].some((delta) => {
    const expected = Buffer.from(totpCode(secret, at + delta * 30000));
    return timingSafeEqual(expected, supplied);
  });
}
export function encryptTotpSecret(secret: string, keyHex: string) {
  const key = Buffer.from(keyHex, "hex");
  if (key.length !== 32) throw new Error("Chave local de proteção TOTP inválida.");
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return `${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${encrypted.toString("base64url")}`;
}
export function decryptTotpSecret(encoded: string, keyHex: string) {
  const key = Buffer.from(keyHex, "hex"), [iv, tag, encrypted, extra] = encoded.split(".");
  if (key.length !== 32 || !iv || !tag || !encrypted || extra) throw new Error("Segredo TOTP indisponível.");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8");
}
export function totpUri(secret: string, email: string) {
  const label = encodeURIComponent(`Sistema Oficinas:${email}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=Sistema%20Oficinas&algorithm=SHA1&digits=6&period=30`;
}
export async function writeAdminAudit(pool: Pool | PoolClient, input: {
  actorId?: string | null; subjectId?: string | null; subjectTenantId?: string | null; actorEmail?: string;
  action: string; result: "success" | "failure" | "blocked";
  technical?: Record<string, string | number | boolean | null>;
}) {
  await pool.query(
    `INSERT INTO platform_admin.audit_events(id,actor_administrator_id,subject_administrator_id,subject_tenant_id,actor_email,action,result,technical_context)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
    [randomBytes(16).toString("hex"), input.actorId || null, input.subjectId || null, input.subjectTenantId || null,
     (input.actorEmail || "").slice(0, 254), input.action, input.result, JSON.stringify(input.technical || {})],
  );
}
