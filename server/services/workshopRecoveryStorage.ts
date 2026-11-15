import { createHash } from "node:crypto";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { openTransferPackage } from "../../shared/transferPackage.js";
import type { DB } from "../db/transactions.js";
import { createWorkshopTransfer } from "./dataTransferExport.js";
import type { PhotoStore } from "./checklistPhotoStorage.js";

const bucket = "workshop-recovery-backups";
const chunkBytes = 4_000_000;
const maxBackupBytes = 500_000_000;
const sha256 = (value: Buffer) => createHash("sha256").update(value).digest("hex");
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type RecoveryManifest = {
  tenantId: string;
  backupId: string;
  bytes: number;
  sha256: string;
  chunks: { key: string; bytes: number; sha256: string }[];
};

export interface RecoveryObjectStore {
  put(key: string, content: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  remove(keys: string[]): Promise<void>;
}

/** Reuses the already configured server-only checklist credential in homologation. */
export function configuredRecoveryStore(env: NodeJS.ProcessEnv = process.env): RecoveryObjectStore {
  if (env.APP_ENV === "horse_power" || env.CHECKLIST_STORAGE_ENABLED !== "true")
    throw new Error("Armazenamento de recuperação não configurado.");
  return supabaseRecoveryStore({
    url: env.CHECKLIST_STORAGE_URL || "",
    secret: env.CHECKLIST_STORAGE_SECRET || "",
    project: "vnclahdnirqlcbamodqy",
  });
}

/** The server credential stays out of the browser and is never returned in errors. */
export function supabaseRecoveryStore(config: { url: string; secret: string; project: string; fetchImpl?: typeof fetch }): RecoveryObjectStore {
  const url = new URL(config.url);
  if (url.protocol !== "https:" || url.hostname !== `${config.project}.supabase.co` || url.pathname !== "/" || url.search || url.username || url.password || !/^[a-z]{20}$/.test(config.project) || !config.secret)
    throw new Error("Armazenamento de recuperação não configurado.");
  const fetchImpl = config.fetchImpl ?? globalThis.fetch;
  async function request(path: string, init: RequestInit) {
    const response = await fetchImpl(new URL(`/storage/v1/${path}`, url), {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
      headers: { apikey: config.secret, Authorization: `Bearer ${config.secret}`, ...init.headers },
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error("Armazenamento de recuperação indisponível.");
    }
    return response;
  }
  return {
    async put(key, content) {
      await request(`object/${bucket}/${key}`, { method: "POST", headers: { "Content-Type": "application/octet-stream", "x-upsert": "false" }, body: new Uint8Array(content) });
    },
    async get(key) {
      const response = await request(`object/authenticated/${bucket}/${key}`, { method: "GET" });
      const size = Number(response.headers.get("content-length"));
      if (size > chunkBytes) throw new Error("Parte do backup maior que o limite.");
      const content = Buffer.from(await response.arrayBuffer());
      if (content.length > chunkBytes) throw new Error("Parte do backup maior que o limite.");
      return content;
    },
    async remove(keys) {
      if (!keys.length) return;
      await request(`object/${bucket}`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prefixes: keys }) });
    },
  };
}

function manifestKeys(tenantId: string, backupId: string, count: number) {
  if (!uuid.test(tenantId) || !uuid.test(backupId) || !Number.isInteger(count) || count < 1 || count > Math.ceil(maxBackupBytes / chunkBytes))
    throw new Error("Identificador de backup inválido.");
  return Array.from({ length: count }, (_, index) => `${tenantId}/${backupId}/${String(index).padStart(4, "0")}.hptxpart`);
}

export function recoveryObjectKeys(manifest: RecoveryManifest): string[] {
  const keys = manifestKeys(manifest.tenantId, manifest.backupId, manifest.chunks.length);
  if (!Number.isInteger(manifest.bytes) || manifest.bytes < 1 || manifest.bytes > maxBackupBytes || !/^[a-f0-9]{64}$/.test(manifest.sha256))
    throw new Error("Manifesto de backup inválido.");
  for (let index = 0; index < keys.length; index++) {
    const part = manifest.chunks[index];
    if (part.key !== keys[index] || !Number.isInteger(part.bytes) || part.bytes < 1 || part.bytes > chunkBytes || !/^[a-f0-9]{64}$/.test(part.sha256))
      throw new Error("Manifesto de backup inválido.");
  }
  return keys;
}

/** A verified copy is mandatory before a real workshop can be removed. */
export async function uploadRecoveryBackup(store: RecoveryObjectStore, tenantId: string, backupId: string, archive: Buffer): Promise<RecoveryManifest> {
  if (!archive.length || archive.length > maxBackupBytes) throw new Error("Backup fora do limite seguro; exclusão bloqueada.");
  const parts = Math.ceil(archive.length / chunkBytes);
  const keys = manifestKeys(tenantId, backupId, parts);
  const chunks: RecoveryManifest["chunks"] = [];
  try {
    for (let index = 0; index < parts; index++) {
      const content = archive.subarray(index * chunkBytes, (index + 1) * chunkBytes);
      await store.put(keys[index], content);
      const saved = await store.get(keys[index]);
      if (saved.length !== content.length || sha256(saved) !== sha256(content)) throw new Error("Integridade do backup não confirmada; exclusão bloqueada.");
      chunks.push({ key: keys[index], bytes: content.length, sha256: sha256(content) });
    }
  } catch (error) {
    await store.remove(keys).catch(() => {});
    throw error;
  }
  return { tenantId, backupId, bytes: archive.length, sha256: sha256(archive), chunks };
}

export async function readRecoveryBackup(store: RecoveryObjectStore, manifest: RecoveryManifest): Promise<Buffer> {
  const keys = recoveryObjectKeys(manifest);
  const contents: Buffer[] = [];
  for (let index = 0; index < keys.length; index++) {
    const part = manifest.chunks[index];
    const content = await store.get(part.key);
    if (content.length !== part.bytes || sha256(content) !== part.sha256) throw new Error("Integridade do backup não confirmada.");
    contents.push(content);
  }
  const archive = Buffer.concat(contents);
  if (archive.length !== manifest.bytes || sha256(archive) !== manifest.sha256) throw new Error("Integridade do backup não confirmada.");
  return archive;
}

/** Removes only expired, previously deleted workshop copies; failure keeps the case for retry. */
export async function purgeExpiredWorkshopBackups(pool: Pool, store: RecoveryObjectStore, now = new Date(), limit = 10) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error("Lote de limpeza inválido.");
  const due = await pool.query<{ tenant_id: string; coverage_end: string; backup_manifest: RecoveryManifest }>(
    `SELECT tenant_id,coverage_end::text,backup_manifest FROM platform_admin.workshop_retention_cases
     WHERE status='deleted' AND photo_objects_purged_at IS NOT NULL AND recovery_expires_at<=$1
     ORDER BY recovery_expires_at,tenant_id LIMIT $2`, [now, limit]);
  let purged = 0;
  for (const row of due.rows) {
    const manifest = row.backup_manifest;
    if (!manifest || manifest.tenantId !== row.tenant_id) throw new Error("Manifesto não corresponde à oficina.");
    await store.remove(recoveryObjectKeys(manifest));
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const updated = await client.query(`UPDATE platform_admin.workshop_retention_cases
        SET status='purged',backup_id=NULL,backup_manifest=NULL,backup_verified_at=NULL,updated_at=now()
        WHERE tenant_id=$1 AND coverage_end=$2 AND status='deleted' AND recovery_expires_at<=$3`,
        [row.tenant_id, row.coverage_end, now]);
      if (updated.rowCount) {
        await client.query(`INSERT INTO platform_admin.audit_events(id,actor_email,subject_tenant_id,action,result,technical_context)
          VALUES($1,'retention',$2,'retention.backup_purged','success',$3::jsonb)`,
          [randomUUID(), row.tenant_id, JSON.stringify({ backup_id: manifest.backupId, coverage_end: row.coverage_end })]);
        purged++;
      }
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }
    finally { client.release(); }
  }
  return { inspected: due.rowCount, purged };
}

/** Removes only the former tenant's private photo objects after the database retirement commits. */
export async function purgeDeletedWorkshopPhotos(pool: Pool, photos: PhotoStore, limit = 50) {
  if (!photos.remove || !Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new Error("Limpeza de fotos privadas não configurada.");
  const cases = await pool.query<{tenant_id:string;coverage_end:string;photo_object_keys:unknown}>(
    `SELECT tenant_id,coverage_end::text,photo_object_keys FROM platform_admin.workshop_retention_cases
     WHERE status='deleted' AND photo_objects_purged_at IS NULL ORDER BY deleted_at,tenant_id LIMIT 1`);
  const row = cases.rows[0];
  if (!row) return { inspected: 0, removed: 0, remaining: 0 };
  const keys = row.photo_object_keys;
  if (!Array.isArray(keys) || keys.some(key => typeof key !== "string" ||
      !new RegExp(`^${row.tenant_id}/[0-9a-f-]{36}$`).test(key)))
    throw new Error("Referências de fotos da oficina inválidas.");
  const batch = keys.slice(0, limit) as string[];
  if (batch.length) await photos.remove(batch);
  const remaining = keys.slice(batch.length);
  const updated = await pool.query(`UPDATE platform_admin.workshop_retention_cases SET
    photo_object_keys=$3::jsonb,photo_objects_purged_at=CASE WHEN $4::int=0 THEN now() ELSE NULL END,updated_at=now()
    WHERE tenant_id=$1 AND coverage_end=$2::date AND status='deleted' AND photo_object_keys=$5::jsonb`,
    [row.tenant_id,row.coverage_end,JSON.stringify(remaining),remaining.length,JSON.stringify(keys)]);
  return { inspected: 1, removed: updated.rowCount ? batch.length : 0, remaining: remaining.length };
}

/** A complete decrypt/manifest check must succeed before a backup is marked usable. */
export function verifyRecoveredWorkshop(manifest: RecoveryManifest, archive: Buffer, passphrase: string) {
  if (archive.length !== manifest.bytes || sha256(archive) !== manifest.sha256)
    throw new Error("Integridade do backup não confirmada.");
  const payload = openTransferPackage(archive, passphrase);
  if (payload.source.application !== "sistemaoficinas" || payload.source.tenant.id !== manifest.tenantId ||
      payload.records.tenant.id !== manifest.tenantId)
    throw new Error("Backup pertence a outra oficina.");
  return { sha256: manifest.sha256, entities: payload.entities };
}

/** Reads only the selected tenant and leaves no verified marker on a failed restore. */
export async function createVerifiedWorkshopRecoveryBackup(
  db: DB, store: RecoveryObjectStore, tenantId: string, backupId: string, passphrase: string,
) {
  if (!db.withTenantRead) throw new Error("A exportação exige contexto de oficina com RLS.");
  const archive = await db.withTenantRead(tenantId, () => createWorkshopTransfer(db, tenantId, passphrase));
  const manifest = await uploadRecoveryBackup(store, tenantId, backupId, archive);
  try {
    const restored = await readRecoveryBackup(store, manifest);
    const inventory = verifyRecoveredWorkshop(manifest, restored, passphrase);
    return { manifest, inventory };
  } catch (error) {
    await store.remove(manifest.chunks.map(part => part.key)).catch(() => {});
    throw error;
  }
}
