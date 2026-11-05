const productionProject = "cbdwgocofigrdigfgwkp";
export function assertDevelopmentIsolation(
  env: Record<string, string | undefined>,
) {
  const expected = env.EXPECTED_DATABASE_PROJECT;
  if (
    env.APP_ENV !== "development" ||
    !expected ||
    expected === productionProject
  )
    throw new Error(
      "HPDesenvolvimento exige configuração isolada de desenvolvimento.",
    );
  const database = new URL(env.DATABASE_URL || "");
  const previewBilling = env.VERCEL_ENV === "preview" &&
    env.VERCEL_GIT_COMMIT_REF === "feat/admin-billing-mercadopago" &&
    expected === "vnclahdnirqlcbamodqy";
  const allowedUser = previewBilling ? "hp_billing_preview_app" : "horse_power_app";
  const direct =
    database.hostname === `db.${expected}.supabase.co` &&
    decodeURIComponent(database.username) === allowedUser;
  const pooled =
    database.hostname.endsWith(".pooler.supabase.com") &&
    database.port === "6543" &&
    decodeURIComponent(database.username) === `${allowedUser}.${expected}`;
  if (
    (!direct && !pooled) ||
    database.pathname !== "/postgres" ||
    database.search ||
    database.hash ||
    database.href.includes(productionProject)
  )
    throw new Error(
      "A homologação recusou uma conexão fora do banco de testes.",
    );
  const origin = new URL(env.APP_ORIGIN || "");
  const allowedOrigins = (env.APP_ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const vercelOnly =
    origin.hostname.endsWith(".vercel.app") &&
    allowedOrigins.length === 1 &&
    allowedOrigins[0] === origin.origin;
  const osdriveHomologation =
    expected === "vnclahdnirqlcbamodqy" &&
    origin.origin === "https://osdrive.com.br" &&
    allowedOrigins.length === 2 &&
    new Set(allowedOrigins).size === 2 &&
    allowedOrigins.includes(origin.origin) &&
    allowedOrigins.includes("https://sistema-oficinas-homologacao.vercel.app");
  if (
    (!vercelOnly && !osdriveHomologation) ||
    (env.PUBLIC_ORIGIN && env.PUBLIC_ORIGIN !== origin.origin)
  )
    throw new Error("A homologação exige origens próprias e consistentes.");
  if (
    env.ENABLE_PAID_VEHICLE_LOOKUP !== "true" &&
    Object.keys(env).some(
      (key) =>
        /^(FIPEPLACA|PLACA_FIPE)_TOKENS_JSON$/.test(key) &&
        env[key] &&
        env[key] !== "{}",
    )
  )
    throw new Error(
      "Configure consultas externas separadamente no ambiente de testes.",
    );
}
