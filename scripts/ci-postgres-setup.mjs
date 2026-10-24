import { randomBytes } from "node:crypto";
import { appendFileSync } from "node:fs";
import pg from "pg";

function reject() {
  throw new Error("CI PostgreSQL setup is restricted to an isolated GitHub Actions loopback service.");
}

if (process.env.GITHUB_ACTIONS !== "true" || !process.env.GITHUB_ENV) reject();

let adminUrl;
try { adminUrl = new URL(process.env.CI_PG_ADMIN_URL || ""); } catch { reject(); }
if (!adminUrl || !["127.0.0.1", "localhost", "[::1]"].includes(adminUrl.hostname) ||
    adminUrl.pathname !== "/postgres" || adminUrl.search || adminUrl.hash ||
    decodeURIComponent(adminUrl.username) !== "postgres") reject();

const client = new pg.Client({ connectionString: adminUrl.toString(), ssl: false, connectionTimeoutMillis: 5000 });
const appPassword = randomBytes(32).toString("hex");
const platformPassword = randomBytes(32).toString("hex");
const totpKey = randomBytes(32).toString("hex");
const urlFor = (username, password) => {
  const value = new URL(adminUrl);
  value.username = username;
  value.password = password;
  value.pathname = "/horse_power_local";
  return value.toString();
};

try {
  await client.connect();
  const existing = await client.query(`SELECT
    EXISTS(SELECT 1 FROM pg_roles WHERE rolname IN ('hp_local_app','hp_platform_admin_app')) AS role_exists,
    EXISTS(SELECT 1 FROM pg_database WHERE datname='horse_power_local') AS database_exists`);
  if (existing.rows[0].role_exists || existing.rows[0].database_exists) reject();
  for (const [role, password] of [["hp_local_app", appPassword], ["hp_platform_admin_app", platformPassword]]) {
    const statement = (await client.query(
      "SELECT format('CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS', $1, $2) AS sql",
      [role, password],
    )).rows[0].sql;
    await client.query(statement);
  }
  await client.query("CREATE DATABASE horse_power_local ENCODING 'UTF8' TEMPLATE template0");
  await client.query("REVOKE ALL ON DATABASE horse_power_local FROM PUBLIC");
  await client.query("GRANT CONNECT ON DATABASE horse_power_local TO hp_local_app, hp_platform_admin_app");

  const variables = {
    LOCAL_DATABASE_URL: urlFor("hp_local_app", appPassword),
    LOCAL_ADMIN_DATABASE_URL: urlFor("postgres", decodeURIComponent(adminUrl.password)),
    PLATFORM_ADMIN_DATABASE_URL: urlFor("hp_platform_admin_app", platformPassword),
    PLATFORM_ADMIN_TOTP_ENCRYPTION_KEY: totpKey,
  };
  for (const value of Object.values(variables)) process.stdout.write(`::add-mask::${value}\n`);
  appendFileSync(process.env.GITHUB_ENV, Object.entries(variables).map(([key, value]) => `${key}=${value}`).join("\n") + "\n", { mode: 0o600 });
  console.log("Created a disposable horse_power_local database and restricted fictional CI roles.");
} finally {
  await client.end().catch(() => {});
}
