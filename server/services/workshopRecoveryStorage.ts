import { createHash } from "node:crypto";
import { openTransferPackage } from "../../shared/transferPackage.js";
import type { DB } from "../db/transactions.js";
import { createWorkshopTransfer } from "./dataTransferExport.js";

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
  const keys = manifestKeys(manifest.tenantId, manifest.backupId, manifest.chunks.length);
  if (!Number.isInteger(manifest.bytes) || manifest.bytes < 1 || manifest.bytes > maxBackupBytes || !/^[a-f0-9]{64}$/.test(manifest.sha256)) throw new Error("Manifesto de backup inválido.");
  const contents: Buffer[] = [];
  for (let index = 0; index < keys.length; index++) {
    const part = manifest.chunks[index];
    if (part.key !== keys[index] || !Number.isInteger(part.bytes) || part.bytes < 1 || part.bytes > chunkBytes || !/^[a-f0-9]{64}$/.test(part.sha256)) throw new Error("Manifesto de backup inválido.");
    const content = await store.get(part.key);
    if (content.length !== part.bytes || sha256(content) !== part.sha256) throw new Error("Integridade do backup não confirmada.");
    contents.push(content);
  }
  const archive = Buffer.concat(contents);
  if (archive.length !== manifest.bytes || sha256(archive) !== manifest.sha256) throw new Error("Integridade do backup não confirmada.");
  return archive;
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
