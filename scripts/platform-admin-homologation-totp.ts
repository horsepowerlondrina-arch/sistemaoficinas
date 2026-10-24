import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { totpCode } from "../server/auth/platformAdmin.js";

if (process.env.VERCEL || process.env.VERCEL_ENV || process.env.NODE_ENV === "production")
  throw new Error("Consulta de TOTP recusada fora do computador local.");

const file = path.resolve("data/homologation-credentials.json");
if (!existsSync(file))
  throw new Error("Arquivo local restrito de credenciais da homologação não encontrado.");

const value = JSON.parse(readFileSync(file, "utf8")) as {
  version?: unknown;
  totpSecret?: unknown;
};
if (value.version !== 1 || typeof value.totpSecret !== "string" || !/^[A-Z2-7]{32}$/.test(value.totpSecret))
  throw new Error("Arquivo local de credenciais inválido; nenhum código foi exibido.");

console.log(totpCode(value.totpSecret));
