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
  const allowedRoles = ["horse_power_app", "hp_definitivo_app_login"];
  const direct = database.hostname === `db.${project}.supabase.co` &&
    allowedRoles.includes(decodeURIComponent(database.username));
  const pooled = database.hostname.endsWith(".pooler.supabase.com") &&
    database.port === "6543" &&
    allowedRoles.some(role => decodeURIComponent(database.username) === `${role}.${project}`);
  if (!["postgres:", "postgresql:"].includes(database.protocol) ||
      (!direct && !pooled) || database.pathname !== "/postgres" ||
      database.search || database.hash)
    throw new Error("A conexão da Horse Power não corresponde ao banco definitivo.");
  const preview = env.VERCEL_ENV === "preview";
  let origin = "https://oficinahorsepower.com.br";
  if (preview) {
    if (env.VERCEL !== "1" || env.VERCEL_PROJECT_ID !== "prj_RJGlxZbbO3Wl4Vm3CdreT60G3FST" ||
        !/^horse-power-definitivo-[a-z0-9-]+-horse-power2\.vercel\.app$/.test(env.VERCEL_URL || "") ||
        project !== "rvlovjpquozbrsszsxwe")
      throw new Error("Preview fora do projeto definitivo da Horse Power.");
    origin = `https://${env.VERCEL_URL}`;
  }
  if (env.APP_ORIGIN !== origin || env.APP_ORIGINS !== origin ||
      (env.PUBLIC_ORIGIN && env.PUBLIC_ORIGIN !== origin))
    throw new Error("A Horse Power exige sua própria origem pública.");
  if (env.PLATFORM_ADMIN_DATABASE_URL || env.PLATFORM_ADMIN_TOTP_ENCRYPTION_KEY ||
      env.STRIPE_BILLING_ENABLED === "true" || env.VITE_PLATFORM_ADMIN_ENABLED === "true")
    throw new Error("Administração central e cobranças não pertencem à Horse Power definitiva.");
}
