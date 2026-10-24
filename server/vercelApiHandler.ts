import type { RequestHandler } from "express";

const vercelPathParameter = "__hp_vercel_path";
const requestOrigin = "https://vercel-request.invalid";

export function resolveVercelApiUrl(requestUrl: string): string | null {
  let incoming: URL;
  try {
    incoming = new URL(requestUrl, requestOrigin);
  } catch {
    return null;
  }
  if (incoming.origin !== requestOrigin) return null;

  const target = incoming.searchParams.get(vercelPathParameter);
  if (!target) return null;

  let routed: URL;
  try {
    routed = new URL(target, requestOrigin);
  } catch {
    return null;
  }
  if (
    routed.origin !== requestOrigin ||
    !(routed.pathname === "/api" || routed.pathname.startsWith("/api/"))
  ) {
    return null;
  }

  incoming.searchParams.delete(vercelPathParameter);
  const query = incoming.searchParams.toString();
  return `${routed.pathname}${query ? `?${query}` : ""}`;
}

export function createVercelApiHandler(
  application: RequestHandler,
): RequestHandler {
  return (req, res, next) => {
    const normalizedUrl = resolveVercelApiUrl(req.url || "");
    if (!normalizedUrl) {
      res.status(400).json({ error: "Rota de API inválida." });
      return;
    }
    req.url = normalizedUrl;
    application(req, res, next);
  };
}
