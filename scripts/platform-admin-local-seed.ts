import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { decryptTotpSecret, totpCode } from "../server/auth/platformAdmin.js";
import { ensureLocalAdminSeed, ensureLocalAdminWorkshopPermissions, createLocalAdminSeedCredentials, validateLocalAdminSeedCredentials, localAdminSeedEmail } from "../server/localAdminSeed.js";
import { assertPlatformAdminDatabase } from "../server/platformAdminApp.js";
import { assertLocalProcess, platformAdminDatabaseUrl } from "../server/localConfig.js";

const credentialsPath = path.resolve(".platform-admin-local.json");
const temporaryPath = `${credentialsPath}.${randomBytes(8).toString("hex")}.tmp`;
type SeedEnvironment = NodeJS.ProcessEnv;

export function assertLocalSeedEnvironment(env: SeedEnvironment = process.env) {
  assertLocalProcess(env);
  if (env.VERCEL_ENV || env.VERCEL_URL || env.APP_ENV === "production" || env.APP_ENV === "staging")
    throw new Error("Conta fictícia recusada fora do ambiente local.");
  const value = env.PLATFORM_ADMIN_DATABASE_URL;
  const url = new URL(platformAdminDatabaseUrl(value));
  if (!(["127.0.0.1", "localhost"].includes(url.hostname)) || decodeURIComponent(url.username) !== "hp_platform_admin_app")
    throw new Error("Conta fictícia aceita somente host 127.0.0.1 ou localhost e o papel administrativo local.");
  return url.toString();
}

function protectFile(file: string) {
  if (process.platform === "win32") {
    const account = execFileSync("whoami.exe", [], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    execFileSync("icacls.exe", [file, "/inheritance:r", "/grant:r", `${account}:(F)`], { stdio: "ignore" });
  } else {
    chmodSync(file, 0o600);
  }
}

function readCredentials() {
  const raw = JSON.parse(readFileSync(credentialsPath, "utf8")) as unknown;
  return validateLocalAdminSeedCredentials(raw);
}

function writeCredentialsSecurely(value: ReturnType<typeof createLocalAdminSeedCredentials>) {
  let created = false;
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
    protectFile(temporaryPath);
    renameSync(temporaryPath, credentialsPath);
    created = true;
    return created;
  } catch (error) {
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
    throw new Error("Não foi possível criar o arquivo local de credenciais com permissões restritas.", { cause: error });
  }
}

const action = process.argv[2];
if (!existsSync(".env.platform-admin.local")) throw new Error("Configuração local do painel ausente. Execute npm.cmd run db:local:migrate primeiro.");
process.loadEnvFile(".env.platform-admin.local");
const connectionString = assertLocalSeedEnvironment();
const encryptionKey = process.env.PLATFORM_ADMIN_TOTP_ENCRYPTION_KEY || "";
if (!/^[a-f0-9]{64}$/i.test(encryptionKey)) throw new Error("Chave administrativa local inválida.");
const pool = new pg.Pool({ connectionString, ssl: false, max: 1, connectionTimeoutMillis: 5000 });
try {
  const identity = await pool.query("SELECT current_database() AS database_name, inet_server_addr()::text AS server_address, current_user AS role_name");
  const target = identity.rows[0];
  if (target.database_name !== "horse_power_local" || !["127.0.0.1", "127.0.0.1/32", "::1", "::1/128"].includes(target.server_address) || target.role_name !== "hp_platform_admin_app")
    throw new Error(`Conexão recusada: identidade PostgreSQL divergente (banco=${target.database_name}, endereço=${target.server_address}, papel=${target.role_name}).`);
  await assertPlatformAdminDatabase(pool);

  if (action === "seed") {
    const existing = await pool.query("SELECT 1 FROM platform_admin.administrators WHERE email=$1", [localAdminSeedEmail]);
    if (existing.rowCount) {
      if (existsSync(credentialsPath)) protectFile(credentialsPath);
      const result = await ensureLocalAdminWorkshopPermissions(pool);
      if (result.status === "updated") console.log("As permissões de oficinas foram atualizadas somente na conta fictícia local e registradas na auditoria; senha, MFA e sessões foram preservados.");
      else if (result.status === "unchanged") console.log("A conta fictícia local já possui as permissões de oficinas. Nenhum dado foi alterado.");
      else if (result.status === "wrong_role") console.log("A conta fictícia existe com papel diferente de principal. Nenhuma permissão foi alterada.");
      else if (result.status === "inactive_or_unenrolled") console.log("A conta fictícia está inativa ou sem MFA concluído. Nenhuma permissão foi alterada.");
      else console.log("A conta fictícia não foi encontrada. Nenhuma permissão foi alterada.");
    } else {
      const credentials = existsSync(credentialsPath) ? (protectFile(credentialsPath), readCredentials()) : createLocalAdminSeedCredentials();
      const createdFile = existsSync(credentialsPath) ? false : writeCredentialsSecurely(credentials);
      const result = await ensureLocalAdminSeed(pool, encryptionKey, credentials);
      if (!result.created && createdFile) unlinkSync(credentialsPath);
      console.log(result.created
        ? "Conta fictícia criada com MFA obrigatório. As credenciais foram guardadas no arquivo local restrito; elas não foram exibidas."
        : "A conta fictícia já existe. Nenhum administrador foi alterado.");
    }
  } else if (action === "totp") {
    if (!existsSync(credentialsPath)) throw new Error("Arquivo local de credenciais não encontrado. Execute npm.cmd run admin:seed:local.");
    protectFile(credentialsPath);
    const credentials = readCredentials();
    const account = await pool.query("SELECT totp_secret_ciphertext, active, enrolled FROM platform_admin.administrators WHERE email=$1", [credentials.email]);
    if (!account.rowCount || !account.rows[0].active || !account.rows[0].enrolled)
      throw new Error("A conta fictícia não está ativa no banco local; nenhum código foi exibido.");
    const secret = decryptTotpSecret(account.rows[0].totp_secret_ciphertext, encryptionKey);
    if (secret !== credentials.totpSecret) throw new Error("O arquivo local não corresponde à conta registrada; nenhum código foi exibido.");
    console.log(totpCode(secret));
  } else {
    throw new Error("Use a ação seed ou totp.");
  }
} finally {
  await pool.end();
}
