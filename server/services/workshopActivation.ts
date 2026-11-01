import { randomBytes, randomUUID } from "node:crypto";
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

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]!);
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
  const apiKey = config.apiKey ?? process.env.RESEND_API_KEY;
  const from = config.from ?? process.env.WORKSHOP_ACTIVATION_FROM;
  const appOrigin = config.appOrigin ?? process.env.APP_ORIGIN;
  if (!apiKey || !from || !appOrigin) throw new Error("activation_mail_not_configured");
  const activationUrl = workshopActivationUrl(appOrigin, input.token);
  const fetchImpl = config.fetchImpl ?? globalThis.fetch;
  const name = escapeHtml(input.workshopName);
  const safeUrl = escapeHtml(activationUrl);
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
      text: `A oficina ${input.workshopName} foi cadastrada no Sistema Oficinas. Abra o link para confirmar seu e-mail e definir a senha: ${activationUrl}\n\nO convite expira em ${expires}. Se você não solicitou este acesso, ignore esta mensagem.`,
      html: `<p>A oficina <strong>${name}</strong> foi cadastrada no Sistema Oficinas.</p><p>Confirme seu e-mail e configure o acesso em até 48 horas:</p><p><a href="${safeUrl}">Ativar acesso da oficina</a></p><p>O convite expira em ${escapeHtml(expires)}. Se você não solicitou este acesso, ignore esta mensagem.</p>`,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error("activation_mail_delivery_failed");
  return { tokenHash: digestAdminToken(input.token) };
}
