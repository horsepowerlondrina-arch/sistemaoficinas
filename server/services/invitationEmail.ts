const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[character]!);

export function invitationEmail(input: {
  title: string;
  workshopName: string;
  instructions: string;
  action: string;
  url: URL;
  expiry: string;
}) {
  const title = escapeHtml(input.title);
  const workshop = escapeHtml(input.workshopName);
  const instructions = escapeHtml(input.instructions);
  const action = escapeHtml(input.action);
  const url = escapeHtml(input.url.href);
  const logo = escapeHtml(new URL("/brand/osdrive-logo-transparent.png", input.url.origin).href);
  const expiry = escapeHtml(input.expiry);
  const ignored = "Se você não esperava este convite, ignore esta mensagem.";
  return {
    text: [input.title, input.workshopName, input.instructions, input.action + ": " + input.url.href, input.expiry, ignored].join("\n\n"),
    html: `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#f0f3f7;color:#17243a;font-family:Arial,sans-serif">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f0f3f7"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border:1px solid #dce3ec;border-radius:12px">
<tr><td style="padding:24px 28px;border-bottom:1px solid #e6ebf1"><img src="${logo}" width="136" alt="OSDrive" style="display:block;width:136px;max-width:100%;height:auto;border:0"></td></tr>
<tr><td style="padding:28px">
<h1 style="font-size:25px;line-height:1.25;margin:0 0 12px">${title}</h1>
<p style="margin:0 0 16px;font-size:17px"><strong>${workshop}</strong></p>
<p style="font-size:15px;line-height:1.55;margin:0 0 24px">${instructions}</p>
<table role="presentation" cellpadding="0" cellspacing="0"><tr><td bgcolor="#193b75" style="border-radius:8px"><a href="${url}" style="display:inline-block;padding:13px 21px;color:#ffffff;font-weight:bold;text-decoration:none">${action}</a></td></tr></table>
<p style="margin:20px 0 0;color:#46566d;font-size:14px;line-height:1.5">${expiry}</p>
<p style="margin:14px 0 0;color:#46566d;font-size:13px;line-height:1.5">Se o botão não abrir, <a href="${url}" style="color:#193b75">abra o link do convite</a>.</p>
</td></tr><tr><td style="padding:18px 28px;border-top:1px solid #e6ebf1;color:#46566d;font-size:13px;line-height:1.5">${ignored}</td></tr>
</table></td></tr></table></body></html>`,
  };
}
