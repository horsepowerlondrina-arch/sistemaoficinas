import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import pg, { type Pool } from "pg";
import { adminClient } from "../scripts/local-admin.js";
import { platformAdminDatabaseUrl } from "../server/localConfig.js";
import { digestAdminToken } from "../server/auth/platformAdmin.js";
import { hashPassword } from "../server/auth/session.js";
import { createPlatformAdminApp } from "../server/platformAdminApp.js";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
if (existsSync(".env.platform-admin.local")) process.loadEnvFile(".env.platform-admin.local");

test("PostgreSQL: convites de ativação, teste grátis, idempotência e isolamento", async () => {
  const runtimeUrl = platformAdminDatabaseUrl(process.env.PLATFORM_ADMIN_DATABASE_URL);
  const owner = adminClient();
  const suffix = randomBytes(6).toString("hex");
  const pa = `activation_test_${suffix}`;
  const hp = `activation_users_test_${suffix}`;
  const pool = new pg.Pool({ connectionString: runtimeUrl, ssl: false, max: 4, connectionTimeoutMillis: 5000 });
  const rewrite = (sql: string) => sql.replaceAll("platform_admin.", `${pa}.`).replaceAll("horse_power.", `${hp}.`);
  const query = (sql: string, values?: unknown[]) => pool.query(rewrite(sql), values as never[]);
  const ownerQuery = (sql: string, values?: unknown[]) => owner.query(rewrite(sql), values as never[]);
  let lastQueryError: {code?:string;message?:string}|undefined;
  const appPool = {
    query: async (sql: string, values?: unknown[]) => {
      try { return await query(sql,values); } catch (error) { lastQueryError=error as {code?:string;message?:string}; throw error; }
    },
    connect: async () => {
      const client=await pool.connect();
      return {
        query: async (sql: string, values?: unknown[]) => {
          try { return await client.query(rewrite(sql),values as never[]); }
          catch (error) { lastQueryError=error as {code?:string;message?:string}; throw error; }
        },
        release: () => client.release(),
      };
    },
  } as unknown as Pool;
  let schemasCreated = false;
  let server: ReturnType<ReturnType<typeof createPlatformAdminApp>["listen"]> | undefined;
  const previousOrigins = process.env.APP_ORIGINS;

  const addInvite = async (email: string, options: { expires?: Date; tenantId?: string } = {}) => {
    const tenantId = options.tenantId || randomUUID();
    const token = randomBytes(32).toString("hex");
    await owner.query(`INSERT INTO ${pa}.workshops(tenant_id,source,name,responsible_name,responsible_email,status)
      VALUES($1,'admin',$2,'Responsável Fictício',$3,'pending_verification')`, [tenantId,`Oficina Fictícia ${tenantId.slice(0,6)}`,email]);
    await owner.query(`INSERT INTO ${pa}.workshop_activation_invites(id,tenant_id,token_hash,responsible_email,expires_at)
      VALUES($1,$2,$3,lower($4),$5)`, [randomUUID(),tenantId,digestAdminToken(token),email,options.expires || new Date(Date.now()+60_000)]);
    return { tenantId, token, tokenHash:digestAdminToken(token) };
  };

  try {
    await owner.connect();
    await owner.query(`CREATE SCHEMA ${pa}; CREATE SCHEMA ${hp}`);
    schemasCreated = true;
    await owner.query(`CREATE TABLE ${pa}.administrators(
        id text PRIMARY KEY,email text NOT NULL,display_name text NOT NULL,role text NOT NULL,
        permissions text[] NOT NULL DEFAULT '{}',active boolean NOT NULL DEFAULT true,enrolled boolean NOT NULL DEFAULT true);
      CREATE TABLE ${pa}.sessions(token_hash text PRIMARY KEY,administrator_id text NOT NULL REFERENCES ${pa}.administrators(id),expires_at timestamptz NOT NULL);
      CREATE TABLE ${pa}.workshops(
        tenant_id text PRIMARY KEY, source text NOT NULL, name text NOT NULL,
        responsible_name text NOT NULL, responsible_email text NOT NULL,
        status text NOT NULL, email_verified_at timestamptz, trial_started_at timestamptz,
        trial_ends_at timestamptz, status_reason text NOT NULL DEFAULT '', updated_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE ${pa}.audit_events(
        id text PRIMARY KEY, actor_administrator_id text, subject_tenant_id text,
        actor_email text, action text NOT NULL, result text NOT NULL, technical_context jsonb NOT NULL DEFAULT '{}');
      CREATE TABLE ${hp}.users(id text PRIMARY KEY,name text NOT NULL,email text NOT NULL UNIQUE,password_hash text NOT NULL);
      CREATE TABLE ${hp}.memberships(user_id text NOT NULL,tenant_id text NOT NULL,role text NOT NULL,PRIMARY KEY(user_id,tenant_id));
      CREATE TABLE ${hp}.sessions(token_hash text PRIMARY KEY,user_id text NOT NULL,tenant_id text NOT NULL,expires_at bigint NOT NULL,
        FOREIGN KEY(user_id,tenant_id) REFERENCES ${hp}.memberships(user_id,tenant_id));`);
    await owner.query(`GRANT USAGE ON SCHEMA ${pa} TO hp_platform_admin_app`);
    const migration = readFileSync("supabase/migrations/20261024100000_workshop_activation.sql", "utf8")
      .replaceAll("platform_admin.", `${pa}.`).replaceAll("horse_power.", `${hp}.`)
      .replaceAll("horse_power_app", "hp_local_app");
    await owner.query(migration);

    process.env.APP_ORIGINS = "http://127.0.0.1:5173";
    server = createPlatformAdminApp(appPool, "a".repeat(64)).listen(0,"127.0.0.1");
    await once(server,"listening");
    const address = server.address(); assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}`;
    const post = (path: string, body: unknown, cookie?: string, origin = "http://127.0.0.1:5173") => fetch(base+path,{
      method:"POST",headers:{Origin:origin,"Content-Type":"application/json",...(cookie?{Cookie:`hp_platform_session=${cookie}`}:{})},body:JSON.stringify(body),
    });
    const manageSessionToken = randomBytes(32).toString("hex");
    const readOnlySessionToken = randomBytes(32).toString("hex");
    await owner.query(`INSERT INTO ${pa}.administrators(id,email,display_name,role,permissions) VALUES
      ('admin-manage','admin-manage@example.test','Admin Teste','principal',ARRAY['workshops:manage']),
      ('admin-read','admin-read@example.test','Admin Leitura','support',ARRAY['workshops:read'])`);
    await owner.query(`INSERT INTO ${pa}.sessions(token_hash,administrator_id,expires_at) VALUES
      ($1,'admin-manage',now()+interval '1 hour'),($2,'admin-read',now()+interval '1 hour')`,
      [digestAdminToken(manageSessionToken),digestAdminToken(readOnlySessionToken)]);

    const fresh = await addInvite("owner-one@example.test");
    assert.notEqual((await ownerQuery(`SELECT token_hash FROM ${pa}.workshop_activation_invites WHERE token_hash=$1`,[fresh.tokenHash])).rows[0].token_hash,fresh.token);
    const preview = await query(`SELECT * FROM ${pa}.inspect_workshop_activation($1)`, [fresh.tokenHash]);
    assert.equal(preview.rows[0].valid, true);
    assert.match(preview.rows[0].workshop_name, /^Oficina Fictícia/);
    assert.equal(preview.rows[0].account_exists, false);
    const httpPreview = await post("/admin-api/workshop-activation/validate",{token:fresh.token});
    assert.equal(httpPreview.status,200);
    const previewBody = await httpPreview.json() as {workshop_name:string;masked_email:string};
    assert.match(previewBody.masked_email,/\*\*\*@example\.test$/);
    assert.equal(JSON.stringify(previewBody).includes("owner-one@example.test"),false);
    const tamperedToken = `${fresh.token.slice(0,-1)}${fresh.token.endsWith("0") ? "1" : "0"}`;
    assert.equal((await post("/admin-api/workshop-activation/validate",{token:tamperedToken})).status,400);
    const activated = await post("/admin-api/workshop-activation/complete",{token:fresh.token,password:"Synthetic-Test-Password-Only"});
    assert.equal(activated.status,200,`${lastQueryError?.code || ""} ${lastQueryError?.message || ""}`);
    const activatedBody = await activated.json() as {activated?:boolean;account_created:boolean;tenant_id:string};
    assert.deepEqual(activatedBody, { account_created:true, tenant_id:fresh.tenantId });
    assert.match(activated.headers.get("set-cookie") || "",/^hp_session=.*HttpOnly; SameSite=Strict/);
    const newUserId = (await ownerQuery(`SELECT id FROM ${hp}.users WHERE email=$1`,["owner-one@example.test"])).rows[0].id as string;
    const sessionHash = (await ownerQuery(`SELECT token_hash FROM ${hp}.sessions WHERE user_id=$1 AND tenant_id=$2`,[newUserId,fresh.tenantId])).rows[0].token_hash as string;
    const newUser = await ownerQuery(`SELECT id,email,password_hash FROM ${hp}.users WHERE id=$1`, [newUserId]);
    assert.equal(newUser.rows[0].email,"owner-one@example.test");
    assert.notEqual(newUser.rows[0].password_hash,"Synthetic-Test-Password-Only");
    assert.deepEqual((await ownerQuery(`SELECT role FROM ${hp}.memberships WHERE user_id=$1 AND tenant_id=$2`,[newUserId,fresh.tenantId])).rows,[{role:"owner"}]);
    assert.equal((await ownerQuery(`SELECT count(*)::int AS n FROM ${hp}.sessions WHERE token_hash=$1 AND tenant_id=$2`,[sessionHash,fresh.tenantId])).rows[0].n,1);
    await assert.rejects(query(`SELECT id FROM ${hp}.users`),{code:"42501"});
    const trial = (await ownerQuery(`SELECT status,email_verified_at,trial_started_at,trial_ends_at FROM ${pa}.workshops WHERE tenant_id=$1`,[fresh.tenantId])).rows[0];
    assert.equal(trial.status,"trial"); assert.ok(trial.email_verified_at); assert.ok(trial.trial_started_at);
    assert.equal(new Date(trial.trial_ends_at).getTime()-new Date(trial.trial_started_at).getTime(),14*86400000);
    assert.equal((await ownerQuery(`SELECT count(*)::int AS n FROM ${pa}.audit_events WHERE action='workshop.activation.completed' AND subject_tenant_id=$1`,[fresh.tenantId])).rows[0].n,1);
    assert.equal((await query(`SELECT delivery_status FROM ${pa}.workshop_activation_invites WHERE token_hash=$1`,[fresh.tokenHash])).rows[0].delivery_status,"used");
    assert.equal((await query(`SELECT * FROM ${pa}.inspect_workshop_activation($1)`,[digestAdminToken(randomBytes(32).toString("hex"))])).rowCount,0);
    assert.equal((await post("/admin-api/workshop-activation/complete",{token:fresh.token,password:"Another-Synthetic-Password"})).status,400);
    assert.equal((await post("/admin-api/workshop-activation/complete",{token:randomBytes(32).toString("hex"),password:"Synthetic-Invalid-Token"})).status,400);

    const manualWorkshop = await addInvite("manual-owner@example.test");
    await ownerQuery(`UPDATE ${pa}.workshop_activation_invites SET created_at=now()-interval '2 minutes' WHERE tenant_id=$1`,[manualWorkshop.tenantId]);
    const manualUnauthenticated = await post(`/admin-api/workshops/${manualWorkshop.tenantId}/manual-activation-link`, {identity_verified:true,verification_method:"phone"});
    assert.equal(manualUnauthenticated.status,401);
    const manualForbidden = await post(`/admin-api/workshops/${manualWorkshop.tenantId}/manual-activation-link`, {identity_verified:true,verification_method:"phone"}, readOnlySessionToken);
    assert.equal(manualForbidden.status,403);
    const manualUnconfirmed = await post(`/admin-api/workshops/${manualWorkshop.tenantId}/manual-activation-link`, {identity_verified:false,verification_method:"phone"}, manageSessionToken);
    assert.equal(manualUnconfirmed.status,400);
    const manualBadOrigin = await post(`/admin-api/workshops/${manualWorkshop.tenantId}/manual-activation-link`, {identity_verified:true,verification_method:"phone"}, manageSessionToken, "https://untrusted.example");
    assert.equal(manualBadOrigin.status,403);
    const manualResponse = await post(`/admin-api/workshops/${manualWorkshop.tenantId}/manual-activation-link`,
      {identity_verified:true,verification_method:"in_person"}, manageSessionToken);
    assert.equal(manualResponse.status,200);
    const manualBody = await manualResponse.json() as {activation_url:string;invitation_expires_at:string};
    const manualUrl = new URL(manualBody.activation_url);
    const manualToken = manualUrl.hash.slice(1);
    assert.ok(/^[a-f0-9]{64}$/.test(manualToken),"manual activation token has the expected format");
    assert.equal(manualUrl.origin,"http://127.0.0.1:5173");
    assert.ok(new Date(manualBody.invitation_expires_at).getTime()>Date.now());
    assert.equal((await post("/admin-api/workshop-activation/validate",{token:manualToken})).status,200);
    const manualStored = (await ownerQuery(`SELECT id,token_hash,delivery_status FROM ${pa}.workshop_activation_invites WHERE tenant_id=$1 AND token_hash=$2`,[manualWorkshop.tenantId,digestAdminToken(manualToken)])).rows[0];
    assert.equal(manualStored.token_hash,digestAdminToken(manualToken));
    assert.ok(manualStored.token_hash !== manualToken,"activation token is never stored in plaintext");
    assert.equal(manualStored.delivery_status,"pending");
    assert.equal((await ownerQuery(`SELECT delivery_status FROM ${pa}.workshop_activation_invites WHERE tenant_id=$1 AND id<>$2`,[manualWorkshop.tenantId,manualStored.id])).rows[0].delivery_status,"revoked");
    const beforeManualCompletion = (await ownerQuery(`SELECT status,email_verified_at,trial_started_at FROM ${pa}.workshops WHERE tenant_id=$1`,[manualWorkshop.tenantId])).rows[0];
    assert.equal(beforeManualCompletion.status,"pending_verification");
    assert.equal(beforeManualCompletion.email_verified_at,null);
    assert.equal(beforeManualCompletion.trial_started_at,null);
    assert.equal((await ownerQuery(`SELECT count(*)::int AS n FROM ${hp}.users WHERE lower(email)=lower($1)`,["manual-owner@example.test"])).rows[0].n,0);
    const manualAudit = (await ownerQuery(`SELECT technical_context FROM ${pa}.audit_events
      WHERE action='admin.workshop.invitation.manual_link_created' AND subject_tenant_id=$1`,[manualWorkshop.tenantId])).rows[0].technical_context as Record<string,unknown>;
    assert.equal(manualAudit.identity_verified,true);
    assert.equal(manualAudit.verification_method,"in_person");
    assert.equal(manualAudit.invite_id,manualStored.id);
    const manualAuditText=JSON.stringify(manualAudit);
    assert.equal(manualAuditText.includes(manualToken),false);
    assert.equal(manualAuditText.includes(manualBody.activation_url),false);
    const manualActivated = await post("/admin-api/workshop-activation/complete",{token:manualToken,password:"Synthetic-Manual-Activation-Password"},manageSessionToken);
    assert.equal(manualActivated.status,200);
    const manualAfter = (await ownerQuery(`SELECT status,email_verified_at,trial_started_at FROM ${pa}.workshops WHERE tenant_id=$1`,[manualWorkshop.tenantId])).rows[0];
    assert.equal(manualAfter.status,"trial");
    assert.ok(manualAfter.email_verified_at);
    assert.ok(manualAfter.trial_started_at);
    assert.equal((await post("/admin-api/workshop-activation/complete",{token:manualToken,password:"Synthetic-Replay-Password"})).status,400);
    assert.equal((await ownerQuery(`SELECT status FROM ${pa}.workshops WHERE tenant_id=$1`,[manualWorkshop.tenantId])).rows[0].status,"trial");

    const manualExpired = await addInvite("manual-expired@example.test");
    await ownerQuery(`UPDATE ${pa}.workshop_activation_invites SET created_at=now()-interval '2 minutes' WHERE tenant_id=$1`,[manualExpired.tenantId]);
    const expiredManualResponse = await post(`/admin-api/workshops/${manualExpired.tenantId}/manual-activation-link`,
      {identity_verified:true,verification_method:"other"}, manageSessionToken);
    assert.equal(expiredManualResponse.status,200);
    const expiredManualBody = await expiredManualResponse.json() as {activation_url:string};
    const expiredManualToken = new URL(expiredManualBody.activation_url).hash.slice(1);
    await ownerQuery(`UPDATE ${pa}.workshop_activation_invites SET expires_at=now()-interval '1 second' WHERE token_hash=$1`,[digestAdminToken(expiredManualToken)]);
    assert.equal((await post("/admin-api/workshop-activation/validate",{token:expiredManualToken})).status,400);
    assert.equal((await ownerQuery(`SELECT status FROM ${pa}.workshops WHERE tenant_id=$1`,[manualExpired.tenantId])).rows[0].status,"pending_verification");
    assert.equal((await ownerQuery(`SELECT count(*)::int AS n FROM ${pa}.audit_events
      WHERE action='workshop.activation.completed' AND subject_tenant_id=$1`,[manualExpired.tenantId])).rows[0].n,0);

    const otherWorkshop = await addInvite("other-workshop@example.test");
    assert.equal((await ownerQuery(`SELECT tenant_id FROM ${pa}.workshop_activation_invites WHERE token_hash=$1`,[digestAdminToken(manualToken)])).rows[0].tenant_id,manualWorkshop.tenantId);
    assert.equal((await ownerQuery(`SELECT status FROM ${pa}.workshops WHERE tenant_id=$1`,[otherWorkshop.tenantId])).rows[0].status,"pending_verification");

    const existingUserId = randomUUID();
    const oldMembershipTenant = randomUUID();
    await owner.query(`INSERT INTO ${hp}.users(id,name,email,password_hash) VALUES($1,'Pessoa Existente','existing@example.test','keep-this-existing-password-hash')`, [existingUserId]);
    await owner.query(`INSERT INTO ${hp}.memberships(user_id,tenant_id,role) VALUES($1,$2,'operator')`, [existingUserId,oldMembershipTenant]);
    const existing = await addInvite("EXISTING@example.test");
    assert.equal((await query(`SELECT account_exists FROM ${pa}.inspect_workshop_activation($1)`,[existing.tokenHash])).rows[0].account_exists,true);
    const linked = await query(`SELECT * FROM ${pa}.complete_workshop_activation($1,$2,'',$3,$4,$5)`,[existing.tokenHash,randomUUID(),digestAdminToken(randomBytes(32).toString("hex")),Date.now()+86400000,randomUUID()]);
    assert.deepEqual(linked.rows[0],{activated:true,account_created:false,tenant_id:existing.tenantId});
    assert.equal((await ownerQuery(`SELECT password_hash FROM ${hp}.users WHERE id=$1`,[existingUserId])).rows[0].password_hash,"keep-this-existing-password-hash");
    assert.equal((await ownerQuery(`SELECT role FROM ${hp}.memberships WHERE user_id=$1 AND tenant_id=$2`,[existingUserId,oldMembershipTenant])).rows[0].role,"operator");
    assert.equal((await ownerQuery(`SELECT role FROM ${hp}.memberships WHERE user_id=$1 AND tenant_id=$2`,[existingUserId,existing.tenantId])).rows[0].role,"owner");
    assert.equal((await ownerQuery(`SELECT count(*)::int AS n FROM ${hp}.sessions WHERE user_id=$1 AND tenant_id=$2`,[existingUserId,existing.tenantId])).rows[0].n,0);

    const expired = await addInvite("expired@example.test",{expires:new Date(Date.now()-1000)});
    assert.equal((await query(`SELECT valid FROM ${pa}.inspect_workshop_activation($1)`,[expired.tokenHash])).rows[0].valid,false);
    assert.equal((await query(`SELECT activated FROM ${pa}.complete_workshop_activation($1,$2,$3,$4,$5,$6)`,[expired.tokenHash,randomUUID(),hashPassword("Synthetic-Expired-Password"),digestAdminToken(randomBytes(32).toString("hex")),Date.now()+1000,randomUUID()])).rows[0].activated,false);

    const changed = await addInvite("before-change@example.test");
    await owner.query(`UPDATE ${pa}.workshops SET responsible_email='after-change@example.test' WHERE tenant_id=$1`,[changed.tenantId]);
    assert.equal((await query(`SELECT delivery_status FROM ${pa}.workshop_activation_invites WHERE token_hash=$1`,[changed.tokenHash])).rows[0].delivery_status,"revoked");
    assert.equal((await query(`SELECT valid FROM ${pa}.inspect_workshop_activation($1)`,[changed.tokenHash])).rows[0].valid,false);

    const conflict = await addInvite("conflict@example.test");
    const conflictUserId = randomUUID();
    await owner.query(`INSERT INTO ${hp}.users(id,name,email,password_hash) VALUES($1,'Pessoa Conflito','conflict@example.test','unchanged')`,[conflictUserId]);
    await owner.query(`INSERT INTO ${hp}.memberships(user_id,tenant_id,role) VALUES($1,$2,'operator')`,[conflictUserId,conflict.tenantId]);
    await assert.rejects(query(`SELECT * FROM ${pa}.complete_workshop_activation($1,$2,'',$3,$4,$5)`,[conflict.tokenHash,randomUUID(),digestAdminToken(randomBytes(32).toString("hex")),Date.now()+1000,randomUUID()]),{code:"23505"});
    assert.equal((await ownerQuery(`SELECT status FROM ${pa}.workshops WHERE tenant_id=$1`,[conflict.tenantId])).rows[0].status,"pending_verification");
    assert.equal((await query(`SELECT used_at FROM ${pa}.workshop_activation_invites WHERE token_hash=$1`,[conflict.tokenHash])).rows[0].used_at,null);

    const racing = await addInvite("race@example.test");
    const complete = (userId: string) => query(`SELECT * FROM ${pa}.complete_workshop_activation($1,$2,$3,$4,$5,$6)`,[
      racing.tokenHash,userId,hashPassword("Synthetic-Racing-Password"),digestAdminToken(randomBytes(32).toString("hex")),Date.now()+86400000,randomUUID(),
    ]);
      const results = await Promise.all([complete(randomUUID()),complete(randomUUID())]);
    assert.equal(results.flatMap(result=>result.rows).filter(row=>row.activated).length,1);
    assert.equal((await ownerQuery(`SELECT count(*)::int AS n FROM ${hp}.memberships WHERE tenant_id=$1`,[racing.tenantId])).rows[0].n,1);
  } finally {
    if (server) await new Promise<void>(resolve => server!.close(()=>resolve()));
    if (previousOrigins === undefined) delete process.env.APP_ORIGINS; else process.env.APP_ORIGINS = previousOrigins;
    await pool.end();
    if (schemasCreated) await owner.query(`DROP SCHEMA ${pa} CASCADE; DROP SCHEMA ${hp} CASCADE`);
    await owner.end();
  }
});
