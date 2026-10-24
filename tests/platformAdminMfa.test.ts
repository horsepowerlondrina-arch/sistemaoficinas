import assert from "node:assert/strict";
import test from "node:test";
import { isTestAdminPasswordOnlyLoginAllowed } from "../server/platformAdminMfa.js";

const productionHomologation = {
  VERCEL: "1",
  VERCEL_ENV: "production",
  PLATFORM_ADMIN_TEST_MFA_BYPASS_EMAIL: "admin@plataforma.local",
  PLATFORM_ADMIN_TEST_MFA_BYPASS_HOST: "sistema-oficinas-homologacao.vercel.app",
};

test("password-only login is limited to the fictitious account on homologation production", () => {
  assert.equal(isTestAdminPasswordOnlyLoginAllowed("ADMIN@PLATAFORMA.LOCAL", "SISTEMA-OFICINAS-HOMOLOGACAO.VERCEL.APP", productionHomologation), true);
  assert.equal(isTestAdminPasswordOnlyLoginAllowed("other@example.test", "sistema-oficinas-homologacao.vercel.app", productionHomologation), false);
  assert.equal(isTestAdminPasswordOnlyLoginAllowed("admin@plataforma.local", "preview.vercel.app", productionHomologation), false);
  assert.equal(isTestAdminPasswordOnlyLoginAllowed("admin@plataforma.local", "sistema-oficinas-homologacao.vercel.app", { ...productionHomologation, VERCEL_ENV: "preview" }), false);
  assert.equal(isTestAdminPasswordOnlyLoginAllowed("admin@plataforma.local", "sistema-oficinas-homologacao.vercel.app", { ...productionHomologation, VERCEL: undefined }), false);
  assert.equal(isTestAdminPasswordOnlyLoginAllowed("admin@plataforma.local", "sistema-oficinas-homologacao.vercel.app", { VERCEL: "1", VERCEL_ENV: "production" }), false);
});
