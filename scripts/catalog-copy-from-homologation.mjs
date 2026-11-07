import { createHash } from "node:crypto";
import { createReadStream, openSync, closeSync, readFileSync, statSync, appendFileSync, unlinkSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
import pg from "pg";

const sourceRef = "vnclahdnirqlcbamodqy";
const expected = {
  brands: 102, classifications: 4, families: 928, bases: 928,
  services: 6491, models: 7534, repair_times: 836093,
};
const columns = {
  brands: ["id", "name"],
  classifications: ["id", "name"],
  families: ["id", "brand_id"],
  bases: ["id", "family_id", "service_count"],
  services: ["id", "name"],
  models: ["id", "brand_id", "family_id", "classification_id", "name", "fipe_code", "complete", "service_count", "base_id", "excluded_service_ids"],
  repair_times: ["id", "base_id", "model_id", "service_id", "service_name", "minutes", "time_identifier"],
};
const schema = [
  "CREATE TABLE brands(id TEXT PRIMARY KEY,name TEXT NOT NULL)",
  "CREATE TABLE classifications(id TEXT PRIMARY KEY,name TEXT NOT NULL)",
  "CREATE TABLE families(id TEXT PRIMARY KEY,brand_id TEXT NOT NULL REFERENCES brands(id))",
  "CREATE TABLE bases(id TEXT PRIMARY KEY,family_id TEXT NOT NULL REFERENCES families(id),service_count INTEGER)",
  "CREATE TABLE services(id TEXT PRIMARY KEY,name TEXT NOT NULL)",
  "CREATE TABLE models(id TEXT PRIMARY KEY,brand_id TEXT NOT NULL REFERENCES brands(id),family_id TEXT NOT NULL REFERENCES families(id),classification_id TEXT NOT NULL REFERENCES classifications(id),name TEXT NOT NULL,fipe_code TEXT,complete INTEGER,service_count INTEGER,base_id TEXT NOT NULL REFERENCES bases(id),excluded_service_ids TEXT)",
  "CREATE TABLE repair_times(id TEXT PRIMARY KEY,base_id TEXT REFERENCES bases(id),model_id TEXT REFERENCES models(id),service_id TEXT NOT NULL REFERENCES services(id),service_name TEXT,minutes REAL,time_identifier TEXT)",
];
const path = resolve(process.argv[2] || "");
const password = process.env.HP_CATALOG_SOURCE_PASSWORD;
if (process.env.GITHUB_ACTIONS !== "true" || process.env.GITHUB_EVENT_NAME !== "workflow_dispatch" ||
    !process.env.RUNNER_TEMP || !path.startsWith(resolve(process.env.RUNNER_TEMP) + "/") ||
    !password || /[\r\n]/.test(password) || !process.env.GITHUB_ENV) {
  throw new Error("Exportação restrita ao GitHub Actions manual, com segredo e arquivo temporário.");
}
for (const key of ["PGHOST","PGHOSTADDR","PGPORT","PGDATABASE","PGUSER","PGPASSWORD","PGSERVICE","PGOPTIONS"]) {
  if (process.env[key]) throw new Error("Variável PostgreSQL implícita não permitida.");
}
const url = new URL(`postgresql://hp_catalog_export_login.${sourceRef}@aws-1-ca-central-1.pooler.supabase.com:5432/postgres`);
url.password = password;
const source = new pg.Client({
  connectionString: url.toString(),
  ssl: { ca: readFileSync("server/db/certs/supabase-ca.crt", "utf8"), rejectUnauthorized: true },
  connectionTimeoutMillis: 15000,
  application_name: "hp-definitive-catalog-readonly-copy",
});
let db;
let created = false;
try {
  await source.connect();
  await source.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  const identity = (await source.query("SELECT current_database() db, current_user role, rolsuper, rolbypassrls FROM pg_roles WHERE rolname=current_user")).rows[0];
  if (identity?.db !== "postgres" || identity?.role !== "hp_catalog_export_login" || identity?.rolsuper || identity?.rolbypassrls) {
    throw new Error("Origem não corresponde ao login temporário e restrito da homologação.");
  }
  closeSync(openSync(path, "wx", 0o600));
  created = true;
  db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys=ON");
  for (const statement of schema) db.exec(statement);
  for (const [table, tableColumns] of Object.entries(columns)) {
    const insert = db.prepare(`INSERT INTO "${table}"(${tableColumns.map(c => `"${c}"`).join(",")}) VALUES(${tableColumns.map(() => "?").join(",")})`);
    let last = "00000000-0000-0000-0000-000000000000";
    let count = 0;
    db.exec("BEGIN");
    try {
      for (;;) {
        const result = await source.query(
          `SELECT ${tableColumns.map(c => `"${c}"`).join(",")} FROM service_catalog."${table}" WHERE id>$1::uuid ORDER BY id LIMIT 1000`,
          [last],
        );
        if (!result.rowCount) break;
        for (const row of result.rows) insert.run(...tableColumns.map(c => row[c] ?? null));
        count += result.rowCount;
        last = result.rows.at(-1).id;
      }
      if (count !== expected[table]) throw new Error(`Contagem divergente na origem: ${table}.`);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    console.log(JSON.stringify({ table, rows: count }));
  }
  if (db.prepare("PRAGMA integrity_check").get()?.integrity_check !== "ok" ||
      db.prepare("PRAGMA foreign_key_check").all().length) {
    throw new Error("A cópia temporária não passou na verificação de integridade.");
  }
  db.close();
  db = undefined;
  await source.query("COMMIT");
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  const sha256 = hash.digest("hex");
  appendFileSync(process.env.GITHUB_ENV, `CATALOG_SOURCE_SHA256=${sha256}\n`, { mode: 0o600 });
  console.log(JSON.stringify({ result: "verified-temporary-source", bytes: statSync(path).size, sha256 }));
} catch (error) {
  if (db) db.close();
  if (created) unlinkSync(path);
  await source.query("ROLLBACK").catch(() => {});
  throw error;
} finally {
  await source.end().catch(() => {});
}
