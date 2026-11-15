import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { adminClient } from "../scripts/local-admin.js";
import { localDatabaseUrl, platformAdminDatabaseUrl } from "../server/localConfig.js";

test("PostgreSQL: retenção fica privada, exige backup verificado e preserva aviso único", async () => {
  const root = adminClient();
  const admin = new pg.Client({ connectionString: platformAdminDatabaseUrl(process.env.PLATFORM_ADMIN_DATABASE_URL), ssl: false });
  const workshop = new pg.Client({ connectionString: localDatabaseUrl(process.env.LOCAL_DATABASE_URL), ssl: false });
  await root.connect(); await admin.connect(); await workshop.connect();
  const tenant = randomUUID(), other = randomUUID(), backup = randomUUID(), coverage = "2026-01-01";
  try {
    await root.query("INSERT INTO horse_power.tenants(id,name) VALUES($1,'Oficina Retenção A'),($2,'Oficina Retenção B')", [tenant, other]);
    await admin.query("INSERT INTO platform_admin.workshop_retention_cases(tenant_id,coverage_end) VALUES($1,$2)", [tenant, coverage]);
    await assert.rejects(workshop.query("SELECT * FROM platform_admin.workshop_retention_cases"), /permission denied/);
    await assert.rejects(admin.query("UPDATE platform_admin.workshop_retention_cases SET status='deleted' WHERE tenant_id=$1", [tenant]), /check constraint/);
    await admin.query("INSERT INTO platform_admin.workshop_retention_notices(tenant_id,coverage_end,days_late,status) VALUES($1,$2,89,'reserved')", [tenant, coverage]);
    await assert.rejects(admin.query("INSERT INTO platform_admin.workshop_retention_notices(tenant_id,coverage_end,days_late,status) VALUES($1,$2,89,'reserved')", [tenant, coverage]), /duplicate key/);
    await admin.query("UPDATE platform_admin.workshop_retention_notices SET status='sent',sent_at=now() WHERE tenant_id=$1 AND coverage_end=$2 AND days_late=89", [tenant, coverage]);
    const manifest = { tenantId: tenant, backupId: backup, bytes: 10, sha256: "a".repeat(64), chunks: [] };
    await admin.query("UPDATE platform_admin.workshop_retention_cases SET status='backup_verified',backup_id=$3,backup_manifest=$4::jsonb,backup_verified_at=now() WHERE tenant_id=$1 AND coverage_end=$2", [tenant, coverage, backup, JSON.stringify(manifest)]);
    await admin.query("UPDATE platform_admin.workshop_retention_cases SET status='deleted',deleted_at=now(),recovery_expires_at=now()+interval '15 days' WHERE tenant_id=$1 AND coverage_end=$2", [tenant, coverage]);
    const row = await admin.query("SELECT status,backup_manifest->>'tenantId' AS backup_tenant FROM platform_admin.workshop_retention_cases WHERE tenant_id=$1", [tenant]);
    assert.equal(row.rows[0].status, "deleted");
    assert.equal(row.rows[0].backup_tenant, tenant);
    assert.equal((await admin.query("SELECT count(*)::int AS n FROM platform_admin.workshop_retention_cases WHERE tenant_id=$1", [other])).rows[0].n, 0);
    await admin.query("UPDATE platform_admin.workshop_retention_cases SET status='purged',backup_id=NULL,backup_manifest=NULL,backup_verified_at=NULL WHERE tenant_id=$1 AND coverage_end=$2", [tenant, coverage]);
    assert.equal((await admin.query("SELECT backup_manifest FROM platform_admin.workshop_retention_cases WHERE tenant_id=$1", [tenant])).rows[0].backup_manifest, null);
  } finally {
    await root.query("DELETE FROM platform_admin.workshop_retention_notices WHERE tenant_id=$1", [tenant]);
    await root.query("DELETE FROM platform_admin.workshop_retention_cases WHERE tenant_id=$1", [tenant]);
    await root.query("DELETE FROM horse_power.tenants WHERE id=ANY($1::text[])", [[tenant, other]]);
    await workshop.end(); await admin.end(); await root.end();
  }
});
