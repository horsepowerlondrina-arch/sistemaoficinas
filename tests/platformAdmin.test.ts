import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
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
