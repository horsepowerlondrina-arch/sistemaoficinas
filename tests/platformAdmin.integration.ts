import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { once } from "node:events";
import { randomBytes } from "node:crypto";
import pg, { type Pool } from "pg";
import { adminClient } from "../scripts/local-admin.js";
import { platformAdminDatabaseUrl } from "../server/localConfig.js";
import { assertPlatformAdminDatabase, createPlatformAdminApp } from "../server/platformAdminApp.js";
import { encryptTotpSecret, hashAdminPassword, newTotpSecret, platformPermissions, totpCode, verifyTotp } from "../server/auth/platformAdmin.js";
import { createLocalAdminSeedCredentials, ensureLocalAdminSeed, ensureLocalAdminWorkshopPermissions, validateLocalAdminSeedCredentials } from "../server/localAdminSeed.js";
import { TransferVerificationError } from "../server/services/dataTransferVerification.js";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
if (existsSync(".env.platform-admin.local")) process.loadEnvFile(".env.platform-admin.local");

test("PostgreSQL platform admin: login, MFA, separated sessions, roles, audit and database isolation", async () => {
  const runtimeUrl = platformAdminDatabaseUrl(process.env.PLATFORM_ADMIN_DATABASE_URL);
  const encryptionKey = process.env.PLATFORM_ADMIN_TOTP_ENCRYPTION_KEY || "";
  assert.match(encryptionKey, /^[a-f0-9]{64}$/i);
  const owner = adminClient(); await owner.connect();
  const schema = `platform_admin_test_${randomBytes(6).toString("hex")}`;
  const rawPool = new pg.Pool({ connectionString: runtimeUrl, ssl: false, max: 3, connectionTimeoutMillis: 5000 });
  const rewrite = (sql: string) => sql.replaceAll("'platform_admin'", `'${schema}'`).replaceAll("platform_admin.", `${schema}.`);
  const testPool = {
    query: (sql: string, values?: unknown[]) => rawPool.query(rewrite(sql), values as never[]),
    connect: async () => {
      const client = await rawPool.connect();
      return { query: (sql: string, values?: unknown[]) => client.query(rewrite(sql), values as never[]), release: () => client.release() };
    },
    end: () => rawPool.end(),
  } as unknown as Pool;
  let server: ReturnType<ReturnType<typeof createPlatformAdminApp>["listen"]> | undefined;
  const mfaEnvironmentKeys = ["VERCEL", "VERCEL_ENV", "VERCEL_PROJECT_ID", "PLATFORM_ADMIN_TEST_MFA_BYPASS_EMAIL", "PLATFORM_ADMIN_TEST_MFA_BYPASS_HOST"] as const;
  const originalMfaEnvironment = Object.fromEntries(mfaEnvironmentKeys.map(key => [key, process.env[key]]));
  try {
    const liveRole = await assertPlatformAdminDatabase(rawPool);
    assert.equal(liveRole.workshop_schema,false);
    assert.equal(liveRole.catalog_schema,false);
    const migration = ["004-platform-admin.sql","006-platform-admin-constraints.sql","033-critical-approval-column-grants.sql"]
      .map(file=>readFileSync(`local-postgres/${file}`,"utf8").replace(/\bplatform_admin\b/g,schema)).join("\n");
    await owner.query(migration);
    await owner.query(`ALTER TABLE ${schema}.administrators DROP CONSTRAINT platform_admin_permissions_allowlist;
      ALTER TABLE ${schema}.administrators ADD CONSTRAINT platform_admin_permissions_allowlist CHECK (permissions <@ '["audit:read","administrators:manage","platform:settings","critical:request","critical:approve","workshops:read","workshops:manage","data-transfer:manage","modules:manage"]'::jsonb);
      ALTER TABLE ${schema}.audit_events ADD COLUMN subject_tenant_id text`);
    const role = await assertPlatformAdminDatabase(testPool);
    assert.equal(role.role, "hp_platform_admin_app");
    assert.equal(role.workshop_schema, false);
    assert.equal(role.catalog_schema, false);
    const criticalUpdate=await testPool.query("SELECT has_column_privilege(current_user,'platform_admin.critical_operation_requests','status','UPDATE') AS status_update,has_column_privilege(current_user,'platform_admin.critical_operation_requests','approved_by','UPDATE') AS approved_by_update,has_column_privilege(current_user,'platform_admin.critical_operation_requests','decided_at','UPDATE') AS decided_at_update");
    assert.deepEqual(criticalUpdate.rows[0],{status_update:true,approved_by_update:true,decided_at_update:true});

    const key = encryptionKey, principalSecret = newTotpSecret(), financeSecret = newTotpSecret();
    const principalPassword = randomBytes(32).toString("base64url"), financePassword = randomBytes(32).toString("base64url");
    await testPool.query(`INSERT INTO ${schema}.administrators(id,email,display_name,role,permissions,password_hash,totp_secret_ciphertext,active,enrolled)
      VALUES($1,'root@example.test','Principal Fictício','principal',$2::jsonb,$3,$4,true,true)`, ["admin-root-test",JSON.stringify(platformPermissions),hashAdminPassword(principalPassword),encryptTotp(principalSecret,key)]);
    await testPool.query(`INSERT INTO ${schema}.administrators(id,email,display_name,role,permissions,password_hash,totp_secret_ciphertext,active,enrolled)
      VALUES($1,'finance@example.test','Financeiro Fictício','finance',$2::jsonb,$3,$4,true,true)`, ["admin-finance-test",JSON.stringify(["audit:read","administrators:manage"]),hashAdminPassword(financePassword),encryptTotp(financeSecret,key)]);

    const seedCredentials = validateLocalAdminSeedCredentials(createLocalAdminSeedCredentials());
    assert.equal((await ensureLocalAdminSeed(testPool,encryptionKey,seedCredentials)).created,true);
    const seedAccount = await testPool.query("SELECT id,email,role,active,enrolled,password_hash,totp_secret_ciphertext FROM platform_admin.administrators WHERE email=$1",[seedCredentials.email]);
    assert.equal(seedAccount.rowCount,1);
    assert.equal(seedAccount.rows[0].role,"principal");
    assert.equal(seedAccount.rows[0].active,true);
    assert.equal(seedAccount.rows[0].enrolled,true);
    assert.notEqual(seedAccount.rows[0].password_hash,seedCredentials.password);
    assert.equal((await ensureLocalAdminSeed(testPool,encryptionKey,seedCredentials)).created,false);
    assert.equal((await testPool.query("SELECT count(*)::int AS count FROM platform_admin.administrators WHERE email=$1",[seedCredentials.email])).rows[0].count,1);
    assert.equal((await testPool.query("SELECT count(*)::int AS count FROM platform_admin.audit_events WHERE action='admin.local_seed.created' AND actor_email=$1",[seedCredentials.email])).rows[0].count,1);
    await testPool.query("UPDATE platform_admin.administrators SET permissions=$1::jsonb WHERE email=$2",[JSON.stringify(["audit:read","platform:settings"]),seedCredentials.email]);
    assert.deepEqual(await ensureLocalAdminWorkshopPermissions(testPool),{status:"updated",added:["workshops:read","workshops:manage"]});
    assert.deepEqual(await ensureLocalAdminWorkshopPermissions(testPool),{status:"unchanged",added:[]});
    const reconciled=await testPool.query("SELECT permissions FROM platform_admin.administrators WHERE email=$1",[seedCredentials.email]);
    assert.deepEqual(reconciled.rows[0].permissions,["audit:read","platform:settings","workshops:read","workshops:manage"]);
    assert.equal((await testPool.query("SELECT count(*)::int AS count FROM platform_admin.audit_events WHERE action='admin.local_seed.permissions_reconciled' AND actor_email=$1",[seedCredentials.email])).rows[0].count,1);

    process.env.VERCEL = "1";
    process.env.VERCEL_ENV = "production";
    process.env.VERCEL_PROJECT_ID = "prj_rLVsFKBpMXQFtfm1kgYHFQObr4Jc";
    process.env.PLATFORM_ADMIN_TEST_MFA_BYPASS_EMAIL = seedCredentials.email;
    process.env.PLATFORM_ADMIN_TEST_MFA_BYPASS_HOST = "127.0.0.1";
    const fakeTenant = "00000000-0000-4000-8000-000000000001";
    let verificationFailure: unknown;
    const transferStub = {
      target: async (tenantId: string) => { if (tenantId !== fakeTenant) throw new Error("tenant-not-registered"); return { tenantId, workshopName: "Oficina Fictícia ADM" }; },
      exportPackage: async (tenantId: string) => ({ workshopName: "Oficina Fictícia ADM", archive: Buffer.from(tenantId) }),
      preview: async () => ({ canImport: true }), verify: async () => { if (verificationFailure) throw verificationFailure; return { overall: "not-verifiable" }; },
      import: async () => ({ mode: "empty" }), backups: async () => [], backup: async () => undefined,
      approvalConsumed: async () => false,
    };
    server = createPlatformAdminApp(testPool, encryptionKey, transferStub).listen(0,"127.0.0.1"); await once(server,"listening");
    const address = server.address(); assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}`;
    const request = (path: string, options: { method?: string; cookie?: string; body?: unknown } = {}) => fetch(base+path, {
      method: options.method || "GET", headers: { Origin:"http://127.0.0.1:5173", ...(options.cookie ? { Cookie:options.cookie } : {}), ...(options.body === undefined ? {} : {"Content-Type":"application/json"}) },
      ...(options.body === undefined ? {} : {body:JSON.stringify(options.body)}),
    });
    const login = async (email: string,password: string,secret: string,code = totpCode(secret)) => request("/admin-api/login",{method:"POST",body:{email,password,code}});

    assert.equal((await login(seedCredentials.email,randomBytes(32).toString("base64url"),seedCredentials.totpSecret)).status,401);
    assert.equal((await login(seedCredentials.email,seedCredentials.password,seedCredentials.totpSecret,"111111")).status,401);
    const passwordOnlySeedLogin = await request("/admin-api/login",{method:"POST",body:{email:seedCredentials.email,password:seedCredentials.password}});
    assert.equal(passwordOnlySeedLogin.status,400);
    assert.equal(passwordOnlySeedLogin.headers.get("set-cookie"),null);
    const seedLogin = await login(seedCredentials.email,seedCredentials.password,seedCredentials.totpSecret);
    assert.equal(seedLogin.status,200);
    const seedCookie = seedLogin.headers.get("set-cookie")?.split(";")[0] || "";
    assert.equal((await request("/admin-api/session",{cookie:seedCookie})).status,200);
    assert.equal((await request("/admin-api/session",{cookie:"hp_session=fake-workshop-session"})).status,401);

    const badPassword = await login("root@example.test",randomBytes(32).toString("base64url"),principalSecret);
    assert.equal(badPassword.status,401);
    const badMfa = await login("root@example.test",principalPassword,principalSecret,"123456");
    assert.equal(badMfa.status,401);
    assert.equal(verifyTotp(principalSecret,totpCode(principalSecret)),true);
    const missingMfa = await request("/admin-api/login",{method:"POST",body:{email:"root@example.test",password:principalPassword}});
    assert.equal(missingMfa.status,400);

    const principalLogin = await login("root@example.test",principalPassword,principalSecret);
    assert.equal(principalLogin.status,200);
    const principalCookie = principalLogin.headers.get("set-cookie")?.split(";")[0] || "";
    assert.match(principalCookie,/^hp_platform_session=/);
    assert.match(principalLogin.headers.get("set-cookie") || "",/HttpOnly; SameSite=Strict/);
    const transferExport = await request("/admin-api/workshops/00000000-0000-4000-8000-000000000001/data-transfer/export",{method:"POST",cookie:principalCookie,body:{passphrase:randomBytes(24).toString("base64url")}});
    assert.equal(transferExport.status,200);
    assert.equal(await transferExport.text(),"00000000-0000-4000-8000-000000000001");
    const approvalSecret = newTotpSecret(), approvalPassword = randomBytes(32).toString("base64url");
    await testPool.query(`INSERT INTO platform_admin.administrators(id,email,display_name,role,permissions,password_hash,totp_secret_ciphertext,active,enrolled)
      VALUES($1,'approver@example.test','Aprovador Fictício','commercial',$2::jsonb,$3,$4,true,true)`,
      ["admin-approver-test",JSON.stringify(["data-transfer:manage","critical:approve"]),hashAdminPassword(approvalPassword),encryptTotpSecret(approvalSecret,key)]);
    const approverLogin=await login("approver@example.test",approvalPassword,approvalSecret);
    assert.equal(approverLogin.status,200);
    const approverCookie=approverLogin.headers.get("set-cookie")?.split(";")[0] || "";
    const requestPath=`/admin-api/workshops/${fakeTenant}/data-transfer/critical-requests`;
    const packageSha=randomBytes(32).toString("hex"), operation=`data_transfer_replace:${fakeTenant}:${packageSha}`;
    await owner.query(`CREATE FUNCTION ${schema}.reject_success_audit() RETURNS trigger LANGUAGE plpgsql AS $audit$
      BEGIN IF NEW.action IN ('admin.data_transfer.replace_requested','admin.data_transfer.replace_approved')
        THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $audit$;
      CREATE TRIGGER reject_success_audit BEFORE INSERT ON ${schema}.audit_events
      FOR EACH ROW EXECUTE FUNCTION ${schema}.reject_success_audit()`);
    const failedRequest=await request(requestPath,{method:"POST",cookie:principalCookie,body:{packageSha256:packageSha}});
    assert.equal(failedRequest.status,400);
    assert.equal((await testPool.query("SELECT count(*)::int AS n FROM platform_admin.critical_operation_requests WHERE operation=$1",[operation])).rows[0].n,0);
    await owner.query(`DROP TRIGGER reject_success_audit ON ${schema}.audit_events`);
    const createdRequest=await request(requestPath,{method:"POST",cookie:principalCookie,body:{packageSha256:packageSha}});
    assert.equal(createdRequest.status,201);
    const criticalRequestId=(await createdRequest.json() as {id:string}).id;
    assert.equal((await testPool.query("SELECT count(*)::int AS n FROM platform_admin.audit_events WHERE action='admin.data_transfer.replace_requested' AND technical_context->>'critical_request_id'=$1",[criticalRequestId])).rows[0].n,1);
    await owner.query(`CREATE TRIGGER reject_success_audit BEFORE INSERT ON ${schema}.audit_events
      FOR EACH ROW EXECUTE FUNCTION ${schema}.reject_success_audit()`);
    const approvePath=`${requestPath}/${criticalRequestId}/approve`;
    const failedApproval=await request(approvePath,{method:"POST",cookie:approverCookie});
    assert.equal(failedApproval.status,400);
    assert.equal((await testPool.query("SELECT status FROM platform_admin.critical_operation_requests WHERE id=$1",[criticalRequestId])).rows[0].status,"requested");
    await owner.query(`DROP TRIGGER reject_success_audit ON ${schema}.audit_events`);
    const approved=await request(approvePath,{method:"POST",cookie:approverCookie});
    assert.equal(approved.status,200);
    assert.equal((await testPool.query("SELECT status FROM platform_admin.critical_operation_requests WHERE id=$1",[criticalRequestId])).rows[0].status,"approved");
    assert.equal((await testPool.query("SELECT count(*)::int AS n FROM platform_admin.audit_events WHERE action='admin.data_transfer.replace_approved' AND technical_context->>'critical_request_id'=$1",[criticalRequestId])).rows[0].n,1);
    const verifyPath="/admin-api/workshops/00000000-0000-4000-8000-000000000001/data-transfer/verify";
    const verifyBody={packageText:"synthetic-package-fake",passphrase:"frase-secreta-ficticia",mode:"empty"};
    const verifySuccess=await request(verifyPath,{method:"POST",cookie:principalCookie,body:verifyBody});
    assert.equal(verifySuccess.status,200);
    assert.equal((await verifySuccess.json() as {overall:string}).overall,"not-verifiable");
    verificationFailure=new TransferVerificationError("invalid_package");
    const invalidVerify=await request(verifyPath,{method:"POST",cookie:principalCookie,body:verifyBody});
    assert.equal(invalidVerify.status,422);
    assert.deepEqual(await invalidVerify.json(),{error:"Pacote inválido ou frase secreta incorreta. Confira o arquivo .hptx e tente novamente.",code:"invalid_package"});
    verificationFailure=new Error("private passphrase and package contents must not be returned");
    const processingVerify=await request(verifyPath,{method:"POST",cookie:principalCookie,body:verifyBody});
    assert.equal(processingVerify.status,500);
    assert.deepEqual(await processingVerify.json(),{error:"Falha ao processar a conferência. Nenhum dado foi alterado; tente novamente mais tarde.",code:"processing_failed"});
    verificationFailure=Object.assign(new Error("database permission details"),{code:"42501"});
    const databaseVerify=await request(verifyPath,{method:"POST",cookie:principalCookie,body:verifyBody});
    assert.equal(databaseVerify.status,503);
    assert.deepEqual(await databaseVerify.json(),{error:"O serviço de dados está indisponível para conferir o pacote agora. Nenhum dado foi alterado.",code:"database_unavailable"});
    verificationFailure=undefined;
    assert.equal((await request("/admin-api/workshops/00000000-0000-4000-8000-000000000099/data-transfer/backups",{cookie:principalCookie})).status,400);
    const principalSession = await request("/admin-api/session",{cookie:principalCookie});
    assert.equal(principalSession.status,200);
    assert.ok(!(await principalSession.text()).includes("password_hash"));
    assert.equal((await request("/admin-api/session",{cookie:"hp_session=fake-operational-session"})).status,401);

    const financeLogin = await login("finance@example.test",financePassword,financeSecret);
    assert.equal(financeLogin.status,200);
    const financeCookie = financeLogin.headers.get("set-cookie")?.split(";")[0] || "";
    assert.equal((await request("/admin-api/administrators",{cookie:financeCookie})).status,200);
    assert.equal((await request("/admin-api/workshops",{cookie:financeCookie})).status,403);
    assert.equal((await request(`/admin-api/workshops/00000000-0000-4000-8000-000000000001/data-transfer/backups`,{cookie:financeCookie})).status,403);
    assert.equal((await request(verifyPath,{method:"POST",cookie:financeCookie,body:verifyBody})).status,403);
    assert.equal((await request("/admin-api/workshops",{method:"POST",cookie:financeCookie,body:{name:"Oficina Fictícia",responsible_name:"Pessoa Fictícia",responsible_email:"oficina@example.test"}})).status,403);
    assert.equal((await request("/admin-api/workshops/00000000-0000-4000-8000-000000000000/status",{method:"PATCH",cookie:financeCookie,body:{status:"blocked",reason:"Justificativa fictícia suficiente"}})).status,403);
    const financeCreate = await request("/admin-api/administrators",{method:"POST",cookie:financeCookie,body:{email:"escalation@example.test",name:"Escalation Fictício",role:"principal",permissions:platformPermissions}});
    assert.equal(financeCreate.status,403);
    const financeElevate = await request("/admin-api/administrators/admin-root-test",{method:"PATCH",cookie:financeCookie,body:{role:"principal",permissions:platformPermissions}});
    assert.equal(financeElevate.status,403);

    const principalDefaultToken = randomBytes(32).toString("hex");
    const defaultPrincipal = await request("/admin-api/administrators",{method:"POST",cookie:principalCookie,body:{email:"principal-default@example.test",name:"Principal sem transferência",role:"principal",permissions:["audit:read"],setup_token:principalDefaultToken}});
    assert.equal(defaultPrincipal.status,201);
    const defaultPrincipalBody = await defaultPrincipal.json() as { administrator:{permissions:string[]} };
    assert.ok(!defaultPrincipalBody.administrator.permissions.includes("data-transfer:manage"));
    const principalTransferToken = randomBytes(32).toString("hex");
    const explicitPrincipal = await request("/admin-api/administrators",{method:"POST",cookie:principalCookie,body:{email:"principal-transfer@example.test",name:"Principal com transferência",role:"principal",permissions:["audit:read","data-transfer:manage"],setup_token:principalTransferToken}});
    assert.equal(explicitPrincipal.status,201);
    const explicitPrincipalBody = await explicitPrincipal.json() as { administrator:{permissions:string[]} };
    assert.ok(explicitPrincipalBody.administrator.permissions.includes("data-transfer:manage"));

    const setupToken = randomBytes(32).toString("hex");
    const createdResponse = await request("/admin-api/administrators",{method:"POST",cookie:principalCookie,body:{email:"support@example.test",name:"Suporte Fictício",role:"technical_support",permissions:["audit:read"],setup_token:setupToken}});
    assert.equal(createdResponse.status,201);
    const created = await createdResponse.json() as { administrator:{id:string} };
    assert.equal(JSON.stringify(created).includes(setupToken),false);
    await assert.rejects(testPool.query(`UPDATE ${schema}.administrators SET active=true WHERE id=$1`,[created.administrator.id]),{code:"23514"});
    assert.equal(JSON.stringify(await (await request("/admin-api/administrators",{cookie:principalCookie})).json()).includes("password_hash"),false);
    const enrollmentPassword = randomBytes(32).toString("base64url");
    const setupSecret = newTotpSecret();
    const start = await request("/admin-api/enroll/start",{method:"POST",body:{token:setupToken,password:enrollmentPassword,secret:setupSecret}});
    assert.equal(start.status,200);
    const setup = await start.json() as {ok:boolean;email:string};
    assert.equal(setup.ok,true); assert.equal(setup.email,"support@example.test");
    assert.equal(JSON.stringify(setup).includes(setupSecret),false);
    const completed = await request("/admin-api/enroll/confirm",{method:"POST",body:{token:setupToken,code:totpCode(setupSecret)}});
    assert.equal(completed.status,200);
    assert.equal((await request("/admin-api/enroll/start",{method:"POST",body:{token:setupToken,password:enrollmentPassword,secret:setupSecret}})).status,400);
    const supportLoginWithoutMfa = await request("/admin-api/login",{method:"POST",body:{email:"support@example.test",password:enrollmentPassword}});
    assert.equal(supportLoginWithoutMfa.status,400);
    const supportLogin = await login("support@example.test",enrollmentPassword,setupSecret);
    assert.equal(supportLogin.status,200);
    const supportCookie = supportLogin.headers.get("set-cookie")?.split(";")[0] || "";
    assert.equal((await request("/admin-api/audit",{cookie:supportCookie})).status,200);

    for(let attempt=1;attempt<=5;attempt++) {
      const response=await login("unknown@example.test",randomBytes(32).toString("base64url"),principalSecret,"111111");
      assert.equal(response.status,attempt===5?429:401);
    }

    const events = await request("/admin-api/audit?limit=200",{cookie:principalCookie});
    assert.equal(events.status,200);
    const audit = await events.json() as Array<{action:string;actor_email:string|null;result:string;technical_context:Record<string,unknown>}>;
    assert.ok(audit.some(event=>event.action==="admin.login.password_failed"));
    assert.ok(audit.some(event=>event.action==="admin.login.mfa_failed"));
    assert.ok(audit.some(event=>event.action==="admin.login.mfa_test_bypass" && event.actor_email===seedCredentials.email));
    assert.ok(audit.some(event=>event.result==="blocked"));
    assert.ok(audit.some(event=>event.action==="admin.account.created"));
    assert.ok(audit.some(event=>event.action==="admin.local_seed.created"));
    assert.ok(audit.some(event=>event.action==="admin.data_transfer.exported" && event.result==="success"));
    assert.ok(audit.every(event=>!JSON.stringify(event).includes(principalPassword) && !JSON.stringify(event).includes(principalSecret) && !JSON.stringify(event).includes(setupSecret) && !JSON.stringify(event).includes(setupToken) && !JSON.stringify(event).includes(seedCredentials.password) && !JSON.stringify(event).includes(seedCredentials.totpSecret)));
    await assert.rejects(testPool.query(`UPDATE ${schema}.audit_events SET result='failure'`),{code:"42501"});

    const disable = await request(`/admin-api/administrators/${created.administrator.id}`,{method:"PATCH",cookie:principalCookie,body:{active:false}});
    assert.equal(disable.status,200);
    assert.equal((await request("/admin-api/session",{cookie:supportCookie})).status,401);
    await assert.rejects(rawPool.query("SELECT id FROM horse_power.tenants"),{code:"42501"});
    await assert.rejects(rawPool.query("SELECT id FROM service_catalog.models"),{code:"42501"});
  } finally {
    if (server) await new Promise<void>(resolve=>server!.close(()=>resolve()));
    for (const key of mfaEnvironmentKeys) {
      const previous = originalMfaEnvironment[key];
      if (previous === undefined) delete process.env[key]; else process.env[key] = previous;
    }
    await rawPool.end();
    await owner.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await owner.end();
  }
});

function encryptTotp(secret: string, key: string) { return encryptTotpSecret(secret, key); }
