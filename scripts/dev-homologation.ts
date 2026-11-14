import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
const envFile = process.env.DEV_ENV_FILE || ".env.development.local";
if (existsSync(envFile)) process.loadEnvFile(envFile);
const { ports, assertFreePort } =
  await import("../server/localHomologation.js");
await assertFreePort(ports.web);
await assertFreePort(ports.api);
const { createCloudRuntime } = await import("../server/cloudRuntime.js");
let runtime: Awaited<ReturnType<typeof createCloudRuntime>>;
try {
  runtime = await createCloudRuntime();
} catch {
  console.error(
    "Não foi possível validar as conexões/MFA da homologação. Confira as credenciais e os papéis restritos; nenhum segredo foi exibido.",
  );
  process.exit(1);
}
const server = runtime.app.listen(ports.api, "127.0.0.1", () => {
  console.log(
    `OSDrive local: http://127.0.0.1:${ports.web} | API: http://127.0.0.1:${ports.api} | execução: ${process.env.DEV_RUN_ID}`,
  );
});
const vite = spawn(
  process.execPath,
  [resolve("node_modules/vite/bin/vite.js"), "--host", "127.0.0.1"],
  { stdio: "inherit", env: process.env },
);
let closing = false;
async function close(code = 0) {
  if (closing) return;
  closing = true;
  vite.kill("SIGTERM");
  const timeout = setTimeout(() => process.exit(1), 10000);
  timeout.unref();
  server.close(async () => {
    await runtime.close();
    process.exit(code);
  });
}
vite.once("exit", (code) => void close(code || 0));
server.once("error", () => {
  console.error("Não foi possível iniciar a API local.");
  void close(1);
});
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => void close());
