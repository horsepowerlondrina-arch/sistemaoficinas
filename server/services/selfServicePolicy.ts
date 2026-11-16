import { isOsdriveCommercial } from "../osdriveCommercial.js";

export const commercialPilotEmail = "autocadastro-comercial@testes.osdrive.com.br";
export function commercialRegistrationEnabled(env: NodeJS.ProcessEnv = process.env) {
  return isOsdriveCommercial(env) && env.VERCEL_PROJECT_ID === "prj_2VoHx0Sja7OSsWAzhMA1Ww3ZLrza" &&
    env.VERCEL_ENV === "production" && env.APP_ORIGIN === "https://osdrive.com.br" &&
    env.OSDRIVE_SELF_SERVICE_TEST === "true" && !!env.OSDRIVE_TEST_INVITE_KEY;
}
export const testOrigin = "https://sistema-oficinas-homologacao.vercel.app";
export function selfServiceTestEmails(env: NodeJS.ProcessEnv = process.env): string[] {
  if (isOsdriveCommercial(env)) return commercialRegistrationEnabled(env) ? [commercialPilotEmail] : [];
  if (env.SELF_SERVICE_TEST_ENABLED !== "true") return [];
  const local = !env.VERCEL && env.NODE_ENV !== "production";
  if (!local && (env.VERCEL_PROJECT_ID !== "prj_rLVsFKBpMXQFtfm1kgYHFQObr4Jc" || env.APP_ENV !== "development" || env.EXPECTED_DATABASE_PROJECT !== "vnclahdnirqlcbamodqy")) return [];
  const emails = (env.SELF_SERVICE_TEST_EMAILS || "").split(",").map(v => v.trim().toLowerCase()).filter(Boolean);
  if (!emails.length || emails.length > 30 || emails.some(v => !/^[a-z0-9][a-z0-9._-]{0,63}@testes\.osdrive\.com\.br$/.test(v))) return [];
  return [...new Set(emails)];
}
