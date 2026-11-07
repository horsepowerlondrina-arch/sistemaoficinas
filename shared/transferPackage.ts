import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scryptSync,
} from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";

export const TRANSFER_FORMAT = "sistema-oficinas-workshop-transfer";
export const TRANSFER_VERSION = 1;
export const TRANSFER_MEDIA_TYPE = "application/vnd.sistema-oficinas.transfer+json";
export const MAX_TRANSFER_PLAINTEXT = 64 * 1024 * 1024;
export const MAX_TRANSFER_FILE = 96 * 1024 * 1024;

/** Explicit allowlist: credentials, sessions, link grants and global platform tables are excluded. */
export const TRANSFER_TABLES = [
  "customers", "vehicles", "professionals", "catalog", "product_categories",
  "workshop_service_categories", "workshop_services", "labor_rates", "labor_commercial_rates", "orders",
  "order_items", "stock_movements", "stock_invoices", "stock_invoice_products",
  "suppliers", "receivables", "cash_entries", "payment_installments",
  "payment_settings", "card_rates", "card_machines", "card_machine_rates", "expense_templates", "payables",
  "cash_accounts", "cash_movements", "service_aliases", "service_merge_history",
  "external_catalog_links", "external_captures", "service_times", "checklists", "checklist_photos",
  "document_revisions", "data_transfer_archived_documents", "audit_events",
] as const;
/** Tenant fields are strictly operational; plan, billing, activation and platform metadata stay local. */
export const TRANSFER_TENANT_FIELDS = [
  "name", "document", "phone", "address", "legal_name", "state_registration",
  "municipal_registration", "whatsapp", "email", "website", "instagram",
  "social_links", "postal_code", "street", "number", "district", "complement",
  "city", "state", "full_address", "maps_url", "logo_url", "accent_color",
  "document_logo", "business_hours", "payment_terms", "warranty_text", "quote_validity_days",
  "default_notes", "document_footer", "pix_key", "pix_details", "profile_data",
] as const;
export type TransferTable = (typeof TRANSFER_TABLES)[number];
export type TransferRow = Record<string, unknown>;
export type TransferRecords = Partial<Record<TransferTable, TransferRow[]>>;

export interface TransferPayload {
  format: typeof TRANSFER_FORMAT;
  version: typeof TRANSFER_VERSION;
  generatedAt: string;
  source: { application: string; tenant: { id: string; name: string } };
  entities: Partial<Record<TransferTable | "users" | "memberships", { count: number; sha256: string }>>;
  records: TransferRecords & { tenant: TransferRow; users: TransferRow[]; memberships: TransferRow[] };
}

interface EncryptedEnvelope {
  format: typeof TRANSFER_FORMAT;
  version: typeof TRANSFER_VERSION;
  encryption: "AES-256-GCM";
  kdf: "scrypt-N32768-r8-p1";
  salt: string;
  iv: string;
  tag: string;
  ciphertext: string;
}

const forbiddenField = /(?:password|secret|token|session|credential|api[_-]?key|authorization)/i;

function containsForbiddenField(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(containsForbiddenField);
  return Object.entries(value as Record<string, unknown>).some(
    ([key, nested]) => forbiddenField.test(key) || containsForbiddenField(nested),
  );
}

function assertPassphrase(passphrase: string) {
  if (typeof passphrase !== "string" || Buffer.byteLength(passphrase, "utf8") < 12 || Buffer.byteLength(passphrase, "utf8") > 1024)
    throw new Error("Use uma frase secreta de transferência com pelo menos 12 bytes.");
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stable(object[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function digest(value: unknown) {
  return createHash("sha256").update(stable(value), "utf8").digest("hex");
}

export function createTransferPayload(
  application: string,
  tenant: { id: string; name: string },
  records: TransferPayload["records"],
  generatedAt = new Date().toISOString(),
): TransferPayload {
  const entities: TransferPayload["entities"] = {};
  for (const [name, rows] of Object.entries(records)) {
    const safeRows = (name === "tenant" ? [rows] : rows) as TransferRow[];
    entities[name as keyof typeof entities] = { count: safeRows.length, sha256: digest(safeRows) };
  }
  return { format: TRANSFER_FORMAT, version: TRANSFER_VERSION, generatedAt, source: { application, tenant }, entities, records };
}

export function validateTransferPayload(value: unknown): asserts value is TransferPayload {
  if (!value || typeof value !== "object") throw new Error("Pacote de transferência inválido.");
  const payload = value as Partial<TransferPayload>;
  if (payload.format !== TRANSFER_FORMAT || payload.version !== TRANSFER_VERSION)
    throw new Error("Formato ou versão de transferência não compatível.");
  if (!payload.source?.tenant?.id || !payload.source.tenant.name || !payload.records || !payload.entities)
    throw new Error("Manifesto de transferência incompleto.");
  const permitted = new Set<string>([...TRANSFER_TABLES, "tenant", "users", "memberships"]);
  for (const [table, rows] of Object.entries(payload.records)) {
    const entityRows = table === "tenant" && rows && typeof rows === "object" && !Array.isArray(rows) ? [rows] : rows;
    if (!permitted.has(table) || !Array.isArray(entityRows)) throw new Error("O pacote contém uma entidade não permitida.");
    for (const row of entityRows as TransferRow[]) {
      if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error("O pacote contém um registro inválido.");
      if (containsForbiddenField(row)) throw new Error("O pacote contém campos de autenticação ou segredo.");
      for (const key of Object.keys(row)) if (!/^[a-z][a-z0-9_]*$/.test(key)) throw new Error("O pacote contém um campo inválido.");
    }
  }
  for (const [table, expected] of Object.entries(payload.entities)) {
    if (!permitted.has(table) || !expected || !Number.isSafeInteger(expected.count) || expected.count < 0 || !/^[a-f0-9]{64}$/.test(expected.sha256))
      throw new Error("O manifesto de integridade é inválido.");
    const rows = table === "tenant" ? [payload.records.tenant] : payload.records[table as keyof typeof payload.records];
    if (!rows || !Array.isArray(rows) || rows.length !== expected.count || digest(rows) !== expected.sha256)
      throw new Error("A integridade do pacote não confere.");
  }
  const recordNames = Object.keys(payload.records);
  if (recordNames.length !== Object.keys(payload.entities).length || recordNames.some((table) => !payload.entities?.[table as keyof typeof payload.entities]))
    throw new Error("O manifesto não descreve todas as entidades do pacote.");
  if (!payload.records.tenant || typeof payload.records.tenant !== "object") throw new Error("Dados da oficina ausentes.");
  if (!Array.isArray(payload.records.users) || !Array.isArray(payload.records.memberships)) throw new Error("Identidades históricas ausentes.");
}

export function sealTransferPackage(payload: TransferPayload, passphrase: string): Buffer {
  assertPassphrase(passphrase);
  validateTransferPayload(payload);
  const plain = Buffer.from(JSON.stringify(payload), "utf8");
  if (plain.length > MAX_TRANSFER_PLAINTEXT) throw new Error("O pacote excede o limite de 64 MB.");
  const compressed = gzipSync(plain, { level: 9 });
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = scryptSync(passphrase, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(`${TRANSFER_FORMAT}:${TRANSFER_VERSION}`));
  const ciphertext = Buffer.concat([cipher.update(compressed), cipher.final()]);
  const envelope: EncryptedEnvelope = {
    format: TRANSFER_FORMAT,
    version: TRANSFER_VERSION,
    encryption: "AES-256-GCM",
    kdf: "scrypt-N32768-r8-p1",
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
  const result = Buffer.from(JSON.stringify(envelope), "utf8");
  if (result.length > MAX_TRANSFER_FILE) throw new Error("O arquivo excede o limite de transferência.");
  return result;
}

function decodeBase64(value: unknown, length?: number): Buffer {
  if (typeof value !== "string") throw new Error("Arquivo de transferência inválido.");
  const result = Buffer.from(value, "base64");
  const canonical = result.toString("base64");
  if (value !== canonical && value !== canonical.replace(/=+$/, ""))
    throw new Error("Arquivo de transferência inválido.");
  if (length !== undefined && result.length !== length) throw new Error("Arquivo de transferência inválido.");
  return result;
}

export function openTransferPackage(file: Buffer, passphrase: string): TransferPayload {
  assertPassphrase(passphrase);
  if (!Buffer.isBuffer(file) || file.length === 0 || file.length > MAX_TRANSFER_FILE) throw new Error("Arquivo ausente ou acima do limite.");
  let envelope: EncryptedEnvelope;
  try { envelope = JSON.parse(file.toString("utf8")) as EncryptedEnvelope; }
  catch { throw new Error("Arquivo de transferência inválido."); }
  if (envelope.format !== TRANSFER_FORMAT || envelope.version !== TRANSFER_VERSION || envelope.encryption !== "AES-256-GCM" || envelope.kdf !== "scrypt-N32768-r8-p1")
    throw new Error("Formato, versão ou proteção do pacote não compatível.");
  const salt = decodeBase64(envelope.salt, 16), iv = decodeBase64(envelope.iv, 12), tag = decodeBase64(envelope.tag, 16), ciphertext = decodeBase64(envelope.ciphertext);
  try {
    const key = scryptSync(passphrase, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(Buffer.from(`${TRANSFER_FORMAT}:${TRANSFER_VERSION}`));
    decipher.setAuthTag(tag);
    const compressed = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    const plain = gunzipSync(compressed, { maxOutputLength: MAX_TRANSFER_PLAINTEXT });
    const payload = JSON.parse(plain.toString("utf8")) as unknown;
    validateTransferPayload(payload);
    return payload;
  } catch (error) {
    if (error instanceof Error && /frase secreta|compatível|integridade|manifesto|campo|entidade|registro/.test(error.message)) throw error;
    throw new Error("Não foi possível abrir o pacote. Confira a frase secreta e a integridade do arquivo.");
  }
}

export function transferFileSha256(file: Buffer) {
  return createHash("sha256").update(file).digest("hex");
}

