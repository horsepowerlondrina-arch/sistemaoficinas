import { randomBytes } from "node:crypto";
import type { Pool } from "pg";
import { encryptTotpSecret, hashAdminPassword, newTotpSecret, platformPermissions, writeAdminAudit } from "./auth/platformAdmin.js";
import { assertLocalProcess, platformAdminDatabaseUrl } from "./localConfig.js";

export const localAdminSeedEmail = "admin@plataforma.local";
export const localAdminSeedName = "Administrador de desenvolvimento";

export type LocalAdminSeedCredentials = {
  version: 1;
  email: typeof localAdminSeedEmail;
  name: typeof localAdminSeedName;
  password: string;
  totpSecret: string;
};

export function createLocalAdminSeedCredentials(): LocalAdminSeedCredentials {
  return {
    version: 1,
    email: localAdminSeedEmail,
    name: localAdminSeedName,
    password: randomBytes(32).toString("base64url"),
    totpSecret: newTotpSecret(),
  };
}

export function validateLocalAdminSeedCredentials(value: unknown): LocalAdminSeedCredentials {
  if (!value || typeof value !== "object") throw new Error("Arquivo local de credenciais inválido.");
  const row = value as Record<string, unknown>;
  if (row.version !== 1 || row.email !== localAdminSeedEmail || row.name !== localAdminSeedName ||
      typeof row.password !== "string" || row.password.length < 32 ||
      typeof row.totpSecret !== "string" || !/^[A-Z2-7]{32}$/.test(row.totpSecret))
    throw new Error("Arquivo local de credenciais inválido; nenhuma conta foi alterada.");
  return row as LocalAdminSeedCredentials;
}

export function assertLocalSeedEnvironment(env: NodeJS.ProcessEnv = process.env) {
  assertLocalProcess(env);
  if (env.VERCEL_ENV || env.VERCEL_URL || env.APP_ENV === "production" || env.APP_ENV === "staging")
    throw new Error("Conta fictícia recusada fora do ambiente local.");
  const url = new URL(platformAdminDatabaseUrl(env.PLATFORM_ADMIN_DATABASE_URL));
  if (!["127.0.0.1", "localhost"].includes(url.hostname) || decodeURIComponent(url.username) !== "hp_platform_admin_app")
    throw new Error("Conta fictícia aceita somente host 127.0.0.1 ou localhost e o papel administrativo local.");
  return url.toString();
}

/** Creates only the reserved development identity; conflict is a safe no-op. */
export async function ensureLocalAdminSeed(pool: Pool, encryptionKey: string, credentials: LocalAdminSeedCredentials) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const id = randomBytes(16).toString("hex");
    const inserted = await client.query(
      `INSERT INTO platform_admin.administrators(id,email,display_name,role,permissions,password_hash,totp_secret_ciphertext,active,enrolled)
       VALUES($1,$2,$3,'principal',$4::jsonb,$5,$6,true,true)
       ON CONFLICT(email) DO NOTHING RETURNING id`,
      [id, credentials.email, credentials.name, JSON.stringify(platformPermissions),
        hashAdminPassword(credentials.password), encryptTotpSecret(credentials.totpSecret, encryptionKey)],
    );
    if (!inserted.rowCount) {
      await client.query("COMMIT");
      return { created: false };
    }
    await writeAdminAudit(client, {
      actorId: id,
      subjectId: id,
      actorEmail: credentials.email,
      action: "admin.local_seed.created",
      result: "success",
      technical: { source: "local-development" },
    });
    await client.query("COMMIT");
    return { created: true };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/** Reconciles only the reserved local principal; it never changes authentication material or sessions. */
export async function ensureLocalAdminWorkshopPermissions(pool: Pool) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `SELECT id,email,role,active,enrolled,permissions FROM platform_admin.administrators
       WHERE email=$1 FOR UPDATE`,
      [localAdminSeedEmail],
    );
    const account = result.rows[0];
    if (!account) {
      await client.query("COMMIT");
      return { status: "not_found" as const, added: [] as string[] };
    }
    if (account.role !== "principal") {
      await client.query("COMMIT");
      return { status: "wrong_role" as const, added: [] as string[] };
    }
    if (!account.active || !account.enrolled) {
      await client.query("COMMIT");
      return { status: "inactive_or_unenrolled" as const, added: [] as string[] };
    }
    const current = Array.isArray(account.permissions) ? account.permissions as string[] : [];
    const required = ["workshops:read", "workshops:manage"];
    const added = required.filter(permission => !current.includes(permission));
    if (added.length === 0) {
      await client.query("COMMIT");
      return { status: "unchanged" as const, added };
    }
    const permissions = [...new Set([...current, ...required])];
    await client.query("UPDATE platform_admin.administrators SET permissions=$1::jsonb WHERE id=$2", [JSON.stringify(permissions), account.id]);
    await writeAdminAudit(client, {
      actorId: account.id,
      subjectId: account.id,
      actorEmail: localAdminSeedEmail,
      action: "admin.local_seed.permissions_reconciled",
      result: "success",
      technical: { added_permissions: added.join(",") },
    });
    await client.query("COMMIT");
    return { status: "updated" as const, added };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
