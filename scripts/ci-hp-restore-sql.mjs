import { readFileSync } from "node:fs";
import pg from "pg";

if (process.env.GITHUB_ACTIONS !== "true") throw new Error("Somente PostgreSQL 17 descartável do CI.");
const raw = process.env.CI_PG_ADMIN_URL || "";
let url;
try { url = new URL(raw); } catch { throw new Error("Conexão de teste ausente."); }
if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.username !== "postgres" ||
    url.pathname !== "/postgres" || url.search || url.hash)
  throw new Error("Restauração de teste exige banco local descartável.");
url.pathname = "/horse_power_cloud_ci";
const admin = new pg.Client({ connectionString: url.toString() });
await admin.connect();
try {
  await admin.query(readFileSync("ops/horse-power-definitive-restore/source.sql", "utf8"));
  await admin.query(readFileSync("ops/horse-power-definitive-restore/source-categories.sql", "utf8"));
  await admin.query(readFileSync("ops/horse-power-definitive-restore/target.sql", "utf8"));
  const roles = await admin.query("SELECT rolname,rolcanlogin,rolsuper,rolbypassrls FROM pg_roles WHERE rolname IN ('hp_restore_source_login','hp_restore_target_login') ORDER BY rolname");
  if (roles.rowCount !== 2 || roles.rows.some(r => r.rolcanlogin || r.rolsuper || r.rolbypassrls))
    throw new Error("Papéis temporários do ensaio não estão restritos.");

  const categoryAccess = await admin.query("SELECT has_function_privilege('hp_restore_source_login','horse_power.definitive_restore_service_categories()','EXECUTE') AS source_allowed, has_function_privilege('hp_restore_target_login','horse_power.definitive_restore_service_categories()','EXECUTE') AS target_allowed, has_table_privilege('hp_restore_source_login','horse_power.workshop_service_categories','SELECT') AS table_allowed");
  if (!categoryAccess.rows[0]?.source_allowed || categoryAccess.rows[0]?.target_allowed || categoryAccess.rows[0]?.table_allowed)
    throw new Error("A leitura temporária de categorias não está restrita à função dedicada.");
  await admin.query("SET SESSION AUTHORIZATION hp_restore_source_login");
  let sourceDenied = false;
  try { await admin.query("SELECT * FROM horse_power.definitive_restore_source()"); }
  catch (error) { sourceDenied = error?.code === "P0001"; }
  const sourceCategories = await admin.query("SELECT * FROM horse_power.definitive_restore_service_categories()");
  if (sourceCategories.rowCount !== 0) throw new Error("O ensaio do banco descartável deveria começar sem categorias.");
  await admin.query("RESET SESSION AUTHORIZATION");
  if (!sourceDenied) throw new Error("A função de origem não bloqueou a ausência de proprietário.");

  const ownerId = "00000000-0000-4000-8000-000000000901";
  const tenantId = "59c85eea-7112-40de-b77f-c5627c541b48";
  await admin.query("SET SESSION AUTHORIZATION hp_restore_target_login");
  await admin.query("BEGIN");
  try {
    await admin.query("SELECT platform_admin.provision_definitive_horse_power($1,$2,$3,$4,$5,$6,$7)", [
      tenantId, "Horse Power Car Service", ownerId, "Proprietário Fictício",
      "owner@example.invalid", "a".repeat(32) + ":" + "b".repeat(128),
      "2026-11-01T00:00:00Z",
    ]);
    await admin.query("SELECT set_config('app.tenant_id',$1,true),set_config('app.user_id',$2,true)", [tenantId, ownerId]);
    const state = await admin.query("SELECT horse_power.local_tenant_access_state($1) AS access_state,horse_power.local_tenant_catalog_included($1) AS catalog", [tenantId]);
    if (state.rows[0]?.access_state !== "active" || state.rows[0]?.catalog !== true)
      throw new Error("Plano Premium vitalício não liberou o acesso esperado.");
    const categoryId = "00000000-0000-4000-8000-000000000902";
    const serviceId = "00000000-0000-4000-8000-000000000903";
    await admin.query("INSERT INTO horse_power.workshop_service_categories(id,tenant_id,name,name_key) VALUES($1,$2,$3,$4)", [categoryId, tenantId, "Categoria Fictícia", "categoria-ficticia"]);
    await admin.query("INSERT INTO horse_power.workshop_services(id,tenant_id,name,execution,name_key,reference,category_id) VALUES($1,$2,$3,$4,$5,$6,$7)", [serviceId, tenantId, "Serviço Fictício", "internal", "servico-ficticio", "SVC-FICTICIO", categoryId]);
    const serviceLink = await admin.query("SELECT c.id AS category_id FROM horse_power.workshop_services s JOIN horse_power.workshop_service_categories c ON c.tenant_id=s.tenant_id AND c.id=s.category_id WHERE s.id=$1", [serviceId]);
    if (serviceLink.rows[0]?.category_id !== categoryId) throw new Error("A categoria fictícia não permaneceu vinculada ao serviço.");
  } finally {
    await admin.query("ROLLBACK");
    await admin.query("RESET SESSION AUTHORIZATION");
  }
  const rows = await admin.query("SELECT (SELECT count(*) FROM horse_power.tenants) AS tenants,(SELECT count(*) FROM horse_power.users) AS users,(SELECT count(*) FROM platform_admin.workshops) AS workshops");
  if (Object.values(rows.rows[0]).some(n => Number(n) !== 0))
    throw new Error("O ensaio deixou registros no banco descartável.");
  console.log("SQL temporário validado em PostgreSQL 17 com dados fictícios e rollback.");
} finally {
  await admin.end();
}
