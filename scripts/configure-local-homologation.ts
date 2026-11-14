import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { existsSync, writeFileSync, chmodSync } from "node:fs";
import { configureLocalHomologation } from "../server/localHomologationConfig.js";
if (!process.stdin.isTTY || !process.stdout.isTTY)
  throw new Error("Execute este assistente em um terminal privado interativo.");
const path = process.env.DEV_ENV_FILE || ".env.development.local";
if (existsSync(path))
  throw new Error(
    "Configuração já existe; preserve-a e edite no seu gerenciador/editor privado, ou escolha DEV_ENV_FILE diferente.",
  );
let muted = false;
const output = new Writable({
  write(chunk, _encoding, callback) {
    if (!muted) process.stdout.write(chunk);
    callback();
  },
});
const rl = createInterface({ input: process.stdin, output, terminal: true });
async function secret(label: string) {
  process.stdout.write(label + ": ");
  muted = true;
  try {
    return (await rl.question("")).trim();
  } finally {
    muted = false;
    process.stdout.write("\n");
  }
}
try {
  console.log(
    "Somente homologação vnclahdnirqlcbamodqy. Nada será enviado ao chat nem ao GitHub.",
  );
  const env: Record<string, string> = {
    DATABASE_URL: await secret("Conexão do usuário horse_power_app"),
    PLATFORM_ADMIN_DATABASE_URL: await secret(
      "Conexão do usuário hp_platform_admin_app",
    ),
    PLATFORM_ADMIN_TOTP_ENCRYPTION_KEY: await secret(
      "Chave MFA existente da homologação (64 caracteres hexadecimais)",
    ),
  };
  configureLocalHomologation(env);
  const content =
    [
      "# INF-010 — privado; não versionar",
      ...[
        "DATABASE_URL",
        "PLATFORM_ADMIN_DATABASE_URL",
        "PLATFORM_ADMIN_TOTP_ENCRYPTION_KEY",
      ].map((key) => `${key}=${JSON.stringify(env[key])}`),
    ].join("\n") + "\n";
  writeFileSync(path, content, { flag: "wx", mode: 0o600 });
  chmodSync(path, 0o600);
  console.log(
    "Configuração privada salva. Inicie com npm run dev:homologation.",
  );
} catch {
  console.error(
    "Configuração não gravada: confira os três valores e o destino. Nenhum valor foi exibido.",
  );
  process.exitCode = 1;
} finally {
  rl.close();
}
