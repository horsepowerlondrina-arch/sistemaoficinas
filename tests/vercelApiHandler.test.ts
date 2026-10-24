import assert from "node:assert/strict";
import { once } from "node:events";
import express from "express";
import test from "node:test";
import { createApp } from "../server/app.js";
import type { DB } from "../server/db/database.js";
import {
  createVercelApiHandler,
  resolveVercelApiUrl,
} from "../server/vercelApiHandler.js";

test("Vercel gateway restores API paths and query parameters", () => {
  assert.equal(
    resolveVercelApiUrl(
      "/api/index?__hp_vercel_path=%2Fapi%2Fadmin-api%2Fsession&limit=10",
    ),
    "/api/admin-api/session?limit=10",
  );
  assert.equal(
    resolveVercelApiUrl("/api/index?__hp_vercel_path=%2Fapi%2Fsession"),
    "/api/session",
  );
  assert.equal(resolveVercelApiUrl("/api/index"), null);
  assert.equal(
    resolveVercelApiUrl("/api/index?__hp_vercel_path=%2Foutside"),
    null,
  );
  assert.equal(
    resolveVercelApiUrl(
      "/api/index?__hp_vercel_path=https%3A%2F%2Fevil.example%2Fapi%2Fsession",
    ),
    null,
  );
});

test("serverless admin routes reach independent admin auth while workshop API remains protected", async (t) => {
  const database = {
    prepare: () => ({ get: async () => undefined }),
  } as unknown as DB;
  const platformAdmin = express();
  platformAdmin.get("/admin-api/session", (_req, res) => {
    res.status(401).json({ error: "Entre no painel central." });
  });
  platformAdmin.post("/admin-api/login", (_req, res) => {
    res
      .status(400)
      .json({ error: "Informe e-mail, senha e código autenticador válidos." });
  });

  const gateway = express();
  gateway.use(createVercelApiHandler(createApp(database, platformAdmin)));
  const server = gateway.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const route = (path: string) =>
    `/?__hp_vercel_path=${encodeURIComponent(path)}`;

  const adminSession = await fetch(base + route("/api/admin-api/session"));
  assert.equal(adminSession.status, 401);
  assert.deepEqual(await adminSession.json(), {
    error: "Entre no painel central.",
  });

  const adminLogin = await fetch(base + route("/api/admin-api/login"), {
    method: "POST",
    headers: {
      Origin: "http://127.0.0.1:5173",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email: "admin@example.test" }),
  });
  assert.equal(adminLogin.status, 400);
  assert.match((await adminLogin.json()).error, /código autenticador/);

  const workshopSession = await fetch(base + route("/api/session"));
  assert.equal(workshopSession.status, 401);
  assert.deepEqual(await workshopSession.json(), {
    error: "Entre na sua conta para continuar.",
  });
});
