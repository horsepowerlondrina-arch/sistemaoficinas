import type { Pool } from "pg";
import type { DB } from "../db/database.js";
import { createWorkshopTransfer } from "./dataTransferExport.js";
import { getWorkshopTransferBackup, importWorkshopPackage, listWorkshopTransferBackups, previewWorkshopImport } from "./dataTransferImport.js";
import type { WorkshopImportMode } from "./dataTransferImport.js";
import { verifyWorkshopImport } from "./dataTransferVerification.js";

export const ADMIN_TRANSFER_MAX_FILE_BYTES = 4 * 1024 * 1024;
export type PlatformAdminDataTransfer = {
  target(tenantId: string): Promise<{ tenantId: string; workshopName: string }>;
  exportPackage(tenantId: string, passphrase: string): Promise<{ workshopName: string; archive: Buffer }>;
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

/** A narrow bridge to operational rows: target must be registered centrally and every query runs in its tenant/owner context. */
export function createPlatformAdminDataTransfer(db: DB, adminPool: Pool): PlatformAdminDataTransfer {
  async function target(tenantId: string) {
    assertTenantId(tenantId);
    const row = await adminPool.query("SELECT tenant_id,name FROM platform_admin.workshop_directory('','all',1,0,$1)", [tenantId]);
    if (!row.rowCount || String(row.rows[0].tenant_id) !== tenantId) throw new Error("Oficina não encontrada no cadastro administrativo.");
    return { tenantId, workshopName: String(row.rows[0].name) };
  }
  async function scope(tenantId: string) {
    const registered = await target(tenantId);
    if (!db.withTenantRead || !db.withRequestContext) throw new Error("A transferência administrativa exige PostgreSQL com contexto de oficina.");
    const owner = await db.withTenantRead(tenantId, () => db.prepare("SELECT user_id FROM memberships WHERE tenant_id=? AND role='owner' ORDER BY user_id LIMIT 1").get(tenantId));
    if (!owner?.user_id) throw new Error("A oficina não possui proprietário operacional ativo para preservar autoria e vínculos.");
    return { ...registered, ownerUserId: String(owner.user_id) };
  }
  async function within<T>(tenantId: string, callback: (selected: Awaited<ReturnType<typeof scope>>) => Promise<T>) {
    const selected = await scope(tenantId);
    return db.withRequestContext!({ "app.tenant_id": selected.tenantId, "app.user_id": selected.ownerUserId }, () => callback(selected));
  }
  return {
    target,
    async exportPackage(tenantId, passphrase) {
      return within(tenantId, async selected => {
        const archive = await createWorkshopTransfer(db, selected.tenantId, passphrase);
        if (archive.length > ADMIN_TRANSFER_MAX_FILE_BYTES) throw new Error("O pacote excede o limite de resposta online de 4 MiB.");
        return { workshopName: selected.workshopName, archive };
      });
    },
    async preview(tenantId, text, passphrase, mode) {
      const file = packageBuffer(text);
      return within(tenantId, selected => previewWorkshopImport(db, selected.tenantId, file, passphrase, selected.ownerUserId, mode));
    },
    async verify(tenantId, text, passphrase, mode) {
      const file = packageBuffer(text);
      return within(tenantId, selected => verifyWorkshopImport(db, selected.tenantId, file, passphrase, selected.ownerUserId, mode));
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
      return within(tenantId, async selected => Boolean(await db.prepare("SELECT 1 FROM data_transfer_records WHERE tenant_id=? AND source_application='platform_admin' AND source_tenant_id=? AND table_name='replace_approval' AND source_record_id=?").get(selected.tenantId, selected.tenantId, approvalId)));
    },
  };
}
