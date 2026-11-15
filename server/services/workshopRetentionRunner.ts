import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { DB } from "../db/transactions.js";
import { billingDate } from "../../shared/stripeBilling.js";
import { retentionCoverageEnd, retentionDecision } from "../../shared/workshopRetention.js";
import { configuredPhotoStore } from "./checklistPhotoStorage.js";
import { sendDueWorkshopRetentionNotices } from "./workshopRetentionNotices.js";
import { createVerifiedWorkshopRecoveryBackup, configuredRecoveryStore, purgeDeletedWorkshopPhotos, purgeExpiredWorkshopBackups, readRecoveryBackup, verifyRecoveredWorkshop, type RecoveryManifest, type RecoveryObjectStore } from "./workshopRecoveryStorage.js";

type Due = { tenant_id:string; status:string; email_verified:boolean; managed_billing:boolean;
  paid_until:string|null; due_on:string|null; trial_ends_on:string|null; coverage_end:string; case_status:string;
  backup_manifest:RecoveryManifest|null };

/** Each database retirement is atomic. A failed backup or stale coverage leaves the workshop intact. */
export async function processDueWorkshopRetirements(
  db:DB, pool:Pool, store:RecoveryObjectStore, passphrase:string, now=new Date(), limit=2,
) {
  if (!passphrase || Buffer.byteLength(passphrase)<12 || !Number.isInteger(limit) || limit<1 || limit>10)
    throw new Error("Rotina de retenção não configurada.");
  const today=billingDate(now);
  const due=await pool.query<Due>(`SELECT w.tenant_id,w.status,
    (w.email_verified_at IS NOT NULL) AS email_verified,coalesce(a.managed,false) AS managed_billing,
    a.paid_until::text,a.due_on::text,(w.trial_ends_at AT TIME ZONE 'America/Sao_Paulo')::date::text AS trial_ends_on,
    c.coverage_end::text,c.status AS case_status,c.backup_manifest
    FROM platform_admin.workshop_retention_cases c
    JOIN platform_admin.workshops w ON w.tenant_id=c.tenant_id
    LEFT JOIN platform_admin.stripe_accounts a ON a.tenant_id=w.tenant_id
    JOIN platform_admin.workshop_retention_notices n ON n.tenant_id=c.tenant_id AND n.coverage_end=c.coverage_end
      AND n.days_late=89 AND n.status='sent'
    WHERE c.status NOT IN ('deleted','purged') AND c.coverage_end<=($1::date-90)
      AND (c.processing_until IS NULL OR c.processing_until<now())
    ORDER BY c.coverage_end,c.tenant_id LIMIT 100`,[today]);
  let retired=0,blocked=0,inspected=0;
  for(const row of due.rows){
    if(retired+blocked>=limit)break;
    inspected++;
    const coverage=retentionCoverageEnd({status:row.status,emailVerified:row.email_verified,
      managedBilling:row.managed_billing,paidUntil:row.paid_until,dueOn:row.due_on,trialEndsOn:row.trial_ends_on});
    if(coverage!==row.coverage_end || retentionDecision(row.coverage_end,now)!=='deletion_due')continue;
    const claim=await pool.query(`UPDATE platform_admin.workshop_retention_cases
      SET processing_until=now()+interval '30 minutes',updated_at=now()
      WHERE tenant_id=$1 AND coverage_end=$2::date AND status NOT IN ('deleted','purged')
        AND (processing_until IS NULL OR processing_until<now()) RETURNING status`,[row.tenant_id,row.coverage_end]);
    if(!claim.rowCount)continue;
    let manifest:RecoveryManifest|null=null;
    let uploaded=false;
    try{
      if(row.case_status==='backup_verified' && row.backup_manifest){
        manifest=row.backup_manifest;
        verifyRecoveredWorkshop(manifest,await readRecoveryBackup(store,manifest),passphrase);
      }else{
        const verified=await createVerifiedWorkshopRecoveryBackup(db,store,row.tenant_id,randomUUID(),passphrase);
        manifest=verified.manifest;
        uploaded=true;
        const saved=await pool.query(`UPDATE platform_admin.workshop_retention_cases
          SET status='backup_verified',backup_id=$3,backup_manifest=$4::jsonb,backup_verified_at=now(),updated_at=now()
          WHERE tenant_id=$1 AND coverage_end=$2::date AND status NOT IN ('deleted','purged')
            AND processing_until>now() RETURNING tenant_id`,
          [row.tenant_id,row.coverage_end,manifest.backupId,JSON.stringify(manifest)]);
        if(!saved.rowCount)throw new Error('lease_expired');
      }
      // The SQL function rechecks coverage, notice, backup and Stripe state under locks.
      await pool.query('SELECT platform_admin.retention_delete_workshop($1,$2::date)',[row.tenant_id,row.coverage_end]);
      retired++;
    }catch(error){
      // If the copy was not registered, remove it; registered copies remain for safe retry.
      if(uploaded && manifest){
        const registered=await pool.query<{backup_id:string|null}>(`SELECT backup_id FROM platform_admin.workshop_retention_cases
          WHERE tenant_id=$1 AND coverage_end=$2::date`,[row.tenant_id,row.coverage_end]);
        if(registered.rows[0]?.backup_id!==manifest.backupId)
          await store.remove(manifest.chunks.map(chunk=>chunk.key)).catch(()=>{});
      }
      await pool.query(`UPDATE platform_admin.workshop_retention_cases
        SET processing_until=NULL,status=CASE WHEN status='backup_verified' THEN status ELSE 'blocked' END,updated_at=now()
        WHERE tenant_id=$1 AND coverage_end=$2::date AND status NOT IN ('deleted','purged')`,[row.tenant_id,row.coverage_end]);
      blocked++;
      // Never reveal packet contents, credentials, or customer data in cron output.
      void error;
    }
  }
  return {inspected,retired,blocked};
}

export async function runWorkshopRetentionDaily(db:DB,pool:Pool,passphrase:string,now=new Date(),store=configuredRecoveryStore()){
  const notices=await sendDueWorkshopRetentionNotices(pool,undefined,now);
  const retirements=await processDueWorkshopRetirements(db,pool,store,passphrase,now);
  const photos=configuredPhotoStore();
  const photoCleanup=photos?.remove?await purgeDeletedWorkshopPhotos(pool,photos):{inspected:0,removed:0,remaining:0};
  const expiredBackups=await purgeExpiredWorkshopBackups(pool,store,now);
  return {notices,retirements,photoCleanup,expiredBackups};
}
