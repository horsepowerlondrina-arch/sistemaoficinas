const productionProject = "cbdwgocofigrdigfgwkp";
export function assertDevelopmentIsolation(env: Record<string, string | undefined>) {
  const expected = env.EXPECTED_DATABASE_PROJECT;
  if (env.APP_ENV !== "development" || !expected || expected === productionProject)
    throw new Error("HPDesenvolvimento exige configuração isolada de desenvolvimento.");
  const database = new URL(env.DATABASE_URL || "");
  const direct = database.hostname === `db.${expected}.supabase.co`;
  const pooled = database.hostname.endsWith(".pooler.supabase.com") &&
    decodeURIComponent(database.username) === `horse_power_app.${expected}`;
  if ((!direct && !pooled) || database.href.includes(productionProject))
    throw new Error("HPDesenvolvimento recusou uma conexão fora do banco de testes.");
  const origin = new URL(env.APP_ORIGIN || "");
  if (origin.hostname !== "hpdesenvolvimento.vercel.app" ||
      env.PUBLIC_ORIGIN !== origin.origin || env.APP_ORIGINS !== origin.origin)
    throw new Error("HPDesenvolvimento exige seu próprio endereço de acesso.");
  if (Object.keys(env).some(key => /^(FIPEPLACA|PLACA_FIPE)_TOKENS_JSON$/.test(key) && env[key] && env[key] !== "{}"))
    throw new Error("Configure consultas externas separadamente no ambiente de testes.");
}
