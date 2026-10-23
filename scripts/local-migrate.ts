import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { adminClient } from "./local-admin.js";
import { migrationChecksum } from "../server/db/migrationChecksum.js";
// This checksum predates the committed 003 file. Keep the recorded audit value;
// accept it only after confirming the expected local schema is present.
const legacyCustomizationChecksum = "d8f14d0a9c725eeb0c9dc7d6bb8a8c006dbafac9318a09afb609bf11597e673e";
async function verifiedLegacyCustomization(): Promise<boolean> {
  const result = await client.query(`SELECT
    to_regclass('horse_power.checklists') IS NOT NULL AS checklists,
    to_regclass('horse_power.checklist_photos') IS NOT NULL AS photos,
    to_regclass('horse_power.document_revisions') IS NOT NULL AS revisions,
    (SELECT count(*) = 1 FROM horse_power.migrations WHERE version=23) AS version,
    (SELECT count(*) = 4 FROM information_schema.columns WHERE table_schema='horse_power' AND
      (table_name,column_name) IN (('tenants','profile_data'),('orders','identity_legacy'),
       ('checklists','identity_legacy'),('public_shares','document_revision'))) AS columns,
    (SELECT count(*) = 4 FROM pg_policies WHERE schemaname='horse_power' AND
      (tablename,policyname) IN (('checklists','backend_checklist_access'),
       ('checklist_photos','backend_checklist_access'),('document_revisions','backend_document_read'),
       ('document_revisions','backend_document_insert'))) AS policies,
    EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='horse_power.document_revisions'::regclass
      AND tgname='document_revision_immutable' AND NOT tgisinternal) AS immutable`);
  return Object.values(result.rows[0]).every(Boolean);
}
if (existsSync(".env.platform-admin.local")) process.loadEnvFile(".env.platform-admin.local");
const client = adminClient();
let newAdminEnvironment: string | undefined;
try {
  await client.connect();
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(721834110)");
  await client.query("CREATE SCHEMA IF NOT EXISTS local_setup");
  await client.query("CREATE TABLE IF NOT EXISTS local_setup.migrations(version text PRIMARY KEY, sha256 text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())");
  const adminRole = await client.query("SELECT rolname FROM pg_roles WHERE rolname='hp_platform_admin_app'");
  if (!adminRole.rowCount) {
    if (existsSync(".env.platform-admin.local")) throw new Error("A configuração administrativa já existe, mas o papel do banco não está presente. Nenhuma credencial foi recriada.");
    const password = randomBytes(32).toString("hex");
    const roleSql = (await client.query("SELECT format('CREATE ROLE hp_platform_admin_app LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS', $1::text) AS sql", [password])).rows[0].sql;
    await client.query(roleSql);
    const runtimeUrl = new URL(process.env.LOCAL_ADMIN_DATABASE_URL || "");
    runtimeUrl.username = "hp_platform_admin_app";
    runtimeUrl.password = password;
    const key = randomBytes(32).toString("hex");
    newAdminEnvironment = `PLATFORM_ADMIN_DATABASE_URL='${runtimeUrl.toString()}'\nPLATFORM_ADMIN_TOTP_ENCRYPTION_KEY='${key}'\n`;
    process.env.PLATFORM_ADMIN_DATABASE_URL = runtimeUrl.toString();
    process.env.PLATFORM_ADMIN_TOTP_ENCRYPTION_KEY = key;
  } else if (!process.env.PLATFORM_ADMIN_DATABASE_URL || !process.env.PLATFORM_ADMIN_TOTP_ENCRYPTION_KEY) {
    throw new Error("O papel administrativo já existe, mas sua configuração local não foi encontrada. Nenhuma credencial foi alterada.");
  } else {
    const role = await client.query(`SELECT r.rolsuper,r.rolcreaterole,r.rolcreatedb,r.rolbypassrls,
      EXISTS(SELECT 1 FROM pg_auth_members m WHERE m.member=r.oid) AS has_memberships
      FROM pg_roles r WHERE r.rolname='hp_platform_admin_app'`);
    const current = role.rows[0];
    if (current.rolsuper || current.rolcreaterole || current.rolcreatedb || current.rolbypassrls || current.has_memberships)
      throw new Error("O papel administrativo local tem privilégios incompatíveis. Nenhuma permissão foi alterada.");
  }
  const directory = new URL("../local-postgres/", import.meta.url);
  for (const file of readdirSync(directory).filter(name => /^\d{3}-[a-z0-9-]+\.sql$/.test(name)).sort()) {
    const version = file.slice(0, -4), sql = readFileSync(new URL(file, directory), "utf8");
    const hash = migrationChecksum(sql);
    const old = (await client.query("SELECT sha256 FROM local_setup.migrations WHERE version=$1", [version])).rows[0];
    if (old && old.sha256 !== hash && !(version === "003-workshop-customization" &&
        old.sha256 === legacyCustomizationChecksum && await verifiedLegacyCustomization()))
      throw new Error("Migração aplicada foi alterada: " + version);
    if (!old) {
      if (version === "001-local") {
        const occupied = await client.query("SELECT nspname FROM pg_namespace WHERE nspname IN ('horse_power','service_catalog')");
        if (occupied.rowCount) throw new Error("Banco já contém schemas da aplicação sem histórico local. Nada será sobrescrito.");
      }
      if (version === "004-platform-admin") {
        const occupied = await client.query("SELECT 1 FROM pg_namespace WHERE nspname='platform_admin'");
        if (occupied.rowCount) throw new Error("O schema platform_admin já existe sem registro de migração. Nada será sobrescrito.");
      }
      await client.query(sql);
      await client.query("INSERT INTO local_setup.migrations(version,sha256) VALUES($1,$2)", [version, hash]);
    }
    console.log(version + (old ? ": checksum confirmado." : ": aplicada."));
  }
  await client.query("GRANT USAGE ON SCHEMA local_setup TO hp_local_app");
  await client.query("GRANT SELECT ON local_setup.migrations TO hp_local_app");
  await client.query("COMMIT");
  if (newAdminEnvironment) {
    writeFileSync(".env.platform-admin.local", newAdminEnvironment, { encoding: "utf8", mode: 0o600, flag: "wx" });
    console.log("Credenciais locais do processo administrativo criadas em arquivo ignorado pelo Git.");
  }
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  console.error("Migração local falhou:", error instanceof Error ? error.message.replace(/postgres(?:ql)?:\/\/\S+/g, "[conexão omitida]") : "erro");
  process.exitCode = 1;
} finally { await client.end(); }
