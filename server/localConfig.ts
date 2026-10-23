/** Local entry points never accept cloud URLs or libpq connection overrides. */
export function localDatabaseUrl(value: string | undefined, admin = false) {
  let url: URL;
  try { url = new URL(value || ""); } catch { throw new Error("Configure LOCAL_DATABASE_URL (ou LOCAL_ADMIN_DATABASE_URL) para PostgreSQL local."); }
  if (!["postgres:", "postgresql:"].includes(url.protocol) ||
      !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
      url.search || url.hash || url.pathname !== "/horse_power_local" ||
      (!admin && decodeURIComponent(url.username) !== "hp_local_app"))
    throw new Error("Conexão recusada: use loopback, banco horse_power_local, usuário hp_local_app e nenhuma opção na URL.");
  return url.toString();
}
export function platformAdminDatabaseUrl(value: string | undefined) {
  let url: URL;
  try { url = new URL(value || ""); } catch { throw new Error("Execute npm run db:local:migrate para configurar o acesso administrativo local."); }
  if (!["postgres:", "postgresql:"].includes(url.protocol) ||
      !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
      url.search || url.hash || url.pathname !== "/horse_power_local" ||
      decodeURIComponent(url.username) !== "hp_platform_admin_app")
    throw new Error("Conexão administrativa recusada: use somente horse_power_local em loopback.");
  return url.toString();
}
export function assertLocalProcess(env: NodeJS.ProcessEnv = process.env) {
  if (env.VERCEL || env.NODE_ENV === "production" ||
      ["PGHOST", "PGHOSTADDR", "PGSERVICE", "PGSERVICEFILE", "PGOPTIONS", "PGSSLMODE"].some(k => !!env[k]))
    throw new Error("Execução local recusada: ambiente online ou configuração PG externa.");
}
export function localEnvironment(env: NodeJS.ProcessEnv = process.env) {
  assertLocalProcess(env);
  const url = localDatabaseUrl(env.LOCAL_DATABASE_URL);
  // Never inherit database, domains or paid providers from a cloud .env.
  for (const key of Object.keys(env))
    if (/^(FIPEPLACA|PLACA_FIPE)_/.test(key)) delete env[key];
  env.APP_ENV = "local";
  env.ENABLE_PAID_VEHICLE_LOOKUP = "false";
  env.APP_ORIGIN = "http://127.0.0.1:5173";
  env.APP_ORIGINS = "http://127.0.0.1:5173,http://localhost:5173,http://127.0.0.1:3001,http://localhost:3001";
  env.PUBLIC_ORIGIN = "http://127.0.0.1:5173";
  return url;
}
