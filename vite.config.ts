import { defineConfig, type ServerOptions } from "vite";
import react from "@vitejs/plugin-react";
export function localServerConfig(
  env: Record<string, string | undefined> = process.env,
): ServerOptions {
  const combined = env.LOCAL_HOMOLOGATION === "true";
  return {
    host: "127.0.0.1",
    port: Number(env.DEV_WEB_PORT || 5173),
    strictPort: true,
    proxy: {
      "/api": `http://127.0.0.1:${env.DEV_API_PORT || 3001}`,
      "/admin-api": {
        target: `http://127.0.0.1:${combined ? env.DEV_API_PORT || 3001 : env.DEV_ADMIN_PORT || 3002}`,
        rewrite: (path) => (combined ? `/api${path}` : path),
      },
    },
  };
}
export default defineConfig({
  plugins: [react()],
  server: localServerConfig(),
});
