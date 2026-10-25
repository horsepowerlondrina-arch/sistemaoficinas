import { createHash } from "node:crypto";
import { createReadStream, readFileSync, statSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";

const expectedSha256 =
  "5557e09a16362452e1a5716164e9cc0e13d48a26140c1682ffdc5ae48b0eefaa";
const expected = {
  brands: 102,
  classifications: 14,
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

const technicalCategoryMap: Record<string, string> = {
  "Básico Elétrico": "compacto",
  "SUV Compacto": "compacto",
  "SUV Médio": "medio",
  "SUV e Sedan Elétrico": "medio",
  "Utilitário Compacto": "compacto",
  "Utilitário Médio": "medio",
  "Utilitário Médio Diesel": "medio",
  "SUV Premium": "premium",
  "SUV Premium Diesel": "premium",
  "Utilitário Premium": "premium",
  "Veículo Compacto": "compacto",
  "Veículo Médio": "medio",
  "Veículo Premium": "premium",
  "Veículo de Luxo": "premium",
};
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
  if (target === "homologation" || target === "homologation-direct") {
    const directExecution = target === "homologation-direct";
    const projectRef = "vnclahdnirqlcbamodqy";
    const directHost = `db.${projectRef}.supabase.co`;
    const sessionUser = `hp_catalog_import_login.${projectRef}`;
    const directAllowed =
      url.hostname === directHost &&
      url.port === "5432" &&
      decodeURIComponent(url.username) === "hp_catalog_import_login";
    const poolerAllowed =
      /^aws-\d+-ca-central-1\.pooler\.supabase\.com$/.test(url.hostname) &&
      url.port === "5432" &&
      decodeURIComponent(url.username) === sessionUser;
    const params = [...url.searchParams.keys()];
    const executionConfirmed = directExecution
      ? env.CATALOG_HOMOLOGATION_DIRECT_AUTHORIZED === "true" &&
        env.CATALOG_IMPORT_CONFIRM === "CAT-008-HOMOLOGATION-DIRECT-IMPORT"
      : env.GITHUB_ACTIONS === "true" &&
        env.GITHUB_EVENT_NAME === "workflow_dispatch" &&
        env.CATALOG_IMPORT_CONFIRM === "CAT-008-HOMOLOGATION-IMPORT";
    const connectionAllowed = directAllowed || poolerAllowed;
    if (
      !executionConfirmed ||
      env.CATALOG_RIGHTS_CONFIRMED !== "true" ||
      !url.password ||
      url.pathname !== "/postgres" ||
      !connectionAllowed ||
      params.some((key) => key !== "sslmode") ||
      (url.searchParams.has("sslmode") &&
        url.searchParams.get("sslmode") !== "require")
    )
      throw new Error(
        directExecution
          ? "Importação recusada: execução direta exige autorização explícita, direitos declarados e conexão restrita ao projeto vnclahdnirqlcbamodqy."
          : "Importação recusada: homologação exige workflow_dispatch confirmado, direitos declarados e conexão do projeto vnclahdnirqlcbamodqy.",
      );
    url.search = "";
    return {
      connectionString: url.toString(),
      target: "homologation" as const,
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

function approvedOverrideIds() {
  const migration = readFileSync(
    resolve(
      "supabase/migrations/20261023000200_catalog_labor_category_overrides.sql",
    ),
    "utf8",
  );
  const ids = [
    ...migration.matchAll(/\('([0-9a-f-]{36})'\s*::\s*uuid\s*,\s*'premium'/gi),
  ].map((match) => match[1].toLowerCase());
  if (ids.length !== 51 || new Set(ids).size !== 51)
    throw new Error(
      "A migração CAT-007 não contém os 51 UUIDs únicos aprovados.",
    );
  return new Set(ids);
}

function mappedCommercialRow(
  row: Record<string, unknown>,
  overrides: Set<string>,
) {
  const override = overrides.has(String(row.model_id).toLowerCase());
  const category = override
    ? "premium"
    : technicalCategoryMap[String(row.technical_name)];
  const assignment = override ? "reviewed" : "automatic";
  const reason = override
    ? "CAT-007: exceção comercial aprovada; validação técnica externa não realizada."
    : "Classificação comercial operacional v1 derivada do porte técnico; não representa validação técnica externa.";
  return [
    row.model_id,
    category,
    row.classification_id,
    assignment,
    "confirmed",
    reason,
  ];
}

function sourceCommercialDigest(source: DatabaseSync) {
  const overrides = approvedOverrideIds(),
    hash = createHash("sha256");
  const rows = source
    .prepare(
      "SELECT m.id model_id,m.classification_id,c.name technical_name FROM models m JOIN classifications c ON c.id=m.classification_id ORDER BY m.id",
    )
    .iterate() as Iterable<Record<string, unknown>>;
  for (const row of rows)
    hash.update(JSON.stringify(mappedCommercialRow(row, overrides)) + "\n");
  return hash.digest("hex");
}

async function targetCommercialDigest(client: pg.PoolClient) {
  const hash = createHash("sha256");
  let last = "00000000-0000-0000-0000-000000000000";
  for (;;) {
    const batch = await client.query(
      `SELECT model_id,category_id,technical_classification_id,assignment_source,review_status,change_reason FROM service_catalog.model_labor_categories WHERE model_id>$1::uuid ORDER BY model_id LIMIT 1000`,
      [last],
    );
    if (!batch.rowCount) break;
    appendRows(hash, batch.rows as Record<string, unknown>[], [
      "model_id",
      "category_id",
      "technical_classification_id",
      "assignment_source",
      "review_status",
      "change_reason",
    ]);
    last = String(batch.rows.at(-1).model_id);
  }
  return hash.digest("hex");
}

async function readSource(path: string) {
  if ((await fileHash(path)) !== expectedSha256)
    throw new Error("SHA-256 da fonte diverge do pacote operacional aprovado.");
  const source = new DatabaseSync(path, { readOnly: true });
  for (const [table, count] of Object.entries(expected) as [Table, number][]) {
    if (rowCount(source, table) !== count)
      throw new Error(`Contagem inesperada na origem: ${table}.`);
    const actual = new Set(
      source
        .prepare(`PRAGMA table_info("${table}")`)
        .all()
        .map((column: any) => String(column.name)),
    );
    if (tables[table].some((column) => !actual.has(column)))
      throw new Error(`Estrutura incompatível na origem: ${table}.`);
  }
  const categories = source
    .prepare(
      `SELECT c.name,count(m.id) n FROM classifications c LEFT JOIN models m ON m.classification_id=c.id GROUP BY c.id,c.name`,
    )
    .all();
  if (categories.length !== 14)
    throw new Error("A origem não contém os 14 portes técnicos esperados.");
  const unmapped = categories.filter(
    (row: any) => !(String(row.name) in technicalCategoryMap),
  );
  if (unmapped.length)
    throw new Error("Há porte técnico sem correspondência comercial aprovada.");
  const counts: Record<string, number> = {
    compacto: 0,
    medio: 0,
    premium: 0,
    pesado: 0,
  };
  for (const row of categories as { name: string; n: number }[])
    counts[technicalCategoryMap[row.name]] += Number(row.n);
  const overrideIds = approvedOverrideIds();
  const model = source.prepare(
    "SELECT classification_id FROM models WHERE id=?",
  );
  const className = source.prepare(
    "SELECT name FROM classifications WHERE id=?",
  );
  for (const id of overrideIds) {
    const row = model.get(id) as { classification_id: string } | undefined;
    if (!row)
      throw new Error(`UUID CAT-007 ausente no catálogo operacional: ${id}.`);
    const original =
      technicalCategoryMap[
        String(
          (className.get(row.classification_id) as { name: string } | undefined)
            ?.name,
        )
      ];
    if (!original || original === "premium")
      throw new Error(`Exceção CAT-007 sem mudança aplicável: ${id}.`);
    counts[original]--;
    counts.premium++;
  }
  if (
    !matchesCategoryCounts(counts, expectedCategories)
  )
    throw new Error(
      "Distribuição comercial derivada da fonte e exceções CAT-007 diverge da aprovada.",
    );
  return source;
}

async function existingReleaseIsValid(
  client: pg.PoolClient,
  source: DatabaseSync,
) {
  const release = await client.query(
    "SELECT status,source_sha256,model_count,time_count,application_count FROM service_catalog.releases WHERE version='1.2-operacional'",
  );
  if (!release.rowCount) return false;
  if (
    release.rows[0].status === "loading" &&
    ["pending", expectedSha256].includes(release.rows[0].source_sha256) &&
    Number(release.rows[0].model_count) === expected.models &&
    Number(release.rows[0].time_count) === expected.repair_times &&
    Number(release.rows[0].application_count) === 7292579
  )
    return false;
  if (
    release.rows[0].source_sha256 !== expectedSha256 ||
    release.rows[0].status !== "active"
  )
    throw new Error(
      "Já existe uma release 1.2-operacional diferente ou inativa; nenhuma substituição foi feita.",
    );
  for (const [table, count] of Object.entries(expected) as [Table, number][]) {
    const actual = Number(
      (await client.query(`SELECT count(*) n FROM service_catalog.${table}`))
        .rows[0].n,
    );
    if (
      actual !== count ||
      sourceDigest(source, table) !== (await targetDigest(client, table))
    )
      throw new Error(`A release já instalada diverge da fonte: ${table}.`);
  }
  const categories = await client.query(
    "SELECT category_id,count(*)::int n FROM service_catalog.model_labor_categories GROUP BY category_id",
  );
  const actual = Object.fromEntries(
    categories.rows.map((row) => [row.category_id, row.n]),
  );
  if (
    !matchesCategoryCounts(actual, expectedCategories)
  )
    throw new Error(
      "A release existente tem distribuição comercial divergente.",
    );
  const categoryHash = await client.query(
    "SELECT count(*)::int n FROM service_catalog.model_labor_categories",
  );
  if (categoryHash.rows[0].n !== expected.models)
    throw new Error("A release existente não classifica todos os modelos.");
  if ((await targetCommercialDigest(client)) !== sourceCommercialDigest(source))
    throw new Error(
      "Classificações comerciais existentes divergem dos UUIDs aprovados.",
    );
  const actualOverrides = Number(
    (
      await client.query(`SELECT count(*)::int n FROM service_catalog.model_labor_category_overrides o
    JOIN service_catalog.model_labor_categories c ON c.model_id=o.model_id AND c.category_id='premium'`)
    ).rows[0].n,
  );
  if (actualOverrides !== 51)
    throw new Error(
      "A release existente não contém as 51 exceções CAT-007 aprovadas.",
    );
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
    chunk = [];
  };
  for (const row of iterator) {
    chunk.push(row);
    if (chunk.length === chunkSize) await flush();
  }
  await flush();
}

async function importCommercialCategories(
  client: pg.PoolClient,
  source: DatabaseSync,
) {
  const overrideIds = approvedOverrideIds();
  const rows = source
    .prepare(
      `SELECT m.id model_id,m.classification_id,c.name technical_name FROM models m JOIN classifications c ON c.id=m.classification_id ORDER BY m.id`,
    )
    .iterate() as IterableIterator<Record<string, unknown>>;
  let chunk: Record<string, unknown>[] = [];
  const flush = async () => {
    if (!chunk.length) return;
    const params: unknown[] = [];
    const values = chunk
      .map((row) => {
        const mapped = mappedCommercialRow(row, overrideIds);
        return `(${mapped
          .map((value) => {
            params.push(value ?? null);
            return `$${params.length}`;
          })
          .join(",")})`;
      })
      .join(",");
    await client.query(
      `INSERT INTO service_catalog.model_labor_categories(model_id,category_id,technical_classification_id,assignment_source,review_status,change_reason) VALUES ${values}`,
      params,
    );
    chunk = [];
  };
  for (const row of rows) {
    chunk.push(row);
    if (chunk.length === 1000) await flush();
  }
  await flush();
  const actual = await client.query(
    "SELECT category_id,count(*)::int n FROM service_catalog.model_labor_categories GROUP BY category_id",
  );
  const counts = Object.fromEntries(
    actual.rows.map((row) => [row.category_id, row.n]),
  );
  if (
    Number(
      (await client.query("SELECT count(*) n FROM service_catalog.model_labor_categories"))
        .rows[0].n,
    ) !== expected.models ||
    !matchesCategoryCounts(counts, expectedCategories)
  )
    throw new Error(
      "Categorias comerciais incompletas ou divergentes.",
    );
  return sourceCommercialDigest(source);
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
  const sourcePath = resolve(
    sourceArg || "C:/Users/horse/Documents/catalogo.sqlite",
  );
  const source = await readSource(sourcePath);
  if (args.includes("--verify-source")) {
    const technical = source
      .prepare(
        "SELECT c.id,c.name,count(m.id) n FROM classifications c LEFT JOIN models m ON m.classification_id=c.id GROUP BY c.id,c.name ORDER BY c.name",
      )
      .all() as { id: string; name: string; n: number }[];
    const categories: Record<string, number> = {
      compacto: 0,
      medio: 0,
      premium: 0,
      pesado: 0,
    };
    for (const row of technical)
      categories[technicalCategoryMap[row.name]] += Number(row.n);
    const ids = approvedOverrideIds();
    for (const id of ids) {
      const model = source
        .prepare("SELECT classification_id FROM models WHERE id=?")
        .get(id) as { classification_id: string } | undefined;
      const name = technical.find(
        (item) => item.id === model?.classification_id,
      )?.name;
      const original = technicalCategoryMap[String(name)];
      categories[original]--;
      categories.premium++;
    }
    console.log(
      JSON.stringify(
        {
          source_sha256: expectedSha256,
          counts: expected,
          technical_classifications: technical.map(({ name, n }) => ({
            name,
            count: Number(n),
          })),
          commercial_categories: categories,
          cat007_overrides: ids.size,
          verified: true,
        },
        null,
        2,
      ),
    );
    source.close();
    return;
  }
  const target = assertTarget();
  const pool = new pg.Pool({
    connectionString: target.connectionString,
    ssl:
      target.target === "homologation"
        ? {
            ca: readFileSync(
              resolve("server/db/certs/supabase-ca.crt"),
              "utf8",
            ),
            rejectUnauthorized: true,
          }
        : false,
    max: 1,
    connectionTimeoutMillis: 15000,
    application_name: `cat008-${target.target}-import`,
  });
  const client = await pool.connect();
  try {
    if (target.target === "local") {
      const identity = await client.query(
        "SELECT current_database() db,current_user role,r.rolsuper superuser FROM pg_roles r WHERE r.rolname=current_user",
      );
      if (
        identity.rows[0]?.db !== "horse_power_cat008_test" ||
        !identity.rows[0]?.superuser
      )
        throw new Error(
          "Destino recusado: a importação local exige o administrador do banco isolado horse_power_cat008_test.",
        );
    } else {
      const session =
        await client.query(`SELECT current_database() db,session_user login,
        pg_has_role(session_user,'hp_catalog_importer','MEMBER') member,
        coalesce((SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname=session_user),true) elevated`);
      if (
        session.rows[0]?.db !== "postgres" ||
        session.rows[0]?.member !== true ||
        session.rows[0]?.elevated !== false
      )
        throw new Error(
          "Destino recusado: o login não tem somente a associação limitada hp_catalog_importer.",
        );
      await client.query("SET ROLE hp_catalog_importer");
      if (target.target !== "homologation")
        throw new Error("Destino de homologação não confirmado.");
    }
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(202610250008)");
    if (await existingReleaseIsValid(client, source)) {
      await client.query("COMMIT");
      console.log("Catálogo já íntegro: nenhuma duplicação foi feita.");
      return;
    }
    await client.query(
      "SELECT service_catalog.prepare_catalog_import_for_cat008()",
    );
    const occupied = await client.query(`SELECT
      (SELECT count(*) FROM service_catalog.brands) brands,(SELECT count(*) FROM service_catalog.classifications) classifications,
      (SELECT count(*) FROM service_catalog.families) families,(SELECT count(*) FROM service_catalog.bases) bases,
      (SELECT count(*) FROM service_catalog.models) models,(SELECT count(*) FROM service_catalog.services) services,
      (SELECT count(*) FROM service_catalog.repair_times) repair_times,
      (SELECT count(*) FROM service_catalog.model_labor_categories) model_categories,
      (SELECT count(*) FROM service_catalog.releases WHERE status='active') active_releases`);
    if (Object.values(occupied.rows[0]).some((value) => Number(value) !== 0))
      throw new Error(
        "Destino ocupado; use um banco local isolado vazio. Nenhuma linha foi removida ou sobrescrita.",
      );
    if (target.target === "homologation") {
      const sizes = await client.query(
        "SELECT pg_database_size(current_database())::bigint database_bytes",
      );
      const projectedPeak = estimateCatalogImportPeak(
        Number(sizes.rows[0].database_bytes),
        statSync(sourcePath).size,
      );
      if (projectedPeak > 450 * 1024 * 1024)
        throw new Error(
          `Carga abortada antes da gravação: pico projetado ${projectedPeak} bytes excede o teto operacional de 450 MiB.`,
        );
    }
    for (const table of Object.keys(tables) as Table[])
      await importTable(client, source, table);
    await validateImportedCatalog(client, source);
    const expectedCategoryDigest = await importCommercialCategories(
      client,
      source,
    );
    const oldRelease = await client.query(
      "SELECT status,source_sha256 FROM service_catalog.releases WHERE version='1.2-operacional'",
    );
    if (
      oldRelease.rowCount &&
      !(
        oldRelease.rows[0].status === "loading" &&
        ["pending", expectedSha256].includes(oldRelease.rows[0].source_sha256)
      )
    )
      throw new Error(
        "Registro de release pré-existente incompatível; nada foi substituído.",
      );
    if (oldRelease.rowCount)
      await client.query(
        "UPDATE service_catalog.releases SET source_sha256=$1,model_count=7534,time_count=836093,application_count=7292579 WHERE version='1.2-operacional'",
        [expectedSha256],
      );
    else
      await client.query(
        "INSERT INTO service_catalog.releases(version,status,source_sha256,model_count,time_count,application_count) VALUES('1.2-operacional','loading',$1,7534,836093,7292579)",
        [expectedSha256],
      );
    const persistedCategories = await client.query(
      "SELECT count(*)::int n FROM service_catalog.model_labor_categories",
    );
    if (Number(persistedCategories.rows[0].n) !== expected.models)
      throw new Error("A gravação das categorias não cobriu todos os modelos.");
    const persistedDigest = await client.query(
      `SELECT model_id,category_id,technical_classification_id,assignment_source,review_status,change_reason FROM service_catalog.model_labor_categories ORDER BY model_id`,
    );
    const persistedHash = createHash("sha256");
    appendRows(
      persistedHash,
      persistedDigest.rows as Record<string, unknown>[],
      [
        "model_id",
        "category_id",
        "technical_classification_id",
        "assignment_source",
        "review_status",
        "change_reason",
      ],
    );
    if (persistedHash.digest("hex") !== expectedCategoryDigest)
      throw new Error(
        "Hash das classificações comerciais persistidas diverge da fonte.",
      );
    const categoryRows = await client.query(
      "SELECT category_id,count(*)::int n FROM service_catalog.model_labor_categories GROUP BY category_id",
    );
    const categories = Object.fromEntries(
      categoryRows.rows.map((row) => [row.category_id, row.n]),
    );
    if (
      !matchesCategoryCounts(categories, expectedCategories)
    )
      throw new Error(
        "Distribuição comercial divergente; a transação será revertida.",
      );
    const overrides =
      await client.query(`SELECT count(*)::int n FROM service_catalog.model_labor_category_overrides o
      JOIN service_catalog.model_labor_categories c ON c.model_id=o.model_id AND c.category_id='premium'`);
    if (overrides.rows[0].n !== 51)
      throw new Error(
        "As 51 exceções CAT-007 não foram aplicadas integralmente.",
      );
    const counts =
      await client.query(`SELECT (SELECT count(*) FROM service_catalog.brands)::int brands,
      (SELECT count(*) FROM service_catalog.models)::int models,(SELECT count(*) FROM service_catalog.services)::int services,
      (SELECT count(*) FROM service_catalog.repair_times)::int repair_times`);
    if (
      counts.rows[0].brands !== 102 ||
      counts.rows[0].models !== 7534 ||
      counts.rows[0].services !== 6491 ||
      counts.rows[0].repair_times !== 836093
    )
      throw new Error(
        "Contagens finais divergentes; a transação será revertida.",
      );
    const preCommitSize = await client.query(
      "SELECT pg_database_size(current_database())::bigint bytes",
    );
    if (
      target.target === "homologation" &&
      Number(preCommitSize.rows[0].bytes) > 450 * 1024 * 1024
    )
      throw new Error(
        "Carga revertida: o tamanho real do banco excedeu 450 MiB antes da ativação.",
      );
    await client.query(
      "UPDATE service_catalog.releases SET status='active',validated_at=statement_timestamp() WHERE version='1.2-operacional' AND source_sha256=$1",
      [expectedSha256],
    );
    await client.query("COMMIT");
    const size = await client.query(
      "SELECT pg_database_size(current_database())::bigint bytes,pg_size_pretty(pg_database_size(current_database())) pretty",
    );
    console.log(
      JSON.stringify(
        {
          target: target.target,
          source_sha256: expectedSha256,
          counts: counts.rows[0],
          categories,
          approved_overrides: overrides.rows[0].n,
          database_bytes: Number(size.rows[0].bytes),
          database_size: size.rows[0].pretty,
          version: "1.2-operacional",
        },
        null,
        2,
      ),
    );
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
    await pool.end();
    source.close();
  }
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
)
  main().catch((error) => {
    console.error(
      "Importação não concluída:",
      error instanceof Error ? error.message : "erro",
    );
    process.exitCode = 1;
  });

