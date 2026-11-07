import { createDecipheriv, createHash, scryptSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import pg from "pg";
import { createPostgresDatabase } from "../server/db/postgres.js";
import { importWorkshopPackage, previewWorkshopImport } from "../server/services/dataTransferImport.js";
import { MAX_TRANSFER_PLAINTEXT, openTransferPackage, validateTransferPayload } from "../shared/transferPackage.js";

const sourceRef = "vnclahdnirqlcbamodqy";
const targetRef = "rvlovjpquozbrsszsxwe";
const tenantId = "59c85eea-7112-40de-b77f-c5627c541b48";
const backupId = "05fa154b-3f96-4fe0-855a-a0af10f46e8f";
const backupSha256 = "f0c8a897919c61dd912a711c0c6d9ac6149638c9a423d3c1da22aa76592154a1";
const backupBytes = 9320665;
const pooler = "aws-1-ca-central-1.pooler.supabase.com";
const branch = "infra/horse-power-definitive-restore-ci";

type Source = {
  tenant_id: string;
  tenant_name: string;
  owner_user_id: string;
  owner_name: string;
  owner_email: string;
  owner_password_hash: string;
  email_verified_at: Date | string;
  backup_id: string;
  backup_sha256: string;
  backup_bytes: number | string;
  encrypted_package: Buffer;
};
function connection(role: string, ref: string, password: string) {
  if (!password || /[\r\n]/.test(password)) throw new Error("Credencial temporária ausente.");
  const url = new URL(`postgresql://${role}.${ref}@${pooler}:5432/postgres`);
  url.password = password;
  return url.toString();
}
function guard() {
  const operation = process.env.HP_RESTORE_OPERATION;
  if (process.env.GITHUB_ACTIONS !== "true" ||
      process.env.GITHUB_EVENT_NAME !== "workflow_dispatch" ||
      process.env.GITHUB_REF_NAME !== branch ||
      process.env.HP_RESTORE_TARGET !== "horse-power-definitive" ||
      process.env.HP_RESTORE_CONFIRMED !== "confirmed" ||
      !["preflight-only", "restore-definitive"].includes(operation || "")) {
    throw new Error("Restauração permitida apenas no workflow manual da branch dedicada.");
  }
  for (const key of ["PGHOST","PGHOSTADDR","PGPORT","PGDATABASE","PGUSER","PGPASSWORD","PGSERVICE","PGOPTIONS","DATABASE_URL"]) {
    if (process.env[key]) throw new Error("Conexão PostgreSQL implícita não permitida.");
  }
  if (!process.env.HP_RESTORE_PASSPHRASE || process.env.HP_RESTORE_PASSPHRASE.length < 12) {
    throw new Error("Frase secreta do pacote indisponível.");
  }
  return operation as "preflight-only" | "restore-definitive";
}
function verifySource(row: Source, phrase: string) {
  diagnosticStage = "package-metadata";
  if (row.tenant_id !== tenantId || row.tenant_name !== "Horse Power Car Service" ||
      row.backup_id !== backupId || row.backup_sha256 !== backupSha256 ||
      Number(row.backup_bytes) !== backupBytes || !Buffer.isBuffer(row.encrypted_package) ||
      row.encrypted_package.length !== backupBytes ||
      createHash("sha256").update(row.encrypted_package).digest("hex") !== backupSha256 ||
      !/^[a-f0-9]{32}:[a-f0-9]{128}$/.test(row.owner_password_hash) ||
      !row.email_verified_at) {
    throw new Error("Identidade ou integridade do backup divergiu.");
  }
  diagnosticStage = "package-envelope";
  const envelope = JSON.parse(row.encrypted_package.toString("utf8")) as {salt: string; iv: string; tag: string; ciphertext: string};
  diagnosticStage = "package-authentication";
  const key = scryptSync(phrase, Buffer.from(envelope.salt, "base64"), 32, {N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024});
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "base64"));
  decipher.setAAD(Buffer.from("sistema-oficinas-workshop-transfer:1"));
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
  const compressed = Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, "base64")), decipher.final()]);
  diagnosticStage = "package-decompression";
  const plain = gunzipSync(compressed, {maxOutputLength: MAX_TRANSFER_PLAINTEXT});
  diagnosticStage = "package-json";
  const decoded: unknown = JSON.parse(plain.toString("utf8"));
  diagnosticStage = "package-schema";
  validateTransferPayload(decoded);
  diagnosticStage = "package-open";
  const payload = openTransferPackage(row.encrypted_package, phrase);
  diagnosticStage = "package-identity";
  if (payload.source.tenant.id !== tenantId || payload.records.tenant.id !== tenantId ||
      payload.source.tenant.name !== row.tenant_name ||
      payload.records.users.length !== 0 || payload.records.memberships.length !== 0) {
    throw new Error("O pacote não corresponde à oficina e ao formato aprovados.");
  }
  return payload;
}
let diagnosticStage = "configuration";
async function main() {
  const operation = guard();
  const phrase = process.env.HP_RESTORE_PASSPHRASE!;
  const sourceUrl = connection("hp_restore_source_login", sourceRef, process.env.HP_RESTORE_SOURCE_PASSWORD || "");
  const source = new pg.Client({
    connectionString: sourceUrl,
    ssl: { ca: readFileSync("server/db/certs/supabase-ca.crt", "utf8"), rejectUnauthorized: true },
    connectionTimeoutMillis: 15000,
    query_timeout: 30000,
    application_name: "horse-power-definitive-approved-restore",
  });
  let snapshot: Source;
  try {
    diagnosticStage = "source-connection";
    await source.connect();
    diagnosticStage = "source-query";
    await source.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const identity = (await source.query("SELECT current_database() AS db,current_user AS role,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user")).rows[0];
    if (identity?.db !== "postgres" || identity?.role !== "hp_restore_source_login" || identity.rolsuper || identity.rolbypassrls)
      throw new Error("Origem restrita não corresponde à homologação.");
    const result = await source.query<Source>("SELECT * FROM horse_power.definitive_restore_source()");
    if (result.rowCount !== 1) throw new Error("Backup autorizado não encontrado.");
    snapshot = result.rows[0];
    await source.query("COMMIT");
  } finally {
    await source.query("ROLLBACK").catch(() => {});
    await source.end().catch(() => {});
  }
  diagnosticStage = "package-validation";
  const payload = verifySource(snapshot, phrase);
  const counts = {
    customers: payload.records.customers?.length || 0,
    vehicles: payload.records.vehicles?.length || 0,
    orders: payload.records.orders?.length || 0,
    order_items: payload.records.order_items?.length || 0,
    checklists: payload.records.checklists?.length || 0,
    document_revisions: payload.records.document_revisions?.length || 0,
  };
  if (operation === "preflight-only") {
    console.log(JSON.stringify({ result: "verified-no-write", backupSha256, counts }));
    snapshot.encrypted_package.fill(0);
    return;
  }
  diagnosticStage = "target-connection";
  const targetUrl = connection("hp_restore_target_login", targetRef, process.env.HP_RESTORE_TARGET_PASSWORD || "");
  const db = createPostgresDatabase(targetUrl);
  try {
    const identity = await db.prepare("SELECT current_database() AS db,current_user AS role").get();
    if (identity?.db !== "postgres" || identity?.role !== "hp_restore_target_login")
      throw new Error("Destino não corresponde ao banco definitivo restrito.");
    diagnosticStage = "target-import";
    const result = await db.withRequestContext({ "app.tenant_id": tenantId, "app.user_id": snapshot.owner_user_id }, async () => {
      await db.prepare("SELECT platform_admin.provision_definitive_horse_power(?,?,?,?,?,?,?)").get(
        tenantId, snapshot.tenant_name, snapshot.owner_user_id, snapshot.owner_name,
        snapshot.owner_email, snapshot.owner_password_hash, snapshot.email_verified_at,
      );
      const preview = await previewWorkshopImport(db, tenantId, snapshot.encrypted_package, phrase, snapshot.owner_user_id, "empty");
      if (!preview.canImport || preview.mode !== "empty" ||
          preview.entities.customers?.source !== counts.customers ||
          preview.entities.vehicles?.source !== counts.vehicles ||
          preview.entities.orders?.source !== counts.orders ||
          preview.entities.order_items?.source !== counts.order_items) {
        throw new Error("A prévia bloqueou a restauração; a transação será revertida.");
      }
      const imported = await importWorkshopPackage(db, tenantId, snapshot.encrypted_package, phrase, preview.confirmationId, snapshot.owner_user_id, "empty");
      for (const [entity, expected] of Object.entries(counts)) {
        if (imported.counts[entity] !== expected) throw new Error("A conferência final falhou.");
      }
      return imported;
    });
    console.log(JSON.stringify({ result: "restored", backupSha256, counts: result.counts }));
  } finally {
    await db.close();
    snapshot.encrypted_package.fill(0);
  }
}
main().catch((error: unknown) => {
  const rawCode = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  const code = /^[A-Z0-9]{5}$/.test(rawCode) ? rawCode : "sem-codigo";
  const rawConstraint = error && typeof error === "object" && "constraint" in error ? String(error.constraint) : "";
  const constraint = /^[a-z0-9_]{1,100}$/.test(rawConstraint) ? rawConstraint : "nao-identificada";
  console.error(`A transferência não foi concluída na etapa ${diagnosticStage} (${code}; restrição ${constraint}). Nenhuma escrita foi confirmada.`);
  process.exitCode = 1;
});
