import test from "node:test";
import assert from "node:assert/strict";
import type { DB } from "../server/db/database.js";
import type { Context } from "../server/auth/session.js";
import { catalogAccessState, withCatalog } from "../server/services/repairCatalog.js";

function context(tenantId: string, enabled?: boolean): Context {
  return {
    tenantId,
    userId: "user-" + tenantId,
    role: "owner",
    modules: enabled === undefined ? {} : { technical_catalog: enabled },
  };
}

function catalogDb() {
  const reads: string[] = [];
  const db = {
    prepare: () => ({
      get: async (tenantId: string) => {
        reads.push(tenantId);
        return { enabled: true, valid_until: null, catalog_installed: true };
      },
      all: async () => [],
      run: async () => ({ changes: 0 }),
    }),
    withTenantRead: async (_tenantId: string, callback: () => Promise<unknown>) => callback(),
  } as unknown as DB;
  return { db, reads };
}

test("Catálogo Técnico respeita o bloqueio administrativo no backend", async () => {
  const { db, reads } = catalogDb();
  const ctx = context("tenant-a", false);

  assert.equal(await catalogAccessState(db, ctx), "administratively_disabled");
  assert.deepEqual(reads, [], "não consulta os dados centrais quando a permissão da oficina está bloqueada");

  let called = false;
  await assert.rejects(
    withCatalog(db, ctx, async () => { called = true; return "catálogo fictício"; }),
    (error: unknown) => (error as { status?: number }).status === 403,
  );
  assert.equal(called, false);
});

test("o bloqueio do Catálogo Técnico é isolado por oficina e a liberação preserva a regra comercial atual", async () => {
  const { db, reads } = catalogDb();
  const blocked = context("tenant-a", false);
  const enabled = context("tenant-b", true);

  assert.equal(await catalogAccessState(db, blocked), "administratively_disabled");
  assert.equal(await catalogAccessState(db, enabled), "active");
  assert.deepEqual(reads, ["tenant-b"]);

  const unconfiguredLicense = {
    prepare: () => ({
      get: async () => ({ enabled: false, valid_until: null, catalog_installed: true }),
    }),
  } as unknown as DB;
  assert.equal(
    await catalogAccessState(unconfiguredLicense, enabled),
    "revoked",
    "a permissão administrativa não ignora a regra de contratação existente",
  );
});

test("Premium e teste ativo incluem Catálogo Técnico mesmo com licença legada revogada", async () => {
  const ctx = context("tenant-premium", true);
  const makeDb = (access: { enabled: boolean; valid_until: string | null; catalog_installed: boolean } | undefined, included: boolean) => ({
    getTenantCatalogIncluded: async (tenant: string) => {
      assert.equal(tenant, ctx.tenantId);
      return included;
    },
    prepare: (sql: string) => ({
      get: async () => sql.includes("FROM service_catalog.tenant_access")
        ? access
        : { catalog_installed: true },
    }),
  }) as unknown as DB;
  assert.equal(await catalogAccessState(makeDb(undefined, true), ctx), "active");
  assert.equal(await catalogAccessState(makeDb(undefined, false), ctx), "not_contracted");
  assert.equal(await catalogAccessState(makeDb({ enabled: true, valid_until: "2020-01-01T00:00:00Z", catalog_installed: true }, true), ctx), "active");
  assert.equal(await catalogAccessState(makeDb({ enabled: false, valid_until: null, catalog_installed: true }, true), ctx), "active");
  assert.equal(await catalogAccessState(makeDb({ enabled: false, valid_until: null, catalog_installed: true }, false), ctx), "revoked");
});
