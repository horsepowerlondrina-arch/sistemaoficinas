export const homologationProject = "vnclahdnirqlcbamodqy";
type Environment = Record<string, string | undefined>;
export const localAdminTestEmail = "inf010-admin@example.test";
export function exclusiveLocalRoles(env: Environment = process.env) {
  return (
    env.LOCAL_HOMOLOGATION === "true" &&
    env.LOCAL_EXCLUSIVE_CREDENTIALS === "true"
  );
}
export function localConnectionRoles(env: Environment) {
  return exclusiveLocalRoles(env)
    ? { operational: "osdrive_local_app", admin: "osdrive_local_admin" }
    : { operational: "horse_power_app", admin: "hp_platform_admin_app" };
}
export function localPorts(env: Environment) {
  const slot = env.DEV_SLOT || "1";
  if (!["1", "2"].includes(slot)) throw new Error("DEV_SLOT deve ser 1 ou 2.");
  const port = (value: string | undefined, fallback: number) => {
    const n = Number(value || fallback);
    if (!Number.isInteger(n) || n < 1024 || n > 65535)
      throw new Error("Porta local inválida.");
    return n;
  };
  const web = port(env.DEV_WEB_PORT, slot === "1" ? 5173 : 5174);
  const api = port(env.DEV_API_PORT, slot === "1" ? 3001 : 3011);
  if (web === api)
    throw new Error("Frontend e backend exigem portas diferentes.");
  return { web, api, slot };
}
export function homologationConnection(
  value: string | undefined,
  role: string,
) {
  let url: URL;
  try {
    url = new URL(value || "");
  } catch {
    throw new Error(
      "Configure as duas conexões restritas de homologação com npm run dev:configure.",
    );
  }
  const direct =
    url.hostname === `db.${homologationProject}.supabase.co` &&
    ["", "5432"].includes(url.port) &&
    decodeURIComponent(url.username) === role;
  const pooled =
    /^aws-[a-z0-9-]+\.pooler\.supabase\.com$/.test(url.hostname) &&
    ["5432", "6543"].includes(url.port) &&
    decodeURIComponent(url.username) === `${role}.${homologationProject}`;
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    (!direct && !pooled) ||
    url.pathname !== "/postgres" ||
    url.search ||
    url.hash ||
    !url.password
  )
    throw new Error(
      "Conexão recusada: use somente o projeto de homologação e o papel restrito esperado, sem opções na URL.",
    );
  return url.toString();
}
export function assertLocalHomologation(env: Environment) {
  if (
    env.LOCAL_HOMOLOGATION !== "true" ||
    env.APP_ENV !== "development" ||
    env.EXPECTED_DATABASE_PROJECT !== homologationProject ||
    env.VERCEL ||
    env.NODE_ENV === "production"
  )
    throw new Error(
      "Execução restrita ao Linux local e ao Supabase de homologação.",
    );
  if (Object.keys(env).some((k) => /^PG/.test(k) && env[k]))
    throw new Error("Remova configurações PG externas da execução local.");
  const roles = localConnectionRoles(env);
  homologationConnection(env.DATABASE_URL, roles.operational);
  homologationConnection(env.PLATFORM_ADMIN_DATABASE_URL, roles.admin);
  if (
    env.DATABASE_URL === env.PLATFORM_ADMIN_DATABASE_URL ||
    !/^[a-f0-9]{64}$/i.test(env.PLATFORM_ADMIN_TOTP_ENCRYPTION_KEY || "")
  )
    throw new Error(
      "Configure conexões separadas e a chave MFA da homologação; não gere outra chave para contas existentes.",
    );
  const { web, api } = localPorts(env);
  const origins = [`http://127.0.0.1:${web}`, `http://127.0.0.1:${api}`];
  if (
    env.APP_ORIGIN !== origins[0] ||
    env.PUBLIC_ORIGIN !== origins[0] ||
    env.APP_ORIGINS !== origins.join(",")
  )
    throw new Error("Origens locais inconsistentes.");
  if (!/^[a-z0-9][a-z0-9-]{2,39}$/.test(env.DEV_RUN_ID || ""))
    throw new Error("Defina DEV_RUN_ID para identificar seus dados fictícios.");
}
export function configureLocalHomologation(env: Environment) {
  const { web, api, slot } = localPorts(env);
  // Never inherit paid providers, bypasses, or cloud hostnames into a local session.
  for (const key of Object.keys(env))
    if (
      /^(STRIPE_|MERCADO_PAGO_|RESEND_|FIPEPLACA_|PLACA_FIPE_|PLATFORM_ADMIN_TEST_|VITE_PLATFORM_ADMIN_TEST_|WORKSHOP_ACTIVATION_|CRON_SECRET$)/.test(
        key,
      )
    )
      delete env[key];
  Object.assign(env, {
    LOCAL_HOMOLOGATION: "true",
    APP_ENV: "development",
    EXPECTED_DATABASE_PROJECT: homologationProject,
    APP_ORIGIN: `http://127.0.0.1:${web}`,
    PUBLIC_ORIGIN: `http://127.0.0.1:${web}`,
    APP_ORIGINS: `http://127.0.0.1:${web},http://127.0.0.1:${api}`,
    DEV_WEB_PORT: String(web),
    DEV_API_PORT: String(api),
    DEV_SLOT: slot,
    DEV_RUN_ID: env.DEV_RUN_ID || `inf010-slot-${slot}`,
    ENABLE_PAID_VEHICLE_LOOKUP: "false",
    VITE_PLATFORM_ADMIN_ENABLED: "true",
    VITE_PLATFORM_ADMIN_ALLOWED_HOSTS: "127.0.0.1",
  });
  assertLocalHomologation(env);
  return { web, api, slot };
}
