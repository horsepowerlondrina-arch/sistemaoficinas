import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { adminClient } from "../scripts/local-admin.js";
import { localDatabaseUrl, platformAdminDatabaseUrl } from "../server/localConfig.js";
import { recordWorkshopRetentionDelivery, sendDueWorkshopRetentionNotices } from "../server/services/workshopRetentionNotices.js";
import { createLocalDatabase } from "../server/db/local.js";
import { createVerifiedWorkshopRecoveryBackup, purgeDeletedWorkshopPhotos, purgeExpiredWorkshopBackups, purgeSupersededWorkshopBackups, type RecoveryObjectStore } from "../server/services/workshopRecoveryStorage.js";
import { processDueWorkshopRetirements } from "../server/services/workshopRetentionRunner.js";

test("PostgreSQL: retenção fica privada, exige backup verificado e preserva aviso único", async () => {
  const root = adminClient();
  const admin = new pg.Client({ connectionString: platformAdminDatabaseUrl(process.env.PLATFORM_ADMIN_DATABASE_URL), ssl: false });
  const pool = new pg.Pool({ connectionString: platformAdminDatabaseUrl(process.env.PLATFORM_ADMIN_DATABASE_URL), ssl: false });
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
    await admin.query("UPDATE platform_admin.workshop_retention_notices SET status='sent',sent_at=now(),provider_email_id=$3,provider_delivered_at=now() WHERE tenant_id=$1 AND coverage_end=$2 AND days_late=89", [tenant, coverage, randomUUID()]);
    const key = `${tenant}/${backup}/0000.hptxpart`;
    const manifest = { tenantId: tenant, backupId: backup, bytes: 10, sha256: "a".repeat(64), chunks: [{ key, bytes: 10, sha256: "b".repeat(64) }] };
    await admin.query("UPDATE platform_admin.workshop_retention_cases SET status='backup_verified',backup_id=$3,backup_manifest=$4::jsonb,backup_verified_at=now() WHERE tenant_id=$1 AND coverage_end=$2", [tenant, coverage, backup, JSON.stringify(manifest)]);
    const photoKey = `${tenant}/${randomUUID()}`;
    await admin.query("UPDATE platform_admin.workshop_retention_cases SET status='deleted',deleted_at=now(),recovery_expires_at=now()+interval '15 days',photo_object_keys=$3::jsonb WHERE tenant_id=$1 AND coverage_end=$2", [tenant, coverage, JSON.stringify([photoKey])]);
    const row = await admin.query("SELECT status,backup_manifest->>'tenantId' AS backup_tenant FROM platform_admin.workshop_retention_cases WHERE tenant_id=$1", [tenant]);
    assert.equal(row.rows[0].status, "deleted");
    assert.equal(row.rows[0].backup_tenant, tenant);
    assert.equal((await admin.query("SELECT count(*)::int AS n FROM platform_admin.workshop_retention_cases WHERE tenant_id=$1", [other])).rows[0].n, 0);
    const removedPhotos: string[] = [];
    assert.deepEqual(await purgeDeletedWorkshopPhotos(pool, { async put() {}, async get() { throw new Error("unused"); }, async remove(keys) { removedPhotos.push(...keys); } }), { inspected: 1, removed: 1, remaining: 0 });
    assert.deepEqual(removedPhotos, [photoKey]);
    assert.equal((await admin.query("SELECT photo_objects_purged_at IS NOT NULL AS done FROM platform_admin.workshop_retention_cases WHERE tenant_id=$1", [tenant])).rows[0].done, true);
    const removed: string[] = [];
    const store: RecoveryObjectStore = { async put() {}, async get() { throw new Error("Não é necessário ler cópia expirada."); }, async remove(keys) { removed.push(...keys); } };
    const result = await purgeExpiredWorkshopBackups(pool, store, new Date(Date.now() + 16 * 86400000));
    assert.equal(result.purged, 1);
    assert.deepEqual(removed, [key]);
    assert.equal((await admin.query("SELECT backup_manifest FROM platform_admin.workshop_retention_cases WHERE tenant_id=$1", [tenant])).rows[0].backup_manifest, null);
  } finally {
    await root.query("DELETE FROM platform_admin.workshop_retention_notices WHERE tenant_id=$1", [tenant]);
    await root.query("DELETE FROM platform_admin.workshop_retention_cases WHERE tenant_id=$1", [tenant]);
    await root.query("DELETE FROM horse_power.tenants WHERE id=ANY($1::text[])", [[tenant, other]]);
    await workshop.end(); await admin.end(); await pool.end(); await root.end();
  }
});

test("PostgreSQL: pacote recuperado inclui só os registros da oficina fictícia selecionada", async () => {
  const root = adminClient();
  const db = await createLocalDatabase();
  const tenant = randomUUID(), other = randomUUID(), customer = randomUUID(), otherCustomer = randomUUID();
  const objects = new Map<string, Buffer>();
  const store: RecoveryObjectStore = {
    async put(key, content) { objects.set(key, Buffer.from(content)); },
    async get(key) { const content = objects.get(key); if (!content) throw new Error("Parte ausente."); return Buffer.from(content); },
    async remove(keys) { for (const key of keys) objects.delete(key); },
  };
  await root.connect();
  try {
    await root.query("INSERT INTO horse_power.tenants(id,name) VALUES($1,'Oficina Backup A'),($2,'Oficina Backup B')", [tenant, other]);
    await root.query("INSERT INTO horse_power.customers(id,tenant_id,name) VALUES($1,$2,'Cliente Teste A'),($3,$4,'Cliente Teste B')", [customer, tenant, otherCustomer, other]);
    const result = await createVerifiedWorkshopRecoveryBackup(db, store, tenant, randomUUID(), "frase ficticia longa para backup",
      {workshop_user_access:[],staff_accounts:[],order_assignments:[],discount_requests:[],support_tickets:[],support_messages:[],memberships:[],users:[]});
    assert.equal(result.inventory.entities.customers?.count, 1);
    assert.equal(result.inventory.supplementalCounts.order_assignments,0);
    assert.equal(result.inventory.supplementalCounts.discount_requests,0);
    assert.equal(result.manifest.tenantId, tenant);
    assert.ok(result.manifest.chunks.length >= 1);
    assert.ok([...objects.keys()].every(key => key.startsWith(`${tenant}/`)));
  } finally {
    await root.query("DELETE FROM horse_power.customers WHERE tenant_id=ANY($1::text[])", [[tenant, other]]);
    await root.query("DELETE FROM horse_power.tenants WHERE id=ANY($1::text[])", [[tenant, other]]);
    await db.close(); await root.end();
  }
});

test("PostgreSQL: aviso do dia 89 é único e não atinge oficina com liberação administrativa", async () => {
  const root = adminClient();
  const pool = new pg.Pool({ connectionString: platformAdminDatabaseUrl(process.env.PLATFORM_ADMIN_DATABASE_URL), ssl: false });
  await root.connect();
  const trial = randomUUID(), granted = randomUUID(), sent: string[] = [];
  try {
    await root.query("INSERT INTO horse_power.tenants(id,name) VALUES($1,'Teste retenção'),($2,'Acesso administrativo')", [trial, granted]);
    await root.query(`INSERT INTO platform_admin.workshops(tenant_id,source,name,responsible_name,responsible_email,status,email_verified_at,trial_started_at,trial_ends_at)
      VALUES($1,'admin','Teste retenção','Pessoa fictícia',$3,'trial',now(),'2026-08-04T12:00:00Z','2026-08-18T12:00:00Z'),
            ($2,'admin','Acesso administrativo','Pessoa fictícia',$4,'active',now(),NULL,NULL)`,
      [trial, granted, `${trial}@example.test`, `${granted}@example.test`]);
    const now = new Date("2026-11-15T15:00:00Z");
    const providerId = randomUUID();
    const deliver = async (notice: { tenantId: string; daysLate: number }) => { sent.push(`${notice.tenantId}:${notice.daysLate}`); return providerId; };
    const first = await sendDueWorkshopRetentionNotices(pool, deliver, now);
    const second = await sendDueWorkshopRetentionNotices(pool, deliver, now);
    assert.equal(first.accepted, 1);
    assert.equal(second.accepted, 0);
    assert.equal(await recordWorkshopRetentionDelivery(pool,providerId,"delivered"),1);
    assert.equal(await recordWorkshopRetentionDelivery(pool,providerId,"delivered"),0);
    assert.deepEqual(sent, [`${trial}:89`]);
    const rows = await pool.query("SELECT status,sent_at IS NOT NULL AS sent,provider_delivered_at IS NOT NULL AS delivered FROM platform_admin.workshop_retention_notices WHERE tenant_id=$1", [trial]);
    assert.equal(rows.rows[0].status, "sent");
    assert.equal(rows.rows[0].sent, true);
    assert.equal(rows.rows[0].delivered, true);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM platform_admin.workshop_retention_notices WHERE tenant_id=$1", [granted])).rows[0].n, 0);
  } finally {
    await root.query("DELETE FROM platform_admin.workshop_retention_notices WHERE tenant_id=ANY($1::text[])", [[trial, granted]]);
    await root.query("DELETE FROM platform_admin.workshop_retention_cases WHERE tenant_id=ANY($1::text[])", [[trial, granted]]);
    await root.query("DELETE FROM platform_admin.workshops WHERE tenant_id=ANY($1::text[])", [[trial, granted]]);
    await root.query("DELETE FROM horse_power.tenants WHERE id=ANY($1::text[])", [[trial, granted]]);
    await pool.end(); await root.end();
  }
});

test("PostgreSQL: rotina só exclui oficina fictícia após aviso final e cópia verificada", async()=>{
  const root=adminClient();
  const db=await createLocalDatabase();
  const pool=new pg.Pool({connectionString:platformAdminDatabaseUrl(process.env.PLATFORM_ADMIN_DATABASE_URL),ssl:false});
  const tenant=randomUUID(),other=randomUUID(),customer=randomUUID(),otherCustomer=randomUUID();
  const objects=new Map<string,Buffer>();
  const store:RecoveryObjectStore={
    async put(key,data){objects.set(key,Buffer.from(data));},
    async get(key){const data=objects.get(key);if(!data)throw new Error('missing');return Buffer.from(data);},
    async remove(keys){for(const key of keys)objects.delete(key);},
  };
  await root.connect();
  try{
    const coverage=(await root.query("SELECT ((now() AT TIME ZONE 'America/Sao_Paulo')::date-91)::text AS day")).rows[0].day as string;
    await root.query("INSERT INTO horse_power.tenants(id,name) VALUES($1,'Oficina Retirada'),($2,'Oficina Protegida')",[tenant,other]);
    await root.query("INSERT INTO horse_power.customers(id,tenant_id,name) VALUES($1,$2,'Cliente Fictício'),($3,$4,'Outro Cliente')",[customer,tenant,otherCustomer,other]);
    await root.query(`INSERT INTO platform_admin.workshops(tenant_id,source,name,responsible_name,responsible_email,status,email_verified_at,trial_started_at,trial_ends_at)
      VALUES($1,'admin','Oficina Retirada','Pessoa Fictícia',$4,'read_only',now(),(($3::date-14)::timestamp AT TIME ZONE 'America/Sao_Paulo'),($3::date::timestamp AT TIME ZONE 'America/Sao_Paulo')),
            ($2,'admin','Oficina Protegida','Outra Pessoa',$5,'active',now(),NULL,NULL)`,[tenant,other,coverage,`${tenant}@example.test`,`${other}@example.test`]);
    await root.query('INSERT INTO platform_admin.workshop_retention_cases(tenant_id,coverage_end) VALUES($1,$2)',[tenant,coverage]);
    assert.equal((await processDueWorkshopRetirements(db,pool,store,'frase ficticia longa')).retired,0);
    assert.equal((await root.query('SELECT count(*)::int AS n FROM horse_power.customers WHERE tenant_id=$1',[tenant])).rows[0].n,1);
    await root.query("INSERT INTO platform_admin.workshop_retention_notices(tenant_id,coverage_end,days_late,status,sent_at,provider_email_id,provider_delivered_at) VALUES($1,$2,89,'sent',now()-interval '2 days',$3,now()-interval '2 days')",[tenant,coverage,randomUUID()]);
    const done=await processDueWorkshopRetirements(db,pool,store,'frase ficticia longa');
    assert.deepEqual({retired:done.retired,blocked:done.blocked},{retired:1,blocked:0});
    assert.equal((await root.query('SELECT count(*)::int AS n FROM horse_power.customers WHERE tenant_id=$1',[tenant])).rows[0].n,0);
    assert.equal((await root.query('SELECT count(*)::int AS n FROM horse_power.customers WHERE tenant_id=$1',[other])).rows[0].n,1);
    assert.equal((await root.query('SELECT status,backup_verified_at IS NOT NULL AS verified FROM platform_admin.workshop_retention_cases WHERE tenant_id=$1',[tenant])).rows[0].status,'deleted');
    assert.ok(objects.size>0);
  }finally{
    await root.query("DELETE FROM platform_admin.workshop_retention_notices WHERE tenant_id=ANY($1::text[])", [[tenant,other]]);
    await root.query("DELETE FROM platform_admin.workshop_retention_cases WHERE tenant_id=ANY($1::text[])", [[tenant,other]]);
    await root.query("DELETE FROM platform_admin.workshops WHERE tenant_id=ANY($1::text[])", [[tenant,other]]);
    await root.query("DELETE FROM horse_power.customers WHERE tenant_id=ANY($1::text[])", [[tenant,other]]);
    await root.query("DELETE FROM horse_power.tenants WHERE id=ANY($1::text[])", [[tenant,other]]);
    await db.close();await pool.end();await root.end();
  }
});

test('PostgreSQL: pagamento posterior descarta a cópia antiga sem excluir dados',async()=>{
  const root=adminClient();
  const pool=new pg.Pool({connectionString:platformAdminDatabaseUrl(process.env.PLATFORM_ADMIN_DATABASE_URL),ssl:false});
  const tenant=randomUUID(),backupId=randomUUID(),coverage='2026-01-01';
  await root.connect();
  try{
    await root.query("INSERT INTO horse_power.tenants(id,name) VALUES($1,'Oficina renovada')",[tenant]);
    await root.query(`INSERT INTO platform_admin.workshops(tenant_id,source,name,responsible_name,responsible_email,status,email_verified_at,trial_started_at,trial_ends_at)
      VALUES($1,'admin','Oficina renovada','Pessoa Fictícia',$2,'trial',now(),'2026-01-01','2026-01-15')`,[tenant,`${tenant}@example.test`]);
    const key=`${tenant}/${backupId}/0000.hptxpart`;
    const manifest={tenantId:tenant,backupId,bytes:10,sha256:'a'.repeat(64),chunks:[{key,bytes:10,sha256:'b'.repeat(64)}]};
    await root.query(`INSERT INTO platform_admin.workshop_retention_cases(tenant_id,coverage_end,status,backup_id,backup_manifest,backup_verified_at)
      VALUES($1,$2,'backup_verified',$3,$4::jsonb,now())`,[tenant,coverage,backupId,JSON.stringify(manifest)]);
    const removed:string[]=[];
    const store:RecoveryObjectStore={async put(){},async get(){throw new Error('unused');},async remove(keys){removed.push(...keys);}};
    assert.equal((await purgeSupersededWorkshopBackups(pool,store)).purged,1);
    assert.deepEqual(removed,[key]);
    const state=await root.query('SELECT status,backup_manifest FROM platform_admin.workshop_retention_cases WHERE tenant_id=$1',[tenant]);
    assert.equal(state.rows[0].status,'blocked');
    assert.equal(state.rows[0].backup_manifest,null);
    assert.equal((await root.query('SELECT count(*)::int AS n FROM horse_power.tenants WHERE id=$1',[tenant])).rows[0].n,1);
  }finally{await root.query('DELETE FROM platform_admin.workshop_retention_cases WHERE tenant_id=$1',[tenant]).catch(()=>{});await root.query('DELETE FROM platform_admin.workshops WHERE tenant_id=$1',[tenant]).catch(()=>{});await root.query('DELETE FROM horse_power.tenants WHERE id=$1',[tenant]).catch(()=>{});await pool.end();await root.end();}
});
