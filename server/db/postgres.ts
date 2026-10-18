import { AsyncLocalStorage } from "node:async_hooks";
import pg from "pg";
import { readFileSync } from "node:fs";
import type { DB } from "./database.js";

// Timestamps are text in the legacy contract; bigint aggregates stay exact JS integers.
pg.types.setTypeParser(20, (value) => {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new Error("Valor fora do limite seguro.");
  return n;
});
export function postgresSql(input: string) {
  let i = 0;
  let sql = input.replace(/'(?:''|[^'])*'|"(?:""|[^"])*"|\?/g, (token) =>
    token === "?" ? `$${++i}` : token,
  );
  sql = sql.replace(/group_concat\(/gi, "string_agg(");
  if (/INSERT OR IGNORE/i.test(sql))
    sql =
      sql.replace(/INSERT OR IGNORE/i, "INSERT") + " ON CONFLICT DO NOTHING";
  // Qualify tables so transaction pooling never depends on session search_path.
  const tables = new Set([
    "migrations",
    "tenants",
    "users",
    "memberships",
    "sessions",
    "customers",
    "vehicles",
    "vehicle_lookup_cache",
    "professionals",
    "catalog",
    "product_categories",
    "orders",
    "order_items",
    "stock_movements",
    "stock_invoices",
    "suppliers",
    "stock_invoice_products",
    "receivables",
    "cash_entries",
    "audit_events",
    "payment_installments",
    "payment_settings",
    "expense_templates",
    "payables",
    "cash_accounts",
    "cash_movements",
    "card_rates",
    "public_shares",
    "import_batches",
    "service_aliases",
    "service_merge_history",
    "admin_setup",
    "login_attempts",
    "capture_sessions",
    "external_catalog_links",
    "external_captures",
    "service_times",
    "checklists",
    "checklist_photos",
  ]);
  sql = sql.replace(
    /'(?:''|[^'])*'|\b(FROM|JOIN|UPDATE|INTO|TABLE)\s+("?[a-z_]+"?)/gi,
    (match, keyword, name) => {
      if (!keyword || !tables.has(name.replaceAll('"', ""))) return match;
      return `${keyword} horse_power.${name}`;
    },
  );
  return sql;
}
export function createPostgresDatabase(url = process.env.DATABASE_URL) {
  if (!url) throw new Error("Configure DATABASE_URL.");
  const pool = new pg.Pool({
    connectionString: url,
    max: 3,
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 20000,
    ssl: {
      rejectUnauthorized: true,
      ca: readFileSync(
        new URL("./certs/supabase-ca.crt", import.meta.url),
        "utf8",
      ),
    },
    query_timeout: 15000,
  });
  const context = new AsyncLocalStorage<pg.PoolClient>();
  async function query(sql: string, values: any[] = []) {
    const client = context.getStore();
    return (client || pool).query(postgresSql(sql), values);
  }
  const db = {
    prepare(sql: string) {
      return {
        async get(...v: any[]) {
          return (await query(sql, v)).rows[0];
        },
        async all(...v: any[]) {
          return (await query(sql, v)).rows;
        },
        async run(...v: any[]) {
          return { changes: (await query(sql, v)).rowCount || 0 };
        },
      };
    },
    async exec(sql: string) {
      await query(sql);
    },
    async transaction<T>(callback: () => Promise<T>): Promise<T> {
      if (context.getStore()) return callback();
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        // Serialize business mutations across serverless instances, including numbering
        // and receive/finalize races. Reads continue without this advisory lock.
        await client.query("SELECT pg_advisory_xact_lock(721834109)");
        const result = await context.run(client, callback);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
    async close() {
      await pool.end();
    },
  } satisfies DB & {
    transaction<T>(cb: () => Promise<T>): Promise<T>;
    close(): Promise<void>;
  };
  return db;
}
