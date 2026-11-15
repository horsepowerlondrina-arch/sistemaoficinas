import { createServer } from "node:net";
import { configureLocalHomologation } from "./localHomologationConfig.js";
export const ports = configureLocalHomologation(process.env);
// Refuse a collision before opening pools or starting either child.
export async function assertFreePort(port: number) {
  await new Promise<void>((resolve, reject) => {
    const probe = createServer();
    probe.once("error", () =>
      reject(
        new Error(`Porta ${port} ocupada; use DEV_SLOT=2 ou portas próprias.`),
      ),
    );
    probe.listen(port, "127.0.0.1", () => probe.close(() => resolve()));
  });
}
// External requests are deliberately disabled in this development mode. PG uses TLS,
// not fetch. Existing cloud keys and tenant provider settings cannot trigger charges.
const originalFetch = globalThis.fetch;
globalThis.fetch = ((
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
) => {
  const url = new URL(
    typeof input === "string" || input instanceof URL ? input : input.url,
  );
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
    throw new Error(
      "Integração externa bloqueada no desenvolvimento local seguro.",
    );
  return originalFetch(input, init);
}) as typeof fetch;
