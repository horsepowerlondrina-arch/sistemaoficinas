type Environment = Record<string, string | undefined>;
const project = "prj_2VoHx0Sja7OSsWAzhMA1Ww3ZLrza";
const database = "fbsydwogucicfjwwbtts";
const origin = "https://osdrive.com.br";
export const isOsdriveCommercial = (env: Environment) =>
  env.VERCEL_PROJECT_ID === project || env.APP_ENV === "osdrive_comercial";

export const commercialProduction = (env: Environment) =>
  env.VERCEL_PROJECT_ID === project && env.VERCEL_ENV === "production" &&
  env.APP_ORIGIN === origin && env.EXPECTED_DATABASE_PROJECT === database;

export const commercialPublicSignup = (env: Environment) =>
  commercialProduction(env) && env.OSDRIVE_PUBLIC_SIGNUP_ENABLED === "true" && !!env.OSDRIVE_COMMERCIAL_RESEND_KEY;

export const commercialLiveBilling = (env: Environment) =>
  commercialProduction(env) && env.OSDRIVE_LIVE_BILLING_ENABLED === "true";

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
    throw new Error("A integração de teste e a retenção comercial estão configuradas incorretamente.");
}

// The staged deployment has its own immutable hostname. Keep this workflow
// separate from the commercial origin allowlist and all other API mutations.
export function isCommercialPhotoCandidateRequest(
  env: Environment, request: { host: string; origin: string; method: string; path: string },
) {
  const host = env.VERCEL_URL;
  const deadline = Number(env.OSDRIVE_PHOTO_CANDIDATE_UNTIL);
  return commercialProduction(env) &&
    env.VERCEL_GIT_COMMIT_REF === "fix/osdrive-foto-origem-candidata" &&
    Number.isSafeInteger(deadline) && deadline > Date.now() &&
    !!host && /^osdrive-comercial-[a-z0-9]+-osd-rive\.vercel\.app$/.test(host) &&
    request.host === host && request.origin === `https://${host}` &&
    (request.method === "POST" && ["/login", "/logout", "/checklists"].includes(request.path) ||
      request.method === "POST" && /^\/checklists\/[a-z0-9-]+\/photos$/.test(request.path));
}
