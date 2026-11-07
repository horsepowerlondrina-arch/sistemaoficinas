import type { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { transferFileSha256 } from "../../shared/transferPackage.js";
import type { DB } from "../db/database.js";
import { createWorkshopTransfer } from "./dataTransferExport.js";
import { getWorkshopTransferBackup, importWorkshopPackage, listWorkshopTransferBackups, previewWorkshopImport } from "./dataTransferImport.js";
import type { WorkshopImportMode } from "./dataTransferImport.js";
import { TransferVerificationError, verifyWorkshopImport } from "./dataTransferVerification.js";

export const ADMIN_TRANSFER_MAX_FILE_BYTES = 4 * 1024 * 1024;
export const ADMIN_TRANSFER_CHUNK_BYTES = 1024 * 1024;
export type StagedWorkshopExport = { id: string; workshopName: string; sha256: string; size: number; chunkCount: number };
export type WorkshopExportChunk = { bytes: Buffer; sha256: string; size: number };
export type PlatformAdminDataTransfer = {
  target(tenantId: string): Promise<{ tenantId: string; workshopName: string }>;
  exportPackage(tenantId: string, passphrase: string): Promise<{ workshopName: string; archive: Buffer }>;
  stageExport(tenantId: string, passphrase: string): Promise<StagedWorkshopExport>;
  exportChunk(tenantId: string, exportId: string, index: number): Promise<WorkshopExportChunk | undefined>;
  preview(tenantId: string, packageText: string, passphrase: string, mode: WorkshopImportMode): Promise<unknown>;
  verify(tenantId: string, packageText: string, passphrase: string, mode: WorkshopImportMode): Promise<unknown>;
  import(tenantId: string, packageText: string, passphrase: string, confirmationId: string, mode: WorkshopImportMode, workshopConfirmation: string | undefined, approvalId?: string): Promise<unknown>;
  backups(tenantId: string): Promise<unknown[]>;
  backup(tenantId: string, backupId: string): Promise<Buffer | undefined>;
  approvalConsumed(tenantId: string, approvalId: string): Promise<boolean>;
};

function assertTenantId(value: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw new Error("Identificador de oficina inválido.");
}
function packageBuffer(value: string) {
  const file = Buffer.from(value, "utf8");
  if (!file.length || file.length > ADMIN_TRANSFER_MAX_FILE_BYTES) throw new Error("O painel central aceita pacotes de até 4 MiB por operação online.");
  return file;
}

/** A narrow bridge to operational rows: targets are checked centrally and tenant rows stay RLS-scoped. */
export function createPlatformAdminDataTransfer(db: DB, adminPool: Pool): PlatformAdminDataTransfer {
  async function target(tenantId: string) {
    assertTenantId(tenantId);
    const row = await adminPool.query("SELECT tenant_id,name FROM platform_admin.workshop_directory('','all',1,0,$1)", [tenantId]);
    if (!row.rowCount || String(row.rows[0].tenant_id) !== tenantId) throw new TransferVerificationError("workshop_unavailable");
    return { tenantId, workshopName: String(row.rows[0].name) };
  }
  async function scope(tenantId: string) {
    const registered = await target(tenantId);
    if (!db.withTenantServiceRead || !db.withRequestContext) throw new Error("A transferência administrativa exige PostgreSQL com contexto de oficina.");
    const owner = await db.withTenantServiceRead(registered.tenantId, async () =>
      await db.prepare("SELECT user_id FROM memberships WHERE tenant_id=? AND role='owner' ORDER BY user_id LIMIT 1").get(registered.tenantId));
    if (!owner?.user_id) throw new TransferVerificationError("authorization");
    return { ...registered, ownerUserId: String(owner.user_id) };
  }
  async function readWithin<T>(tenantId: string, callback: (selected: Awaited<ReturnType<typeof target>>) => Promise<T>) {
    const registered = await target(tenantId);
    if (!db.withTenantRead) throw new Error("A transferência administrativa exige PostgreSQL com contexto de oficina.");
    return db.withTenantRead(registered.tenantId, () => callback(registered));
  }
  async function within<T>(tenantId: string, callback: (selected: Awaited<ReturnType<typeof scope>>) => Promise<T>) {
    const selected = await scope(tenantId);
    return db.withRequestContext!({ "app.tenant_id": selected.tenantId, "app.user_id": selected.ownerUserId }, () => callback(selected));
  }
  return {
    target,
    async exportPackage(tenantId, passphrase) {
      return readWithin(tenantId, async selected => {
        const archive = await createWorkshopTransfer(db, selected.tenantId, passphrase);
        if (archive.length > ADMIN_TRANSFER_MAX_FILE_BYTES) throw new Error("O pacote excede o limite de resposta online de 4 MiB.");
        return { workshopName: selected.workshopName, archive };
      });
    },
    async stageExport(tenantId, passphrase) {
      return within(tenantId, async selected => {
        const archive = await createWorkshopTransfer(db, selected.tenantId, passphrase);
        const id = randomUUID();
        const sha256 = transferFileSha256(archive);
        await db.prepare("INSERT INTO data_transfer_backups(id,tenant_id,created_by,package_sha256,package,expires_at) VALUES(?,?,?,?,?,?)")
          .run(id, selected.tenantId, selected.ownerUserId, sha256, archive, new Date(Date.now() + 30 * 86400000).toISOString());
        const stored = await db.prepare("SELECT package_sha256,octet_length(package) AS size FROM data_transfer_backups WHERE tenant_id=? AND id=?")
          .get(selected.tenantId, id);
        if (!stored || String(stored.package_sha256) !== sha256 || Number(stored.size) !== archive.length)
          throw new Error("A cópia criptografada não pôde ser validada no armazenamento.");
        return { id, workshopName: selected.workshopName, sha256, size: archive.length,
          chunkCount: Math.ceil(archive.length / ADMIN_TRANSFER_CHUNK_BYTES) };
      });
    },
    async exportChunk(tenantId, exportId, index) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(exportId)
          || !Number.isSafeInteger(index) || index < 0 || index > 95) return undefined;
      return within(tenantId, async selected => {
        const row = await db.prepare("SELECT package_sha256,octet_length(package) AS size,substring(package,?,?) AS chunk FROM data_transfer_backups WHERE tenant_id=? AND id=? AND expires_at>now()")
          .get(index * ADMIN_TRANSFER_CHUNK_BYTES + 1, ADMIN_TRANSFER_CHUNK_BYTES, selected.tenantId, exportId);
        if (!row) return undefined;
        const size = Number(row.size);
        if (index >= Math.ceil(size / ADMIN_TRANSFER_CHUNK_BYTES)) return undefined;
        const bytes = Buffer.from(row.chunk);
        if (bytes.length !== Math.min(ADMIN_TRANSFER_CHUNK_BYTES, size - index * ADMIN_TRANSFER_CHUNK_BYTES))
          throw new Error("Parte incompleta do pacote criptografado.");
        return { bytes, sha256: String(row.package_sha256), size };
      });
    },
    async preview(tenantId, text, passphrase, mode) {
      const file = packageBuffer(text);
      return within(tenantId, selected => previewWorkshopImport(db, selected.tenantId, file, passphrase, selected.ownerUserId, mode));
    },
    async verify(tenantId, text, passphrase, mode) {
      const file = packageBuffer(text);
      return readWithin(tenantId, selected => verifyWorkshopImport(db, selected.tenantId, file, passphrase, { kind: "platform-admin-transfer", tenantId: selected.tenantId }, mode));
    },
    async import(tenantId, text, passphrase, confirmationId, mode, workshopConfirmation, approvalId) {
      const file = packageBuffer(text);
      if (mode === "replace" && !approvalId) throw new Error("A substituição exige aprovação de outro administrador.");
      return within(tenantId, selected => importWorkshopPackage(db, selected.tenantId, file, passphrase, confirmationId, selected.ownerUserId, mode, workshopConfirmation,
        approvalId ? { adminApprovalId: approvalId } : {}));
    },
    async backups(tenantId) { return within(tenantId, selected => listWorkshopTransferBackups(db, selected.tenantId)); },
    async backup(tenantId, backupId) { return within(tenantId, selected => getWorkshopTransferBackup(db, selected.tenantId, backupId)); },
    async approvalConsumed(tenantId, approvalId) {
      return readWithin(tenantId, async selected => Boolean(await db.prepare("SELECT 1 FROM data_transfer_records WHERE tenant_id=? AND source_application='platform_admin' AND source_tenant_id=? AND table_name='replace_approval' AND source_record_id=?").get(selected.tenantId, selected.tenantId, approvalId)));
    },
  };
}
