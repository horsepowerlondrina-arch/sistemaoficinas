export const cloudflareOrigin = "https://sistema-oficinas-homologacao.osdrive-homologacao.workers.dev";
export const cloudflareProject = "vnclahdnirqlcbamodqy";
export const cloudflareTestTenants = [
  "26bb4fc1-276d-411c-b903-1c84c0b77299",
  "1f866f8e-d6e0-475f-a270-1dae4b2279b1",
  "d0a82163-8b22-4ec6-98d4-f5495c386ee2",
];
export function isCloudflareHomologation(env: Record<string, string | undefined>) {
  return env.CLOUDFLARE_HOMOLOGATION === "true" && env.APP_ENV === "development" &&
    env.EXPECTED_DATABASE_PROJECT === cloudflareProject && env.APP_ORIGIN === cloudflareOrigin &&
    env.PUBLIC_ORIGIN === cloudflareOrigin && env.APP_ORIGINS === cloudflareOrigin;
}
export function assertCloudflareConfiguration(env: Record<string, string | undefined>) {
  if (!isCloudflareHomologation(env) || env.NODE_ENV !== "production" || env.VERCEL ||
      env.LOCAL_HOMOLOGATION || env.STRIPE_BILLING_ENABLED === "true" || env.ENABLE_PAID_VEHICLE_LOOKUP === "true")
    throw new Error("Configuração Cloudflare de homologação inválida.");
  for (const [key,role] of [["DATABASE_URL","horse_power_app"],["PLATFORM_ADMIN_DATABASE_URL","hp_platform_admin_app"]]) {
    const url = new URL(env[key] || "");
    const direct = url.hostname === `db.${cloudflareProject}.supabase.co` && (!url.port || url.port === "5432");
    const pooled = /^aws-[a-z0-9-]+\.pooler\.supabase\.com$/.test(url.hostname) && url.port === "6543";
    if (url.protocol !== "postgresql:" || (!direct && !pooled) || url.pathname !== "/postgres" ||
        url.search || url.hash || !url.password || !cloudflareDatabaseRoles(role).some(name => decodeURIComponent(url.username) === (pooled ? `${name}.${cloudflareProject}` : name)))
      throw new Error("Conexão Cloudflare fora da homologação restrita.");
  }
}
export function cloudflarePath(path: string): string {
  return path === "/admin-api" || path.startsWith("/admin-api/") ? `/api${path}` : path;
}
export function isCloudflareApi(path: string): boolean {
  return path === "/api" || path.startsWith("/api/") || path === "/admin-api" || path.startsWith("/admin-api/");
}

export function cloudflareDatabaseRoles(role: string): string[] {
  return role === "horse_power_app" ? [role,"osdrive_local_app"] : role === "hp_platform_admin_app" ? [role,"osdrive_local_admin"] : [];
}
export function isCloudflareDatabaseRole(role: string, base: string): boolean {
  return cloudflareDatabaseRoles(base).includes(role);
}
