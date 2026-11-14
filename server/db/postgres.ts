import { localDatabaseUrl } from "../localConfig.js";
import { AsyncLocalStorage } from "node:async_hooks";
import pg from "pg";
import { readFileSync } from "node:fs";
import type { DB } from "./database.js";
import { defaultWorkshopModules } from "../../shared/workshopModules.js";

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
    "session_office_choices", "workshop_user_access", "staff_accounts", "workshop_user_invites", "session_reauthentication", "order_assignments", "discount_requests",
    "sessions",
    "customers",
    "vehicles",
    "vehicle_lookup_cache",
    "labor_portes",
    "labor_rates",
    "labor_categories",
    "labor_commercial_rates",
    "workshop_services",
    "workshop_service_categories",
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
    "card_machines",
    "card_machine_rates",
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
    "document_revisions",
    "data_transfer_records",
    "data_transfer_backups",
    "data_transfer_archived_documents",
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
export function createPostgresDatabase(url = process.env.DATABASE_URL, options: { local?: boolean } = {}) {
  if (!url) throw new Error("Configure DATABASE_URL.");
  if (options.local) url = localDatabaseUrl(url);
  const pool = new pg.Pool({
    connectionString: url,
    max: 3,
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 20000,
    ssl: options.local ? false : {
      rejectUnauthorized: true,
      ca: readFileSync(
        new URL("./certs/supabase-ca.crt", import.meta.url),
        "utf8",
      ),
    },
    query_timeout: 15000,
  });
  const context = new AsyncLocalStorage<pg.PoolClient>();
  async function setRequestIdentity(tenantId: string | null, userId?: string | null, publicShareHash?: string | null) {
    const client = context.getStore();
    if (!client) throw new Error("O contexto seguro da requisição não está ativo.");
    await client.query(
      "SELECT set_config('app.tenant_id',$1,true),set_config('app.user_id',$2,true),set_config('app.public_share_hash',$3,true)",
      [tenantId || "", userId || "", publicShareHash || ""],
    );
  }
  async function query(sql: string, values: any[] = []) {
    const client = context.getStore();
    return (client || pool).query(postgresSql(sql), values);
  }
  const db = {
    async withRequestContext<T>(
      settings: Record<string, string>,
      callback: () => Promise<T>,
      shouldCommit: () => boolean = () => true,
    ): Promise<T> {
      const active = context.getStore();
      if (active) {
        for (const [key, value] of Object.entries(settings)) {
          if (!/^app\.[a-z_]+$/.test(key)) throw new Error("Configuração de requisição inválida.");
          await active.query("SELECT set_config($1,$2,true)", [key, value]);
        }
        const result = await callback();
        if (!shouldCommit()) throw new Error("A requisição foi revertida.");
        return result;
      }
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const names = [
          "app.tenant_id", "app.user_id", "app.session_hash", "app.login_email", "app.login_key",
          "app.setup_hash", "app.public_share_hash", "app.extension_hash",
        ];
        for (const name of names) await client.query("SELECT set_config($1,$2,true)", [name, settings[name] || ""]);
        await client.query("SELECT set_config('app.platform_admin_transfer','',true)");
        for (const [key, value] of Object.entries(settings)) {
          if (!names.includes(key)) throw new Error("Configuração de requisição inválida.");
          await client.query("SELECT set_config($1,$2,true)", [key, value]);
        }
        const result = await context.run(client, callback);
        if (!shouldCommit()) await client.query("ROLLBACK");
        else await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
    setRequestIdentity,
    async hasUserAccessSchema(){return (await pool.query("SELECT to_regclass('horse_power.workshop_user_access') IS NOT NULL AS installed")).rows[0]?.installed===true;},
    async recordAccessAttempt(key:string){return (await pool.query("SELECT horse_power.record_user_access_attempt($1) AS allowed",[key])).rows[0]?.allowed===true;},
    async getTenantAccessState(tenant: string) {
      const result = await query("SELECT horse_power.local_tenant_access_state($1) AS state", [tenant]);
      return String(result.rows[0]?.state || "legacy");
    },
    async getTenantModuleAccess(tenant: string) {
      try {
        const result = await query("SELECT horse_power.local_tenant_module_access($1) AS modules", [tenant]);
        const value = result.rows[0]?.modules;
        return { ...defaultWorkshopModules, ...(value && typeof value === "object" ? value : {}) };
      } catch (error) {
        // The additive migration may not be installed yet during a Vercel Preview.
        if ((error as { code?: string }).code === "42883") return { ...defaultWorkshopModules };
        throw error;
      }
    },
    async getTenantPlanSummary(tenant: string) {
      const identity = await query("SELECT current_setting('app.tenant_id',true) AS tenant_id,current_setting('app.user_id',true) AS user_id");
      if (identity.rows[0]?.tenant_id !== tenant || !identity.rows[0]?.user_id) return null;
      try {
        const result = await query("SELECT horse_power.local_tenant_plan_summary($1) AS plan", [tenant]);
        return result.rows[0]?.plan || null;
      } catch (error) {
        if ((error as {code?:string}).code === "42883") return null;
        throw error;
      }
    },
    async getTenantCatalogIncluded(tenant: string) {
      const identity = await query("SELECT current_setting('app.tenant_id',true) AS tenant_id,current_setting('app.user_id',true) AS user_id");
      if (identity.rows[0]?.tenant_id !== tenant || !identity.rows[0]?.user_id) return false;
      try {
        const result = await query("SELECT horse_power.local_tenant_catalog_included($1) AS included", [tenant]);
        return result.rows[0]?.included === true;
      } catch (error) {
        if ((error as { code?: string }).code === "42883") return false;
        throw error;
      }
    },
    async lockTenantMutations(tenant: string) {
      if (!tenant) return;
      const client = context.getStore();
      if (!client) throw new Error("A alteração exige uma transação autenticada.");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 2089))", [tenant]);
    },
    async withTenantRead<T>(tenant: string, callback: () => Promise<T>): Promise<T> {
      const active = context.getStore();
      if (active) {
        await active.query("SELECT set_config('app.tenant_id',$1,true)", [tenant]);
        return callback();
      }
      const client = await pool.connect();
      try {
        await client.query("BEGIN READ ONLY");
        await client.query("SELECT set_config('app.tenant_id',$1,true),set_config('app.user_id','',true),set_config('app.platform_admin_transfer','',true)", [tenant]);
        const result = await context.run(client, callback);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally { client.release(); }
    },
    async withTenantServiceRead<T>(tenant: string, callback: () => Promise<T>): Promise<T> {
      if (context.getStore()) throw new Error("A leitura administrativa exige uma transação isolada.");
      const client = await pool.connect();
      try {
        await client.query("BEGIN READ ONLY");
        await client.query("SELECT set_config('app.tenant_id',$1,true),set_config('app.user_id','',true),set_config('app.platform_admin_transfer','on',true)", [tenant]);
        const result = await context.run(client, callback);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally { client.release(); }
    },
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

