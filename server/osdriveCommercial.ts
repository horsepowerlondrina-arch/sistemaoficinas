type Environment = Record<string, string | undefined>;
const project = "prj_2VoHx0Sja7OSsWAzhMA1Ww3ZLrza";
const database = "fbsydwogucicfjwwbtts";
const origin = "https://osdrive.com.br";
export const isOsdriveCommercial = (env: Environment) =>
  env.VERCEL_PROJECT_ID === project || env.APP_ENV === "osdrive_comercial";

export function assertOsdriveCommercial(env: Environment) {
  if (env.VERCEL_PROJECT_ID !== project || env.VERCEL_ENV !== "production" ||
      env.APP_ENV === "horse_power" || env.LOCAL_HOMOLOGATION === "true" ||
      env.APP_ORIGIN !== origin || env.PUBLIC_ORIGIN !== origin || env.APP_ORIGINS !== origin)
    throw new Error("Configuração inválida do ambiente comercial OSDrive.");
  for (const [key, role] of [["DATABASE_URL", "horse_power_app"], ["PLATFORM_ADMIN_DATABASE_URL", "hp_platform_admin_app"]]) {
    const url = new URL(env[key] || "");
    if (url.protocol !== "postgresql:" || url.host !== "aws-0-us-east-1.pooler.supabase.com:6543" ||
        url.username !== role + "." + database || !url.password || url.pathname !== "/postgres" || url.search || url.hash)
      throw new Error("Conexão inválida para o banco comercial OSDrive.");
  }
  if (env.RESEND_API_KEY || (env.STRIPE_SECRET_KEY && !/^(sk|rk)_test_/.test(env.STRIPE_SECRET_KEY)) ||
      env.WORKSHOP_RETENTION_ENABLED === "true")
    throw new Error("O piloto comercial exige integrações de teste.");
}
