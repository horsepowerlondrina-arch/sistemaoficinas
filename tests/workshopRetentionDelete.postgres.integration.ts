import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { adminClient } from "../scripts/local-admin.js";

test("PostgreSQL: encerra uma oficina fictícia com backup e aviso, preservando outra oficina e auditoria", async () => {
  const db = adminClient();
  const tenant = randomUUID(), other = randomUUID();
  const shared = randomUUID(), exclusive = randomUUID(), otherOwner = randomUUID();
  const customer = randomUUID(), otherCustomer = randomUUID(), revision = randomUUID();
  await db.connect();
  try {
    await db.query("BEGIN");
    const coverage = (await db.query("SELECT ((now() AT TIME ZONE 'America/Sao_Paulo')::date-91)::text AS day")).rows[0].day as string;
    await db.query("INSERT INTO horse_power.tenants(id,name,document,email) VALUES($1,'Oficina A','123','a@example.test'),($2,'Oficina B','456','b@example.test')", [tenant, other]);
    await db.query("INSERT INTO horse_power.users(id,name,email,password_hash) VALUES($1,'Pessoa compartilhada',$4,'fake'),($2,'Pessoa exclusiva',$5,'fake'),($3,'Pessoa B',$6,'fake')", [shared,exclusive,otherOwner,`${shared}@example.test`,`${exclusive}@example.test`,`${otherOwner}@example.test`]);
    await db.query(`INSERT INTO platform_admin.workshops(tenant_id,source,name,responsible_name,responsible_email,status,email_verified_at,trial_started_at,trial_ends_at)
      VALUES($1,'admin','Oficina A','Pessoa A','a@example.test','read_only',now(),(($3::date-14)::timestamp AT TIME ZONE 'America/Sao_Paulo'),($3::date::timestamp AT TIME ZONE 'America/Sao_Paulo')),
            ($2,'admin','Oficina B','Pessoa B','b@example.test','active',now(),NULL,NULL)`, [tenant,other,coverage]);
    await db.query("INSERT INTO horse_power.memberships(user_id,tenant_id,role) VALUES($1,$3,'owner'),($2,$3,'operator'),($1,$4,'operator'),($5,$4,'owner')", [shared,exclusive,tenant,other,otherOwner]);
    await db.query("INSERT INTO horse_power.customers(id,tenant_id,name) VALUES($1,$2,'Cliente A'),($3,$4,'Cliente B')", [customer,tenant,otherCustomer,other]);
    await db.query("INSERT INTO horse_power.document_revisions(id,tenant_id,kind,entity_id,revision,issued_at,issued_by,payload,digest) VALUES($1,$2,'order','os-ficticia',1,'2026-01-01',$3,'{}',$4)", [revision,tenant,shared,"a".repeat(64)]);
    const backupId=randomUUID();
    const manifest = { tenantId:tenant, backupId, bytes:100, sha256:"b".repeat(64), chunks:[{key:`${tenant}/${backupId}/0000.hptxpart`,bytes:100,sha256:"c".repeat(64)}] };
    await db.query("INSERT INTO platform_admin.workshop_retention_cases(tenant_id,coverage_end,status,backup_id,backup_manifest,backup_verified_at) VALUES($1,$2,'backup_verified',$3,$4::jsonb,now())", [tenant,coverage,manifest.backupId,JSON.stringify(manifest)]);
    await db.query("SAVEPOINT missing_notice");
    await db.query("SET ROLE hp_platform_admin_app");
    await assert.rejects(db.query("SELECT platform_admin.retention_delete_workshop($1,$2::date)", [tenant,coverage]), /Prazo ou aviso final pendente/);
    await db.query("ROLLBACK TO SAVEPOINT missing_notice");
    const providerId=randomUUID();
    await db.query("INSERT INTO platform_admin.workshop_retention_notices(tenant_id,coverage_end,days_late,status,provider_email_id) VALUES($1,$2,89,'accepted',$3)", [tenant,coverage,providerId]);
    await db.query("SAVEPOINT undelivered_notice");
    await db.query("SET ROLE hp_platform_admin_app");
    await assert.rejects(db.query("SELECT platform_admin.retention_delete_workshop($1,$2::date)", [tenant,coverage]), /Prazo ou aviso final pendente/);
    await db.query("ROLLBACK TO SAVEPOINT undelivered_notice");
    await db.query("UPDATE platform_admin.workshop_retention_notices SET status='sent',sent_at=now()-interval '2 days',provider_delivered_at=now()-interval '2 days' WHERE tenant_id=$1 AND coverage_end=$2", [tenant,coverage]);
    await db.query("SET ROLE hp_platform_admin_app");
    const removed = await db.query("SELECT platform_admin.retention_delete_workshop($1,$2::date) AS result", [tenant,coverage]);
    await db.query("RESET ROLE");
    assert.ok(Number(removed.rows[0].result.rows_removed)>0);
    const rows = await db.query(`SELECT
      (SELECT count(*)::int FROM horse_power.customers WHERE tenant_id=$1) AS removed_customers,
      (SELECT count(*)::int FROM horse_power.document_revisions WHERE tenant_id=$1) AS removed_revisions,
      (SELECT count(*)::int FROM horse_power.memberships WHERE tenant_id=$1) AS removed_memberships,
      (SELECT count(*)::int FROM horse_power.customers WHERE tenant_id=$2) AS preserved_customers,
      (SELECT count(*)::int FROM horse_power.memberships WHERE tenant_id=$2) AS preserved_memberships,
      (SELECT count(*)::int FROM horse_power.users WHERE id=$3) AS preserved_shared_user,
      (SELECT count(*)::int FROM horse_power.users WHERE id=$4) AS removed_exclusive_user,
      (SELECT count(*)::int FROM platform_admin.audit_events WHERE subject_tenant_id=$1 AND action='retention.workshop_deleted') AS audit_count,
      (SELECT status FROM platform_admin.workshop_retention_cases WHERE tenant_id=$1) AS case_status,
      (SELECT status FROM platform_admin.workshops WHERE tenant_id=$1) AS workshop_status,
      (SELECT responsible_email FROM platform_admin.workshops WHERE tenant_id=$1) AS redacted_email`, [tenant,other,shared,exclusive]);
    assert.equal(rows.rows[0].removed_customers,0);
    assert.equal(rows.rows[0].removed_revisions,0);
    assert.equal(rows.rows[0].removed_memberships,0);
    assert.equal(rows.rows[0].preserved_customers,1);
    assert.equal(rows.rows[0].preserved_memberships,2);
    assert.equal(rows.rows[0].preserved_shared_user,1);
    assert.equal(rows.rows[0].removed_exclusive_user,0);
    assert.equal(rows.rows[0].audit_count,1);
    assert.equal(rows.rows[0].case_status,"deleted");
    assert.equal(rows.rows[0].workshop_status,"archived");
    assert.match(rows.rows[0].redacted_email,/^removed\+/);
  } finally {
    await db.query("RESET ROLE").catch(() => {});
    await db.query("ROLLBACK").catch(() => {});
    await db.end();
  }
});
