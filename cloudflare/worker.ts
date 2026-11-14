import { createServer } from "node:http";
import { handleAsNodeRequest } from "cloudflare:node";
import { createCloudRuntime } from "../server/cloudRuntime.js";
import { withDocumentLogo } from "../server/runtimeAssets.js";
import { assertCloudflareConfiguration, cloudflareOrigin, cloudflarePath, isCloudflareApi } from "../server/cloudflarePolicy.js";
const securityHeaders = { "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "X-Frame-Options": "DENY" };
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.origin !== cloudflareOrigin && url.hostname !== "localhost" && url.hostname !== "127.0.0.1")
      return new Response("Origem não autorizada.", { status: 403 });
    const path = cloudflarePath(url.pathname);
    if (isCloudflareApi(url.pathname)) {
      // Vercel remains the scheduler/webhook owner during the parallel pilot.
      if (path.startsWith("/api/billing/stripe/") || path === "/api/admin-api" || path.startsWith("/api/admin-api/"))
        return Response.json({ error: "Integração administrativa indisponível nesta homologação paralela." }, { status: 403, headers: { ...securityHeaders, "Cache-Control": "no-store" } });
      if (!["GET","HEAD","OPTIONS"].includes(request.method) && request.headers.get("Origin") && request.headers.get("Origin") !== cloudflareOrigin)
        return Response.json({ error: "Origem não autorizada." }, { status: 403, headers: securityHeaders });
      let stage = "configuration";
      try {
        assertCloudflareConfiguration(process.env);
        stage = "bootstrap";
        const runtime = await createCloudRuntime({ ca: env.SUPABASE_CA, hyperdrive: true, operationalUrl: env.DATABASE.connectionString, administrativeUrl: env.ADMIN_DATABASE.connectionString, onStage(value) { stage = value; } });
        stage = "dispatch";
        let finish!: () => void;
        const finished = new Promise<void>(resolve => { finish = resolve; });
        const server = createServer((req, res) => {
          // Forwarded headers are not trusted. Cloudflare supplies the verified client IP.
          const ip = request.headers.get("CF-Connecting-IP");
          if (ip) Object.defineProperty(req.socket, "remoteAddress", { value: ip });
          res.once("finish", finish); res.once("close", finish);
          withDocumentLogo(async () => {
            const asset = await env.ASSETS.fetch(new Request(new URL("/brand/icon.jpg", url)));
            if (!asset.ok) throw new Error("Logo indisponível.");
            return Buffer.from(await asset.arrayBuffer());
          }, () => runtime.app(req, res));
        });
        try {
          url.pathname = path;
          server.listen(0);
          const address = server.address();
          if (!address || typeof address === "string") throw new Error("Servidor indisponível.");
          const response = await handleAsNodeRequest(address.port, new Request(url, request), env, ctx);
          ctx.waitUntil(finished.finally(async () => { server.close(); await runtime.close(); }));
          const headers = new Headers(response.headers);
          for (const [key,value] of Object.entries(securityHeaders)) headers.set(key,value);
          headers.set("Cache-Control", "no-store");
          return new Response(response.body, { status: response.status, headers });
        } catch (error) { server.close(); await runtime.close(); throw error; }
      } catch (error) {
        const kind = error instanceof Error ? error.name : "UnknownError";
        const causeCode = error && typeof error === "object" && "code" in error && typeof error.code === "string" && /^[A-Z0-9_]{1,40}$/.test(error.code) ? error.code : undefined;
        console.error(JSON.stringify({ code: "CLOUDFLARE_RUNTIME_UNAVAILABLE", stage, kind, causeCode, reference: error instanceof Error ? error.message.match(/^internal error; reference = ([a-z0-9]+)$/)?.[1] : undefined, category: error instanceof Error ? (/certificate|SSL|TLS/i.test(error.message) ? "TLS" : /I\/O|socket|connect/i.test(error.message) ? "CONNECTION" : /papel|schema|RLS/i.test(error.message) ? "DATABASE_ROLE" : /not (implemented|supported)|unsupported/i.test(error.message) ? "RUNTIME_COMPATIBILITY" : "INTERNAL") : "UNKNOWN" }));
        return Response.json({ error: "Homologação temporariamente indisponível." }, { status: 503, headers: { ...securityHeaders, "Cache-Control": "no-store" } });
      }
    }
    if (!["GET","HEAD"].includes(request.method)) return new Response(null, { status: 405 });
    let response = await env.ASSETS.fetch(request);
    if (response.status === 404 && !/\.[a-z0-9]{1,8}$/i.test(url.pathname)) {
      const target = url.pathname.startsWith("/p/") ? "/client.html" : url.pathname === "/privacidade" ? "/privacidade.html" : "/app.html";
      response = await env.ASSETS.fetch(new Request(new URL(target,url), request));
    }
    const headers = new Headers(response.headers);
    for (const [key,value] of Object.entries(securityHeaders)) headers.set(key,value);
    if ((headers.get("Content-Type") || "").includes("text/html")) headers.set("Cache-Control","no-store");
    return new Response(response.body, { status: response.status, headers });
  },
};
