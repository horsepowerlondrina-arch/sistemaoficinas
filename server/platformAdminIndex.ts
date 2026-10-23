import { existsSync } from "node:fs";
if (existsSync(".env.local")) process.loadEnvFile(".env.local");
if (existsSync(".env.platform-admin.local")) process.loadEnvFile(".env.platform-admin.local");
import pg from "pg";
import { assertLocalProcess, platformAdminDatabaseUrl } from "./localConfig.js";
import { assertPlatformAdminDatabase, createPlatformAdminApp } from "./platformAdminApp.js";

assertLocalProcess();
const key = process.env.PLATFORM_ADMIN_TOTP_ENCRYPTION_KEY || "";
if (!/^[a-f0-9]{64}$/i.test(key)) throw new Error("Execute npm run db:local:migrate para preparar o painel central.");
const pool = new pg.Pool({ connectionString: platformAdminDatabaseUrl(process.env.PLATFORM_ADMIN_DATABASE_URL), ssl: false, max: 3, connectionTimeoutMillis: 5000, idleTimeoutMillis: 20000, query_timeout: 10000 });
await assertPlatformAdminDatabase(pool);
const migration = await pool.query("SELECT to_regclass('platform_admin.administrators') AS table_name");
if (!migration.rows[0]?.table_name) throw new Error("Execute npm run db:local:migrate antes de iniciar o painel central.");
const server = createPlatformAdminApp(pool, key).listen(3002, "127.0.0.1", () =>
  console.log("Painel central local disponível em http://127.0.0.1:5173/admin"),
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => server.close(() => { void pool.end().then(() => process.exit(0)); }));
