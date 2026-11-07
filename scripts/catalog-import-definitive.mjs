import { spawn } from "node:child_process";
import { resolve } from "node:path";

const path = resolve(process.argv[2] || "");
const password = process.env.HP_CATALOG_TARGET_PASSWORD;
const targetRef = "rvlovjpquozbrsszsxwe";
if (process.env.GITHUB_ACTIONS !== "true" || process.env.GITHUB_EVENT_NAME !== "workflow_dispatch" ||
    process.env.CATALOG_IMPORT_TARGET !== "horse-power-definitive" ||
    process.env.CATALOG_IMPORT_CONFIRM !== "HP-DEFINITIVE-CATALOG-IMPORT" ||
    process.env.CATALOG_RIGHTS_CONFIRMED !== "true" ||
    !process.env.RUNNER_TEMP || !path.startsWith(resolve(process.env.RUNNER_TEMP) + "/") ||
    !password || /[\r\n]/.test(password)) {
  throw new Error("Destino definitivo exige execução manual confirmada e segredo protegido.");
}
const url = new URL(`postgresql://hp_catalog_import_login.${targetRef}@aws-1-ca-central-1.pooler.supabase.com:5432/postgres`);
url.password = password;
const env = {
  ...process.env,
  CATALOG_IMPORT_DATABASE_URL: url.toString(),
};
delete env.HP_CATALOG_TARGET_PASSWORD;
delete env.HP_CATALOG_SOURCE_PASSWORD;
const child = spawn("npm", ["run", "catalog:import", "--", path], { stdio: "inherit", env });
child.on("error", () => { process.exitCode = 1; });
child.on("exit", (code) => { process.exitCode = code ?? 1; });
