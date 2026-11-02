import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createHash } from "node:crypto";
import { createDatabase } from "../server/db/database.js";
import { createApp } from "../server/app.js";
import { digest, hashPassword, verifyPassword } from "../server/auth/session.js";
import {
  passwordResetTtlMinutes, newPasswordResetToken, passwordResetUrl,
  sendPasswordResetEmail, issuePasswordReset, completePasswordReset,
} from "../server/services/passwordReset.js";

test("password reset link is private, one use and expires after 30 minutes", () => {
  assert.equal(passwordResetTtlMinutes, 30);
  const token = newPasswordResetToken();
  assert.match(token, /^[a-f0-9]{64}$/);
  assert.equal(passwordResetUrl("https://sistema.example", token), `https://sistema.example/recuperar-senha#${token}`);
  assert.throws(() => passwordResetUrl("http://sistema.example", token), /password_reset_origin_invalid/);
  assert.throws(() => passwordResetUrl("https://user:password@sistema.example", token), /password_reset_origin_invalid/);
});

test("reset mail uses Resend without exposing its token in logs or URL query", async () => {
  let request: RequestInit | undefined;
  await sendPasswordResetEmail({ email: "owner@example.test", token: "a".repeat(64), requestId: "request-1" }, {
    apiKey: "fictional-key", from: "OSDrive <teste@example.test>", appOrigin: "https://sistema.example",
    fetchImpl: async (_input, init) => { request = init; return new Response('{"id":"mail-1"}', { status: 200 }); },
  });
  assert.equal(new Headers(request?.headers).get("Idempotency-Key"), "workshop-password-reset/request-1");
  const body = JSON.parse(String(request?.body));
  assert.equal(body.to[0], "owner@example.test");
  assert.match(body.text, /\/recuperar-senha#aaaaaaaa/);
  assert.doesNotMatch(body.text, /\?token=/);
  await assert.rejects(sendPasswordResetEmail(
    { email: "owner@example.test", token: "b".repeat(64), requestId: "request-2" },
    { apiKey: "key", from: "OSDrive <teste@example.test>", appOrigin: "https://sistema.example",
      fetchImpl: async () => new Response("provider secret", { status: 403 }) },
  ), /password_reset_mail_delivery_failed/);
});

test("SQLite: only workshop accounts can reset, token expires and all their sessions end", async () => {
  const db = createDatabase(":memory:");
  try {
    db.prepare("INSERT INTO tenants(id,name) VALUES(?,?)").run("tenant-a", "Oficina Fictícia A");
    db.prepare("INSERT INTO tenants(id,name) VALUES(?,?)").run("tenant-b", "Oficina Fictícia B");
    db.prepare("INSERT INTO users(id,name,email,password_hash) VALUES(?,?,?,?)")
      .run("user-a", "Proprietário Fictício", "owner@example.test", hashPassword("Old-Fictional-Password"));
    db.prepare("INSERT INTO users(id,name,email,password_hash) VALUES(?,?,?,?)")
      .run("user-b", "Outro Proprietário", "other@example.test", hashPassword("Other-Fictional-Password"));
    db.prepare("INSERT INTO users(id,name,email,password_hash) VALUES(?,?,?,?)")
      .run("user-no-workshop", "Sem Oficina", "nobody@example.test", hashPassword("No-Workshop-Password"));
    db.prepare("INSERT INTO memberships(user_id,tenant_id,role) VALUES(?,?,?)").run("user-a","tenant-a","owner");
    db.prepare("INSERT INTO memberships(user_id,tenant_id,role) VALUES(?,?,?)").run("user-b","tenant-b","owner");
    db.prepare("INSERT INTO sessions(token_hash,user_id,tenant_id,expires_at) VALUES(?,?,?,?)")
      .run(digest("session-a"),"user-a","tenant-a",Date.now()+60_000);
    db.prepare("INSERT INTO sessions(token_hash,user_id,tenant_id,expires_at) VALUES(?,?,?,?)")
      .run(digest("session-b"),"user-b","tenant-b",Date.now()+60_000);
    const token = newPasswordResetToken(), tokenHash = digest(token);
    assert.equal(await issuePasswordReset(db,"owner@example.test",digest("ip-a"),tokenHash),"owner@example.test");
    assert.equal(await issuePasswordReset(db,"nobody@example.test",digest("ip-b"),digest("no-membership")),null);
    assert.equal(await issuePasswordReset(db,"missing@example.test",digest("ip-c"),digest("missing")),null);
    assert.equal(await completePasswordReset(db,digest("wrong"),"New-Fictional-Password"),false);
    assert.equal(await completePasswordReset(db,tokenHash,"New-Fictional-Password"),true);
    assert.equal(await completePasswordReset(db,tokenHash,"Newer-Fictional-Password"),false);
    assert.equal(db.prepare("SELECT count(*) AS n FROM sessions WHERE user_id=?").get("user-a")!.n,0);
    assert.equal(db.prepare("SELECT count(*) AS n FROM sessions WHERE user_id=?").get("user-b")!.n,1);
    assert.equal(verifyPassword("New-Fictional-Password",String(db.prepare("SELECT password_hash FROM users WHERE id=?").get("user-a")!.password_hash)),true);
    const expired = digest("expired");
    assert.equal(await issuePasswordReset(db,"other@example.test",digest("ip-d"),expired),"other@example.test");
    db.prepare("UPDATE password_reset_tokens SET expires_at=? WHERE token_hash=?").run(Date.now()-1,expired);
    assert.equal(await completePasswordReset(db,expired,"Should-Not-Apply"),false);
  } finally { db.close(); }
});

test("HTTP recovery never reveals whether an email exists and blocks a reused link", async () => {
  const db = createDatabase(":memory:");
  let emailBody: Record<string, unknown> | undefined;
  const app = createApp(db, undefined, {
    apiKey:"fictional-key",from:"OSDrive <teste@example.test>",appOrigin:"https://sistema.example",
    fetchImpl:async (_url,init)=>{emailBody=JSON.parse(String(init?.body));return new Response('{"id":"mail-test"}',{status:200});},
  });
  db.prepare("INSERT INTO tenants(id,name) VALUES(?,?)").run("tenant-http","Oficina Fictícia");
  db.prepare("INSERT INTO users(id,name,email,password_hash) VALUES(?,?,?,?)")
    .run("user-http","Proprietário","owner-http@example.test",hashPassword("Old-Fictional-Password"));
  db.prepare("INSERT INTO memberships(user_id,tenant_id,role) VALUES(?,?,?)").run("user-http","tenant-http","owner");
  const server=app.listen(0,"127.0.0.1");
  try {
    await once(server,"listening");
    const addr=server.address();assert.ok(addr && typeof addr!=="string");
    const post=(path:string,body:unknown)=>fetch(`http://127.0.0.1:${addr.port}/api${path}`,{
      method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body),
    });
    const absent=await post("/password-reset/request",{email:"missing-http@example.test"});
    assert.equal(absent.status,202);
    const known=await post("/password-reset/request",{email:"owner-http@example.test"});
    assert.equal(known.status,202);
    assert.deepEqual(await absent.json(),await known.json());
    assert.equal(Array.isArray(emailBody?.to) ? emailBody.to[0] : undefined,"owner-http@example.test");
    const token=String(emailBody?.text).match(/recuperar-senha#([a-f0-9]{64})/)?.[1];
    assert.ok(token);
    assert.equal((await post("/password-reset/complete",{token,password:"New-Fictional-Password"})).status,200);
    assert.equal((await post("/password-reset/complete",{token,password:"Newer-Fictional-Password"})).status,400);
    assert.equal((await post("/password-reset/complete",{token:"a".repeat(64),password:"Wrong"})).status,400);
  } finally { server.close();db.close(); }
});
