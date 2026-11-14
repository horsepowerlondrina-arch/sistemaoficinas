import { URL as NodeURL } from "node:url";
import { readFileSync } from "node:fs";
import { bindings, defineConfig } from "cf/config";
export default defineConfig({
  accountId: "398bbed171a2a062429f9e2efa6df1cc",
  worker: {
    name: "sistema-oficinas-homologacao",
    entrypoint: "./worker.ts",
    compatibilityDate: "2026-11-14",
    compatibilityFlags: ["nodejs_compat", "nodejs_compat_populate_process_env"],
    workersDev: true,
    assets: { runWorkerFirst: true, htmlHandling: "none" },
    observability: { enabled: true, redactQueryString: true,
      logs: { enabled: true, invocationLogs: false }, traces: { enabled: true, headSamplingRate: 0 } },
    env: {
      ASSETS: bindings.assets(),
      DATABASE: bindings.hyperdrive({ id: "5e060ca01a63467e9b7684f093c47a31" }),
      ADMIN_DATABASE: bindings.hyperdrive({ id: "017953836b764a709e07d19b9154ac7c" }),
      APP_ENV: bindings.text("development"), NODE_ENV: bindings.text("production"),
      EXPECTED_DATABASE_PROJECT: bindings.text("vnclahdnirqlcbamodqy"),
      APP_ORIGIN: bindings.text("https://sistema-oficinas-homologacao.osdrive-homologacao.workers.dev"),
      APP_ORIGINS: bindings.text("https://sistema-oficinas-homologacao.osdrive-homologacao.workers.dev"),
      PUBLIC_ORIGIN: bindings.text("https://sistema-oficinas-homologacao.osdrive-homologacao.workers.dev"),
      CLOUDFLARE_HOMOLOGATION: bindings.text("true"),
      STRIPE_BILLING_ENABLED: bindings.text("false"), SELF_SERVICE_TEST_ENABLED: bindings.text("false"),
      SUPABASE_CA: bindings.text(readFileSync(new NodeURL("../server/db/certs/supabase-ca.crt", import.meta.url), "utf8")),
      DATABASE_URL: bindings.secret(), PLATFORM_ADMIN_DATABASE_URL: bindings.secret(),
      PLATFORM_ADMIN_TOTP_ENCRYPTION_KEY: bindings.secret(),
    },
  },
});
