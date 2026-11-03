import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isPlatformAdminAvailable } from "../src/platformAdminAvailability.js";

test("production entry registers the gated admin route and its workshops section", () => {
  const entry = readFileSync(new URL("../src/main.tsx", import.meta.url), "utf8");
  const adminPage = readFileSync(
    new URL("../src/pages/PlatformAdmin.tsx", import.meta.url),
    "utf8",
  );
  assert.match(entry, /isPlatformAdminAvailable/);
  assert.match(entry, /platformAdminAvailable && <Route path="\/admin\/\*"/);
  assert.match(adminPage, /<PlatformWorkshops canManage=\{canManageWorkshops\} canTransfer=\{canTransferWorkshops\} canRequestCritical=\{canRequestCritical\} canApproveCritical=\{canApproveCritical\} environmentLabel=\{environmentLabel\} \/>/);
  assert.match(adminPage, /"data-transfer:manage"/);
});

test("platform admin stays available during local development", () => {
  assert.equal(
    isPlatformAdminAvailable({ development: true, hostname: "localhost" }),
    true,
  );
});

test("production build requires explicit enablement and an allowed host", () => {
  const base = {
    development: false,
    enabled: "true",
    allowedHosts: "sistema-oficinas-homologacao.vercel.app",
  };

  assert.equal(
    isPlatformAdminAvailable({ ...base, hostname: "sistema-oficinas-homologacao.vercel.app" }),
    true,
  );
  assert.equal(
    isPlatformAdminAvailable({ ...base, hostname: "horse-power.vercel.app" }),
    false,
  );
  assert.equal(
    isPlatformAdminAvailable({ ...base, enabled: "false", hostname: "sistema-oficinas-homologacao.vercel.app" }),
    false,
  );
  assert.equal(
    isPlatformAdminAvailable({ development: false, hostname: "sistema-oficinas-homologacao.vercel.app" }),
    false,
  );
});

test("production allowlist matches exact hostnames only", () => {
  assert.equal(
    isPlatformAdminAvailable({
      development: false,
      enabled: "true",
      allowedHosts: "sistema-oficinas-homologacao.vercel.app",
      hostname: "attacker-sistema-oficinas-homologacao.vercel.app",
    }),
    false,
  );
});
