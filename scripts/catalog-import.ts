import { porteRateId } from "../shared/vehiclePorte.js";
import { createHash } from "node:crypto";
import { createReadStream, readFileSync, statSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";

const expectedSha256 = (process.env.CATALOG_SOURCE_SHA256 || "").trim().toLowerCase();
const releaseVersion = "2.0-quatro-portes";
const expected = {
  brands: 102,
  classifications: 4,
  families: 928,
  bases: 928,
  models: 7534,
  services: 6491,
  repair_times: 836093,
};
const expectedCategories = {
  compacto: 2161,
  medio: 2794,
  premium: 2579,
  pesado: 0,
};

export function matchesCategoryCounts(
  actual: Readonly<Record<string, number>>,
  expected: Readonly<Record<string, number>>,
) {
  return Object.entries(expected).every(
    ([category, count]) => (actual[category] ?? 0) === count,
  );
}
export function estimateCatalogImportPeak(databaseBytes: number, sourceBytes: number) {
  return databaseBytes + Math.ceil(sourceBytes * 1.4);
}

const tables = {
  brands: ["id", "name"],
  classifications: ["id", "name"],
  families: ["id", "brand_id"],
  bases: ["id", "family_id", "service_count"],
  services: ["id", "name"],
  models: [
    "id",
    "brand_id",
    "family_id",
    "classification_id",
    "name",
    "fipe_code",
    "complete",
    "service_count",
    "base_id",
    "excluded_service_ids",
  ],
  repair_times: [
    "id",
    "base_id",
    "model_id",
    "service_id",
    "service_name",
    "minutes",
    "time_identifier",
  ],
} as const;
type Table = keyof typeof tables;

export function assertTarget(env: NodeJS.ProcessEnv = process.env) {
  if (
    env.VERCEL ||
    env.NODE_ENV === "production" ||
    [
      "PGHOST",
      "PGHOSTADDR",
      "PGPORT",
      "PGDATABASE",
      "PGUSER",
      "PGPASSWORD",
      "PGSERVICE",
      "PGSERVICEFILE",
      "PGOPTIONS",
      "PGSSLMODE",
      "PGSSLCERT",
      "PGSSLKEY",
      "PGSSLROOTCERT",
    ].some((key) => env[key])
  )
    throw new Error(
      "Importação recusada por ambiente ou variável PostgreSQL implícita.",
    );
  let url: URL;
  try {
    url = new URL(env.CATALOG_IMPORT_DATABASE_URL || "");
  } catch {
    throw new Error(
      "Configure CATALOG_IMPORT_DATABASE_URL no ambiente protegido de execução.",
    );
  }
  if (!["postgres:", "postgresql:"].includes(url.protocol) || url.hash)
    throw new Error("Importação recusada: URL PostgreSQL inválida.");

  const target = env.CATALOG_IMPORT_TARGET || "local";
  const definitive = target === "horse-power-definitive";
  if (target === "homologation" || target === "homologation-direct" || definitive) {
    const directExecution = target === "homologation-direct";
    const projectRef = definitive ? "rvlovjpquozbrsszsxwe" : "vnclahdnirqlcbamodqy";
    const directHost = `db.${projectRef}.supabase.co`;
    const sessionUser = `hp_catalog_import_login.${projectRef}`;
    const directAllowed =
      url.hostname === directHost &&
      url.port === "5432" &&
      decodeURIComponent(url.username) === "hp_catalog_import_login";
    const poolerAllowed =
      /^aws-\\d+-ca-central-1\\.pooler\\.supabase\\.com$/.test(url.hostname) &&
      url.port === "5432" &&
      decodeURIComponent(url.username) === sessionUser;
    const params = [...url.searchParams.keys()];
    const executionConfirmed = directExecution
      ? env.CATALOG_HOMOLOGATION_DIRECT_AUTHORIZED === "true" &&
        env.CATALOG_IMPORT_CONFIRM === "CAT-008-HOMOLOGATION-DIRECT-IMPORT"
      : env.GITHUB_ACTIONS === "true" &&
        env.GITHUB_EVENT_NAME === "workflow_dispatch" &&
        env.CATALOG_IMPORT_CONFIRM === (definitive
          ? "HP-DEFINITIVE-CATALOG-IMPORT"
          : "CAT-008-HOMOLOGATION-IMPORT");
    const connectionAllowed = directAllowed || poolerAllowed;
    if (
      !executionConfirmed || env.CATALOG_RIGHTS_CONFIRMED !== "true" ||
      !url.password || url.pathname !== "/postgres" || !connectionAllowed ||
      params.some((key) => key !== "sslmode") ||
      (url.searchParams.has("sslmode") &&
        url.searchParams.get("sslmode") !== "require")
    )
      throw new Error(
        definitive
          ? "Importação recusada: Horse Power definitivo exige workflow_dispatch confirmado, direitos declarados e conexão restrita ao projeto rvlovjpquozbrsszsxwe."
          : directExecution
            ? "Importação recusada: execução direta exige autorização explícita, direitos declarados e conexão restrita ao projeto vnclahdnirqlcbamodqy."
            : "Importação recusada: homologação exige workflow_dispatch confirmado, direitos declarados e conexão do projeto vnclahdnirqlcbamodqy.",
      );
    url.search = "";
    return {
      connectionString: url.toString(),
      target: definitive ? "definitive" as const : "homologation" as const,
    };
  }

  if (
    target === "local" &&
    env.CATALOG_IMPORT_CONFIRM === "CAT-008-ISOLATED-LOCAL" &&
    ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) &&
    url.pathname === "/horse_power_cat008_test" &&
    !url.search &&
    !url.hash
  )
    return { connectionString: url.toString(), target: "local" as const };
  throw new Error(
    "Importação recusada: destino deve ser o PostgreSQL local isolado ou a homologação autorizada pelo workflow.",
  );
}

async function fileHash(path: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

function appendRows(
  hash: ReturnType<typeof createHash>,
  rows: Record<string, unknown>[],
  columns: readonly string[],
) {
  for (const row of rows)
    hash.update(
      JSON.stringify(columns.map((column) => row[column] ?? null)) + "\n",
    );
}

function sourceDigest(source: DatabaseSync, table: Table) {
  const columns = tables[table];
  const query = source.prepare(
    `SELECT ${columns.map((column) => `"${column}"`).join(",")} FROM "${table}" ORDER BY id`,
  );
  const hash = createHash("sha256");
  for (const row of query.iterate() as Iterable<Record<string, unknown>>)
    appendRows(hash, [row], columns);
  return hash.digest("hex");
}

async function targetDigest(
  client: pg.PoolClient,
  table: Table,
  relation = "service_catalog",
) {
  const columns = tables[table],
    hash = createHash("sha256");
  let last = "";
  for (;;) {
    const batch = await client.query(
      `SELECT ${columns.map((column) => `"${column}"`).join(",")} FROM ${relation}.${table} WHERE id>$1::uuid ORDER BY id LIMIT 1000`,
      [last || "00000000-0000-0000-0000-000000000000"],
    );
    if (!batch.rowCount) break;
    appendRows(hash, batch.rows as Record<string, unknown>[], columns);
    last = String(batch.rows.at(-1).id);
  }
  return hash.digest("hex");
}

function rowCount(source: DatabaseSync, table: Table) {
  return Number(source.prepare(`SELECT count(*) n FROM "${table}"`).get()?.n);
}

export function sourceSha256(env: NodeJS.ProcessEnv = process.env) {
  const hash = (env.CATALOG_SOURCE_SHA256 || "").trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hash))
    throw new Error("Configure CATALOG_SOURCE_SHA256 com o hash aprovado do SQLite convertido.");
  return hash;
}

export function readPorteCounts(source: DatabaseSync) {
  const rows = source.prepare(
    "SELECT c.id,c.name,count(m.id) n FROM classifications c LEFT JOIN models m ON m.classification_id=c.id GROUP BY c.id,c.name",
  ).all();
  if (rows.length !== 4) throw new Error("O catálogo deve conter somente os quatro portes.");
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const key = porteRateId(row.name);
    if (!key || key in counts) throw new Error("Porte inválido ou duplicado no catálogo convertido.");
    counts[key] = Number(row.n);
  }
  const orphaned = Number(source.prepare(
    "SELECT count(*) n FROM models m LEFT JOIN classifications c ON c.id=m.classification_id WHERE c.id IS NULL",
  ).get()?.n);
  if (orphaned) throw new Error("Há modelo sem porte no catálogo convertido.");
  return counts;
}

async function targetPorteCounts(client: pg.PoolClient) {
  const result = await client.query(
    "SELECT c.id,c.name,count(m.id)::int n FROM service_catalog.classifications c LEFT JOIN service_catalog.models m ON m.classification_id=c.id GROUP BY c.id,c.name",
  );
  if (result.rows.length !== 4) throw new Error("O destino não contém exatamente quatro portes.");
  const counts: Record<string, number> = {};
  for (const row of result.rows) {
    const key = porteRateId(row.name);
    if (!key || key in counts) throw new Error("Porte inválido ou duplicado no destino.");
    counts[key] = Number(row.n);
  }
  if (!matchesCategoryCounts(counts, expectedCategories))
    throw new Error("Distribuição dos quatro portes divergente.");
  return counts;
}

async function readSource(path: string) {
  const approvedHash = sourceSha256();
  if ((await fileHash(path)) !== approvedHash)
    throw new Error("SHA-256 da fonte diverge do SQLite convertido aprovado.");
  const source = new DatabaseSync(path, { readOnly: true });
  try {
    if (source.prepare("PRAGMA integrity_check").get()?.integrity_check !== "ok" ||
        source.prepare("PRAGMA foreign_key_check").all().length)
      throw new Error("Integridade SQLite inválida.");
    for (const [table, count] of Object.entries(expected) as [Table, number][]) {
      if (rowCount(source, table) !== count) throw new Error(`Contagem inesperada na origem: ${table}.`);
      const columns = new Set(source.prepare(`PRAGMA table_info("${table}")`).all().map((c) => String(c.name)));
      if (tables[table].some((column) => !columns.has(column)))
        throw new Error(`Estrutura incompatível na origem: ${table}.`);
    }
    if (!matchesCategoryCounts(readPorteCounts(source), expectedCategories))
      throw new Error("Distribuição dos quatro portes diverge da aprovada.");
    return source;
  } catch (error) { source.close(); throw error; }
}

async function existingReleaseIsValid(client: pg.PoolClient, source: DatabaseSync) {
  const release = await client.query(
    "SELECT status,source_sha256,model_count,time_count,application_count FROM service_catalog.releases WHERE version=$1", [releaseVersion],
  );
  if (!release.rowCount) return false;
  const row = release.rows[0];
  if (row.status === "loading" && row.source_sha256 === expectedSha256 &&
      Number(row.model_count) === expected.models && Number(row.time_count) === expected.repair_times &&
      Number(row.application_count) === 7292579) return false;
  if (row.status !== "active" || row.source_sha256 !== expectedSha256)
    throw new Error("Release existente divergente; nenhuma substituição foi feita.");
  await validateImportedCatalog(client, source);
  await targetPorteCounts(client);
  return true;
}

async function importTable(
  client: pg.PoolClient,
  source: DatabaseSync,
  table: Table,
) {
  const columns = tables[table];
  const iterator = source
    .prepare(
      `SELECT ${columns.map((column) => `"${column}"`).join(",")} FROM "${table}" ORDER BY id`,
    )
    .iterate() as IterableIterator<Record<string, unknown>>;
  const chunkSize = 1000;
  let imported = 0;
  let chunk: Record<string, unknown>[] = [];
  const flush = async () => {
    if (!chunk.length) return;
    const params: unknown[] = [];
    const values = chunk
      .map(
        (row) =>
          `(${columns
            .map((column) => {
              params.push(row[column] ?? null);
              return `$${params.length}`;
            })
            .join(",")})`,
      )
      .join(",");
    await client.query(
      `INSERT INTO service_catalog.${table}(${columns.map((column) => `"${column}"`).join(",")}) VALUES ${values}`,
      params,
    );
    imported += chunk.length;
    if (imported % 100000 === 0) console.log(JSON.stringify({ phase: "loading", table, rows: imported }));
    chunk = [];
  };
  for (const row of iterator) {
    chunk.push(row);
    if (chunk.length === chunkSize) await flush();
  }
  await flush();
  console.log(JSON.stringify({ phase: "loaded", table, rows: imported }));
}

async function validateImportedCatalog(client: pg.PoolClient, source: DatabaseSync) {
  for (const [table, count] of Object.entries(expected) as [Table, number][]) {
    const actual = Number(
      (await client.query(`SELECT count(*) n FROM service_catalog.${table}`)).rows[0]
        .n,
    );
    if (actual !== count)
      throw new Error(`Carga incompleta: ${table} (${actual}/${count}).`);
    const columns = tables[table];
    const hash = createHash("sha256");
    let last = "00000000-0000-0000-0000-000000000000";
    for (;;) {
      const result = await client.query(
        `SELECT ${columns.map((column) => `"${column}"`).join(",")} FROM service_catalog.${table} WHERE id>$1::uuid ORDER BY id LIMIT 1000`,
        [last],
      );
      if (!result.rowCount) break;
      appendRows(hash, result.rows as Record<string, unknown>[], columns);
      last = String(result.rows.at(-1).id);
    }
    if (hash.digest("hex") !== sourceDigest(source, table))
      throw new Error(`Hash de registros divergente no estágio: ${table}.`);
  }
  const checks = await client.query(`
    SELECT
      (SELECT count(*) FROM service_catalog.families f LEFT JOIN service_catalog.brands b ON b.id=f.brand_id WHERE b.id IS NULL) AS bad_families,
      (SELECT count(*) FROM service_catalog.bases b LEFT JOIN service_catalog.families f ON f.id=b.family_id WHERE f.id IS NULL) AS bad_bases,
      (SELECT count(*) FROM service_catalog.models m LEFT JOIN service_catalog.brands b ON b.id=m.brand_id LEFT JOIN service_catalog.families f ON f.id=m.family_id
        LEFT JOIN service_catalog.classifications c ON c.id=m.classification_id LEFT JOIN service_catalog.bases base ON base.id=m.base_id
        WHERE b.id IS NULL OR f.id IS NULL OR c.id IS NULL OR base.id IS NULL OR f.brand_id<>m.brand_id OR base.family_id<>m.family_id OR
          jsonb_typeof(m.excluded_service_ids::jsonb)<>'array') AS bad_models,
      (SELECT count(*) FROM service_catalog.repair_times t LEFT JOIN service_catalog.services s ON s.id=t.service_id
        LEFT JOIN service_catalog.models m ON m.id=t.model_id LEFT JOIN service_catalog.bases b ON b.id=t.base_id
        WHERE s.id IS NULL OR (t.model_id IS NOT NULL AND m.id IS NULL) OR (t.base_id IS NOT NULL AND b.id IS NULL)) AS bad_times,
      (SELECT count(*) FROM service_catalog.repair_times WHERE minutes<0 OR (base_id IS NULL)=(model_id IS NULL)) AS bad_targets,
      (SELECT coalesce(sum(x.n),0) FROM service_catalog.models m JOIN (SELECT base_id,count(*) n FROM service_catalog.repair_times WHERE base_id IS NOT NULL GROUP BY base_id) x ON x.base_id=m.base_id) AS logical_applications`);
  const row = checks.rows[0];
  if (
    [
      row.bad_families,
      row.bad_bases,
      row.bad_models,
      row.bad_times,
      row.bad_targets,
    ].some((value) => Number(value) !== 0) ||
    Number(row.logical_applications) !== 7292579
  )
    throw new Error(
      "Validação de chaves, destinos dos tempos ou aplicações lógicas falhou.",
    );
}

async function main() {
  const args = process.argv.slice(2);
  const sourceArg = args.find((arg) => !arg.startsWith("--"));
  if (!sourceArg) throw new Error("Informe explicitamente o caminho do SQLite convertido.");
  const sourcePath = resolve(sourceArg);
  const source = await readSource(sourcePath);
  if (args.includes("--verify-source")) {
    try { console.log(JSON.stringify({ source_sha256: expectedSha256, counts: expected, portes: readPorteCounts(source), verified: true }, null, 2)); }
    finally { source.close(); }
    return;
  }
  const target = assertTarget();
  const pool = new pg.Pool({ connectionString: target.connectionString,
    ssl: target.target !== "local" ? { ca: readFileSync(resolve("server/db/certs/supabase-ca.crt"), "utf8"), rejectUnauthorized: true } : false,
    max: 1, connectionTimeoutMillis: 15000, application_name: `cat009-${target.target}-import`,
  });
  let client: pg.PoolClient | undefined;
  try {
    client = await pool.connect();
    if (target.target === "local") {
      const identity = await client.query("SELECT current_database() db,current_user role,r.rolsuper superuser FROM pg_roles r WHERE r.rolname=current_user");
      if (identity.rows[0]?.db !== "horse_power_cat008_test" || !identity.rows[0]?.superuser)
        throw new Error("Destino local recusado: exige o banco descartável isolado.");
    } else {
      const session = await client.query(`SELECT current_database() db,
        pg_has_role(session_user,'hp_catalog_importer','MEMBER') member,
        coalesce((SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname=session_user),true) elevated`);
      if (session.rows[0]?.db !== "postgres" || session.rows[0]?.member !== true || session.rows[0]?.elevated !== false)
        throw new Error("Login de importação sem escopo restrito.");
      await client.query("SET ROLE hp_catalog_importer");
    }
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(202610250008)");
    if (await existingReleaseIsValid(client, source)) {
      await client.query("COMMIT"); console.log("Catálogo já íntegro; nenhuma duplicação foi feita."); return;
    }
    for (const table of Object.keys(tables) as Table[]) {
      if (Number((await client.query(`SELECT count(*) n FROM service_catalog.${table}`)).rows[0].n))
        throw new Error("Destino ocupado: a instalação do catálogo convertido exige procedimento autorizado separado; nenhum registro será apagado.");
    }
    if ((await client.query("SELECT 1 FROM service_catalog.releases WHERE status='active' LIMIT 1")).rowCount)
      throw new Error("Existe uma release ativa; nenhuma substituição foi feita.");
    if (target.target === "homologation") {
      const size = Number((await client.query("SELECT pg_database_size(current_database())::bigint n")).rows[0].n);
      if (estimateCatalogImportPeak(size, statSync(sourcePath).size) > 450 * 1024 * 1024)
        throw new Error("Projeção de armazenamento excede 450 MiB.");
    }
    await client.query(`INSERT INTO service_catalog.releases(version,status,source_sha256,model_count,time_count,application_count)
      VALUES($1,'loading',$2,7534,836093,7292579) ON CONFLICT(version) DO NOTHING`, [releaseVersion, expectedSha256]);
    for (const table of Object.keys(tables) as Table[]) await importTable(client, source, table);
    await validateImportedCatalog(client, source);
    const portes = await targetPorteCounts(client);
    const size = Number((await client.query("SELECT pg_database_size(current_database())::bigint n")).rows[0].n);
    if (target.target !== "local" && size > 450 * 1024 * 1024)
      throw new Error("Tamanho real excede 450 MiB; a carga será revertida.");
    const activated = await client.query("UPDATE service_catalog.releases SET status='active',validated_at=statement_timestamp() WHERE version=$1 AND source_sha256=$2 AND status='loading'", [releaseVersion, expectedSha256]);
    if (activated.rowCount !== 1) throw new Error("A release não pôde ser ativada.");
    await client.query("COMMIT");
    console.log(JSON.stringify({ target: target.target, source_sha256: expectedSha256, counts: expected, portes, database_bytes: size, version: releaseVersion }, null, 2));
  } catch (error) { await client?.query("ROLLBACK").catch(() => {}); throw error; }
  finally { client?.release(); await pool.end(); source.close(); }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
  main().catch((error) => { console.error("Importação não concluída:", error instanceof Error ? error.message : "erro"); process.exitCode = 1; });
