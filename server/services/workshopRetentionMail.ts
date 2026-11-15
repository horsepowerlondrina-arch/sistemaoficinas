import { createHash } from "node:crypto";
import { retentionNoticeDays } from "../../shared/workshopRetention.js";

type NoticeDay = (typeof retentionNoticeDays)[number];
export type RetentionNotice = {
  tenantId: string;
  workshopName: string;
  email: string;
  coverageEnd: string;
  removalDate: string;
  daysLate: NoticeDay;
};

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]!);
}

/** Delivery is called only after reserving the notice in the retention outbox. */
export async function sendWorkshopRetentionNotice(
  notice: RetentionNotice,
  config: { apiKey?: string; from?: string; origin?: string; fetchImpl?: typeof fetch } = {},
) {
  if (!retentionNoticeDays.includes(notice.daysLate)) throw new Error("Aviso de retenção inválido.");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(notice.tenantId) || !/^\d{4}-\d{2}-\d{2}$/.test(notice.coverageEnd) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(notice.removalDate) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(notice.email))
    throw new Error("Aviso de retenção inválido.");
  const apiKey = config.apiKey ?? process.env.RESEND_API_KEY;
  const from = config.from ?? process.env.WORKSHOP_ACTIVATION_FROM;
  const origin = config.origin ?? process.env.APP_ORIGIN;
  if (!apiKey || !from || !origin) throw new Error("Aviso de retenção não configurado.");
  const base = new URL(origin);
  if (base.protocol !== "https:" || base.username || base.password || base.pathname !== "/" || base.search || base.hash)
    throw new Error("Origem de aviso inválida.");
  const accountUrl = `${base.origin}/configuracoes?aba=assinatura`;
  const key = createHash("sha256").update(`${notice.tenantId}:${notice.coverageEnd}:${notice.daysLate}`).digest("hex");
  const subject = `Aviso sobre o acesso da oficina ${notice.workshopName}`;
  const message = `A oficina ${notice.workshopName} está há ${notice.daysLate} dias sem cobertura de assinatura ou teste. Se não houver renovação, a exclusão está prevista para ${notice.removalDate}. Acesse ${accountUrl} para regularizar o plano ou exportar seus dados. Uma cópia criptografada de recuperação ficará disponível por 15 dias após a exclusão. Se já efetuou o pagamento, confira a situação no sistema ou entre em contato com o suporte.`;
  const response = await (config.fetchImpl ?? globalThis.fetch)("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "Idempotency-Key": `workshop-retention/${key}` },
    body: JSON.stringify({ from, to: [notice.email], subject, text: message,
      html: `<p>${escapeHtml(message)}</p>` }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error("Falha no envio do aviso de retenção.");
}
