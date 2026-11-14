import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "vite";
import { createDatabase } from "../server/db/database.js";
import { createApp } from "../server/app.js";
import { hashPassword } from "../server/auth/session.js";
import { localServerConfig } from "../vite.config.js";

test("INF-010 Vite proxies operational login/logout and admin API in isolated local ports", async () => {
  const db = createDatabase(":memory:");
  db.prepare("INSERT INTO tenants(id,name) VALUES(?,?)").run(
    "inf010-fixture",
    "Oficina INF-010 Fictícia",
  );
  db.prepare("INSERT INTO users VALUES(?,?,?,?)").run(
    "inf010-user",
    "Responsável fictício",
    "inf010@example.test",
    hashPassword("Ficticia-INF010-2026"),
  );
  db.prepare("INSERT INTO memberships VALUES(?,?,?)").run(
    "inf010-user",
    "inf010-fixture",
    "owner",
  );
  const api = createApp(db, (req, res) => {
    assert.equal(req.path, "/admin-api/session");
    res
      .status(401)
      .json({ error: "Entre no painel central.", inf010_admin: true });
  }).listen(0, "127.0.0.1");
  await once(api, "listening");
  const apiPort = (api.address() as { port: number }).port;
  const vite = await createServer({
    configFile: false,
    server: {
      ...localServerConfig({
        LOCAL_HOMOLOGATION: "true",
        DEV_API_PORT: String(apiPort),
      }),
      port: 0,
      strictPort: false,
    },
    logLevel: "silent",
  });
  try {
    await vite.listen();
    const port = (vite.httpServer!.address() as { port: number }).port;
    const base = `http://127.0.0.1:${port}`;
    const post = (
      path: string,
      body: unknown,
      cookie = "",
      origin = "http://127.0.0.1:5173",
    ) =>
      fetch(base + path, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: origin,
          Cookie: cookie,
        },
        body: JSON.stringify(body),
      });
    assert.equal((await fetch(base + "/inicio")).status, 200);
    assert.equal((await fetch(base + "/api/session")).status, 401);
    const admin = await fetch(base + "/admin-api/session");
    assert.equal(admin.status, 401);
    assert.equal((await admin.json()).inf010_admin, true);
    assert.equal(
      (
        await post(
          "/api/login",
          { email: "inf010@example.test", password: "Ficticia-INF010-2026" },
          "",
          "https://evil.example",
        )
      ).status,
      403,
    );
    const login = await post("/api/login", {
      email: "inf010@example.test",
      password: "Ficticia-INF010-2026",
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    assert.match(login.headers.get("set-cookie")!, /HttpOnly/i);
    assert.equal(
      (await fetch(base + "/api/session", { headers: { Cookie: cookie } }))
        .status,
      200,
    );
    assert.equal((await post("/api/logout", {}, cookie)).status, 200);
    assert.equal(
      (await fetch(base + "/api/session", { headers: { Cookie: cookie } }))
        .status,
      401,
    );
    assert.equal(
      (
        await fetch(base + "/api/session", {
          headers: { Cookie: "hp_session=expired-invalid" },
        })
      ).status,
      401,
    );
  } finally {
    await vite.close();
    await new Promise<void>((resolve, reject) =>
      api.close((e) => (e ? reject(e) : resolve())),
    );
    db.close();
  }
});
