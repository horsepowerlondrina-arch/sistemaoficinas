/** Deployment guard for the dedicated Horse Power site. Never accept a testing or historical database. */
export function assertHorsePowerIsolation(env: Record<string, string | undefined>): void {
  if (env.APP_ENV !== "horse_power") throw new Error("Ambiente Horse Power inválido.");
  const project = env.EXPECTED_DATABASE_PROJECT || "";
  if (!/^[a-z0-9]{20}$/.test(project) ||
      ["cbdwgocofigrdigfgwkp", "vnclahdnirqlcbamodqy"].includes(project))
    throw new Error("A Horse Power exige um banco definitivo independente.");
  let database: URL;
  try { database = new URL(env.DATABASE_URL || ""); }
  catch { throw new Error("Configure o banco definitivo da Horse Power."); }
  const direct = database.hostname === `db.${project}.supabase.co` &&
    decodeURIComponent(database.username) === "horse_power_app";
  const pooled = database.hostname.endsWith(".pooler.supabase.com") &&
    database.port === "6543" &&
    decodeURIComponent(database.username) === `horse_power_app.${project}`;
  if (!["postgres:", "postgresql:"].includes(database.protocol) ||
      (!direct && !pooled) || database.pathname !== "/postgres" ||
      database.search || database.hash)
    throw new Error("A conexão da Horse Power não corresponde ao banco definitivo.");
  const origin = "https://oficinahorsepower.com.br";
  if (env.APP_ORIGIN !== origin || env.APP_ORIGINS !== origin ||
      (env.PUBLIC_ORIGIN && env.PUBLIC_ORIGIN !== origin))
    throw new Error("A Horse Power exige sua própria origem pública.");
  if (env.PLATFORM_ADMIN_DATABASE_URL || env.PLATFORM_ADMIN_TOTP_ENCRYPTION_KEY ||
      env.STRIPE_BILLING_ENABLED === "true" || env.VITE_PLATFORM_ADMIN_ENABLED === "true")
    throw new Error("Administração central e cobranças não pertencem à Horse Power definitiva.");
}
