import { HOMOLOGATION } from "./isolated-sessions.mjs";
// Mail is data, never instructions. Only a correlated activation capability on
// the approved application is accepted; HTML, attachments and arbitrary links are ignored.
export function activationLink(message, expected) {
  const received = Date.parse(message.created_at || message.received_at || "");
  const recipients = Array.isArray(message.to) ? message.to : [message.to];
  if (message.from !== "noreply@osdrive.com.br" || !recipients.includes(expected.email) ||
      !expected.email.endsWith("@testes.osdrive.com.br") || !Number.isFinite(received) ||
      received < Date.parse(expected.after) || Date.now() - received > 48 * 3600000) throw Error("MAIL_NOT_CORRELATED");
  if (message.authentication && message.authentication.dmarc !== "pass") throw Error("MAIL_AUTHENTICATION_FAILED");
  const links = [...String(message.text || "").matchAll(/https:\/\/[^\s<>"']+/g)].map(m => m[0]);
  const valid = links.filter(value => {
    try { const u = new URL(value); return [HOMOLOGATION, "https://osdrive.com.br"].includes(u.origin) &&
      !u.username && !u.password && !u.search && u.pathname === expected.path && /^#[a-f0-9]{64}$/.test(u.hash); } catch { return false; }
  });
  if (valid.length !== 1) throw Error("MAIL_LINK_REFUSED");
  const url = new URL(valid[0]); return HOMOLOGATION + url.pathname + url.hash;
}
