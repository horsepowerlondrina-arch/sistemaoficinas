import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import type { Pool } from "pg";
import { assertPlatformAdminDatabase } from "../server/platformAdminApp.js";
import { decryptTotpSecret, encryptTotpSecret, hashAdminPassword, newTotpSecret, totpCode, totpUri, verifyAdminPassword, verifyTotp } from "../server/auth/platformAdmin.js";

test("platform administrator passwords and TOTP enrollment use separate secure material", () => {
  const password = randomBytes(32).toString("base64url");
  const hash = hashAdminPassword(password);
  assert.notEqual(hash, password);
  assert.ok(verifyAdminPassword(password, hash));
  assert.equal(verifyAdminPassword(randomBytes(32).toString("base64url"), hash), false);
  assert.equal(verifyAdminPassword(password, "broken"), false);

  const key = "a7".repeat(32), secret = newTotpSecret();
  assert.match(secret, /^[A-Z2-7]{32}$/);
  const encrypted = encryptTotpSecret(secret, key);
  assert.notEqual(encrypted, secret);
  assert.equal(decryptTotpSecret(encrypted, key), secret);
  assert.throws(() => decryptTotpSecret(encrypted, "b8".repeat(32)));
  assert.equal(verifyTotp(secret, totpCode(secret)), true);
  assert.equal(verifyTotp(secret, "000000"), totpCode(secret) === "000000");
  assert.match(totpUri(secret, "admin@example.test"), /^otpauth:\/\/totp\//);
});

test("administrative Preview role stays scoped to the billing branch", async () => {
  const oldEnvironment = process.env.VERCEL_ENV;
  const oldBranch = process.env.VERCEL_GIT_COMMIT_REF;
  const row = {
    role: "hp_billing_preview_admin",
    rolsuper: false,
    rolcreaterole: false,
    rolcreatedb: false,
    rolbypassrls: false,
    admin_schema: true,
    workshop_schema: false,
    catalog_schema: false,
  };
  const pool = { query: async () => ({ rows: [row] }) } as unknown as Pool;
  try {
    process.env.VERCEL_ENV = "preview";
    process.env.VERCEL_GIT_COMMIT_REF = "feat/admin-billing-mercadopago";
    await assert.doesNotReject(assertPlatformAdminDatabase(pool));
    process.env.VERCEL_GIT_COMMIT_REF = "main";
    await assert.rejects(assertPlatformAdminDatabase(pool));
    process.env.VERCEL_ENV = "production";
    process.env.VERCEL_GIT_COMMIT_REF = "feat/admin-billing-mercadopago";
    await assert.rejects(assertPlatformAdminDatabase(pool));
    row.workshop_schema = true;
    process.env.VERCEL_ENV = "preview";
    await assert.rejects(assertPlatformAdminDatabase(pool));
  } finally {
    if (oldEnvironment === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = oldEnvironment;
    if (oldBranch === undefined) delete process.env.VERCEL_GIT_COMMIT_REF;
    else process.env.VERCEL_GIT_COMMIT_REF = oldBranch;
  }
});
