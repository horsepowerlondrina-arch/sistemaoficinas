import { randomBytes, randomUUID } from "node:crypto";
import { commercialPilotEmail, commercialRegistrationEnabled } from "./selfServicePolicy.js";
import { commercialPublicSignup, isOsdriveCommercial } from "../osdriveCommercial.js";
import { invitationEmail } from "./invitationEmail.js";
import { digestAdminToken } from "../auth/platformAdmin.js";

export const workshopActivationTtlHours = 48;
export const newWorkshopActivationToken = () => randomBytes(32).toString("hex");
export const newWorkshopActivationId = () => randomUUID();

export function workshopActivationUrl(appOrigin: string, token: string) {
  const base = new URL(appOrigin);
  if (base.username || base.password || (base.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(base.hostname)))
    throw new Error("activation_origin_invalid");
  const url = new URL("/ativar-oficina", base.origin);
  url.hash = token;
  return url.toString();
}

export type WorkshopActivationEmail = {
  inviteId: string;
  token: string;
  email: string;
  workshopName: string;
  expiresAt: Date;
};

export type WorkshopActivationMailConfig = {
  apiKey?: string;
  from?: string;
  appOrigin?: string;
  fetchImpl?: typeof fetch;
};

export async function sendWorkshopActivationEmail(
  input: WorkshopActivationEmail,
  config: WorkshopActivationMailConfig = {},
) {
  const commercial = isOsdriveCommercial(process.env);
  const publicSignup = commercialPublicSignup(process.env) && !input.email.endsWith("@testes.osdrive.com.br");
  if (commercial && !publicSignup && input.email !== "validacao-comercial@testes.osdrive.com.br" &&
      !(commercialRegistrationEnabled() && input.email === commercialPilotEmail))
    throw new Error("activation_mail_recipient_not_allowed");
  const apiKey = publicSignup ? process.env.OSDRIVE_COMMERCIAL_RESEND_KEY : commercial ? process.env.OSDRIVE_TEST_INVITE_KEY : config.apiKey ?? process.env.RESEND_API_KEY;
  const from = config.from ?? process.env.WORKSHOP_ACTIVATION_FROM;
  const appOrigin = config.appOrigin ?? process.env.APP_ORIGIN;
  if (!apiKey || !from || !appOrigin) throw new Error("activation_mail_not_configured");
  const activationUrl = workshopActivationUrl(appOrigin, input.token);
  const fetchImpl = config.fetchImpl ?? globalThis.fetch;
  const expires = input.expiresAt.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
  const response = await fetchImpl("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `workshop-activation/${input.inviteId}`,
    },
    body: JSON.stringify({
      from,
      to: [input.email],
      subject: `Ative o acesso da oficina ${input.workshopName}`,
      ...invitationEmail({
        title: "Ative o acesso da sua oficina",
        workshopName: input.workshopName,
        instructions: "Confirme seu e-mail e defina uma senha para começar a usar o OSDrive.",
        action: "Ativar acesso da oficina",
        url: new URL(activationUrl),
        expiry: `Convite válido até ${expires} (horário de Brasília).`,
      }),
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error("activation_mail_delivery_failed");
  return { tokenHash: digestAdminToken(input.token) };
}
