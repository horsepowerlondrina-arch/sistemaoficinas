import { existsSync } from "node:fs";
import pg from "pg";
import { assertLocalProcess, localDatabaseUrl } from "../server/localConfig.js";
export function adminClient() {
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  assertLocalProcess();
  return new pg.Client({ connectionString: localDatabaseUrl(process.env.LOCAL_ADMIN_DATABASE_URL, true), ssl: false, connectionTimeoutMillis: 5000 });
}
