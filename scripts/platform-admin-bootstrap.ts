import { existsSync } from "node:fs";
if (existsSync(".env.local")) process.loadEnvFile(".env.local");
if (existsSync(".env.platform-admin.local")) process.loadEnvFile(".env.platform-admin.local");
import pg from "pg";
import { randomBytes } from "node:crypto";
import { assertLocalProcess, platformAdminDatabaseUrl } from "../server/localConfig.js";
import { assertPlatformAdminDatabase } from "../server/platformAdminApp.js";
import { encryptTotpSecret, hashAdminPassword, newTotpSecret, platformPermissions, totpUri, verifyTotp, writeAdminAudit } from "../server/auth/platformAdmin.js";

function ask(label: string, masked = false) {
  if (!process.stdin.isTTY || !process.stdin.setRawMode) throw new Error("Execute a preparação da conta em um terminal interativo local.");
  return new Promise<string>((resolve, reject) => {
    process.stdout.write(label);
    let value = "";
    process.stdin.setEncoding("utf8"); process.stdin.setRawMode(true); process.stdin.resume();
    const cleanup = () => { process.stdin.off("data", onData); process.stdin.setRawMode(false); process.stdin.pause(); process.stdout.write("\n"); };
    const onData = (chunk: string) => {
      for (const character of chunk) {
        if (character === "\u0003") { cleanup(); reject(new Error("Configuração interrompida.")); return; }
        if (character === "\r" || character === "\n") { cleanup(); resolve(value); return; }
        if (character === "\u007f" || character === "\b") { value = value.slice(0, -1); if (masked) process.stdout.write("\b \b"); continue; }
        if (character >= " ") { value += character; process.stdout.write(masked ? "*" : character); }
      }
    };
    process.stdin.on("data", onData);
  });
}

assertLocalProcess();
const key = process.env.PLATFORM_ADMIN_TOTP_ENCRYPTION_KEY || "";
if (!/^[a-f0-9]{64}$/i.test(key)) throw new Error("Execute npm run db:local:migrate para preparar o painel central.");
const pool = new pg.Pool({ connectionString: platformAdminDatabaseUrl(process.env.PLATFORM_ADMIN_DATABASE_URL), ssl: false, max: 1, connectionTimeoutMillis: 5000 });
try {
  await assertPlatformAdminDatabase(pool);
  const count = await pool.query("SELECT count(*)::int AS count FROM platform_admin.administrators");
  if (count.rows[0].count) throw new Error("Já existe uma conta administrativa. Use o painel para gerenciar novas contas.");
  console.log("Configuração da primeira conta principal do painel local. Nenhuma conta das oficinas será usada.");
  const email = (await ask("E-mail administrativo: ")).trim().toLowerCase();
  const name = (await ask("Nome de exibição: ")).trim();
  const password = await ask("Senha (mínimo de 14 caracteres; entrada mascarada): ", true);
  const repeated = await ask("Repita a senha: ", true);
  if (!/^\S+@\S+\.\S+$/.test(email) || name.length < 2 || password.length < 14 || password !== repeated)
    throw new Error("E-mail, nome ou senha inválidos; nenhuma conta foi criada.");
  const secret = newTotpSecret();
  console.log("Cadastre este segredo em um aplicativo autenticador e depois informe o código atual.");
  console.log(`Segredo de configuração (exibido somente neste terminal): ${secret}`);
  console.log(`URI do autenticador: ${totpUri(secret, email)}`);
  const code = await ask("Código TOTP de 6 dígitos para confirmar: ", true);
  if (!verifyTotp(secret, code)) throw new Error("Código TOTP inválido; nenhuma conta foi criada.");
  const id = randomBytes(16).toString("hex");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const current = await client.query("SELECT count(*)::int AS count FROM platform_admin.administrators");
    if (current.rows[0].count) throw new Error("Outra conta administrativa foi configurada durante este processo.");
    await client.query(`INSERT INTO platform_admin.administrators(id,email,display_name,role,permissions,password_hash,totp_secret_ciphertext,active,enrolled)
      VALUES($1,$2,$3,'principal',$4::jsonb,$5,$6,true,true)`, [id,email,name,JSON.stringify(platformPermissions),hashAdminPassword(password),encryptTotpSecret(secret,key)]);
    await writeAdminAudit(client, { actorId:id, subjectId:id, actorEmail:email, action:"admin.bootstrap.completed", result:"success" });
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; } finally { client.release(); }
  console.log("Conta principal criada. O segredo do autenticador não será exibido novamente.");
} finally { await pool.end(); }
