import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { cloudflare } from "@cloudflare/vite-plugin";
export default defineConfig({ publicDir: "../dist", resolve: { alias: { pg: fileURLToPath(new URL("./node_modules/pg/lib/index.js", import.meta.url)) } }, plugins: [cloudflare()] });
