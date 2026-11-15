import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { billingDate } from "../../shared/stripeBilling.js";
import { daysAfterCoverage, retentionCoverageEnd } from "../../shared/workshopRetention.js";
import { sendWorkshopRetentionNotice, type RetentionNotice } from "./workshopRetentionMail.js";

type Candidate = {
  tenant_id: string;
  name: string;
  responsible_email: string;
  status: string;
  email_verified: boolean;
  managed_billing: boolean;
  paid_until: string | null;
  due_on: string | null;
  trial_ends_on: string | null;
};

const dateAfterDays = (date: string, days: number) => {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
};

/** One bounded run. Missing or failed mail never authorizes a workshop deletion. */
export async function sendDueWorkshopRetentionNotices(
  pool: Pool,
  deliver: (notice: RetentionNotice) => Promise<string> = sendWorkshopRetentionNotice,
  now = new Date(),
  limit = 25,
) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("Lote de avisos inválido.");
  const today = billingDate(now);
  let cursor = "", inspected = 0, accepted = 0, failed = 0, blocked = 0;
  while (accepted + failed + blocked < limit) {
    const candidates = await pool.query<Candidate>(`SELECT w.tenant_id,w.name,w.responsible_email,w.status,
      (w.email_verified_at IS NOT NULL) AS email_verified,coalesce(a.managed,false) AS managed_billing,
      a.paid_until::text,a.due_on::text,(w.trial_ends_at AT TIME ZONE 'America/Sao_Paulo')::date::text AS trial_ends_on
      FROM platform_admin.workshops w LEFT JOIN platform_admin.stripe_accounts a ON a.tenant_id=w.tenant_id
      WHERE w.tenant_id>$1 AND w.status IN ('active','trial','read_only')
        AND (a.managed OR (w.status IN ('trial','read_only') AND w.trial_ends_at IS NOT NULL))
      ORDER BY w.tenant_id LIMIT 100`, [cursor]);
    if (!candidates.rows.length) break;
    for (const row of candidates.rows) {
      cursor = row.tenant_id; inspected++;
      const coverage = retentionCoverageEnd({ status: row.status, emailVerified: row.email_verified,
        managedBilling: row.managed_billing, paidUntil: row.paid_until, dueOn: row.due_on, trialEndsOn: row.trial_ends_on });
      if (!coverage || coverage >= today) continue;
      const late=daysAfterCoverage(coverage,now);
      const day=late>=89?89:late>=60?60:late>=30?30:null;
      if(!day)continue;
      const activeCase = await pool.query(`INSERT INTO platform_admin.workshop_retention_cases(tenant_id,coverage_end)
        VALUES($1,$2::date)
        ON CONFLICT(tenant_id,coverage_end) DO UPDATE SET updated_at=platform_admin.workshop_retention_cases.updated_at
        WHERE platform_admin.workshop_retention_cases.status NOT IN ('deleted','purged')
        RETURNING status`, [row.tenant_id, coverage]);
      if (!activeCase.rowCount) { blocked++; continue; }
      const claimed = await pool.query(`INSERT INTO platform_admin.workshop_retention_notices(tenant_id,coverage_end,days_late,status)
      VALUES($1,$2::date,$3,'reserved')
      ON CONFLICT (tenant_id,coverage_end,days_late) DO UPDATE SET
        status='reserved',reserved_at=now(),sent_at=NULL,provider_email_id=NULL,provider_delivered_at=NULL,last_error_code=NULL
      WHERE (platform_admin.workshop_retention_notices.status='failed'
        AND platform_admin.workshop_retention_notices.reserved_at<now()-interval '1 hour')
        OR (platform_admin.workshop_retention_notices.status='sent'
        AND platform_admin.workshop_retention_notices.provider_delivered_at IS NULL)
        OR (platform_admin.workshop_retention_notices.status='reserved'
        AND platform_admin.workshop_retention_notices.reserved_at<now()-interval '1 hour')
      RETURNING status`, [row.tenant_id, coverage, day]);
      if (!claimed.rowCount) { blocked++; continue; }
      try {
        // Recheck the effective coverage immediately before the external request.
        const current = await pool.query<Candidate>(`SELECT w.tenant_id,w.name,w.responsible_email,w.status,
          (w.email_verified_at IS NOT NULL) AS email_verified,coalesce(a.managed,false) AS managed_billing,
          a.paid_until::text,a.due_on::text,(w.trial_ends_at AT TIME ZONE 'America/Sao_Paulo')::date::text AS trial_ends_on
          FROM platform_admin.workshops w LEFT JOIN platform_admin.stripe_accounts a ON a.tenant_id=w.tenant_id
          WHERE w.tenant_id=$1`, [row.tenant_id]);
        const fresh = current.rows[0];
        if (!fresh || retentionCoverageEnd({ status:fresh.status,emailVerified:fresh.email_verified,
          managedBilling:fresh.managed_billing,paidUntil:fresh.paid_until,dueOn:fresh.due_on,trialEndsOn:fresh.trial_ends_on }) !== coverage)
          throw new Error("coverage_changed");
        const providerId = await deliver({ tenantId: row.tenant_id, workshopName: fresh.name, email: fresh.responsible_email,
          coverageEnd: coverage, removalDate: dateAfterDays(coverage, 90), daysLate: day });
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(providerId)) throw new Error("invalid_provider_id");
        await pool.query(`UPDATE platform_admin.workshop_retention_notices
          SET status='accepted',provider_email_id=$4,last_error_code=NULL
          WHERE tenant_id=$1 AND coverage_end=$2::date AND days_late=$3 AND status='reserved'`,
          [row.tenant_id,coverage,day,providerId]);
        accepted++;
      } catch (error) {
        await pool.query("UPDATE platform_admin.workshop_retention_notices SET status='failed',last_error_code=$4 WHERE tenant_id=$1 AND coverage_end=$2 AND days_late=$3 AND status='reserved'", [row.tenant_id, coverage, day, error instanceof Error && error.message === "coverage_changed" ? "coverage_changed" : "delivery_unconfirmed"]);
        failed++;
      }
      if (accepted + failed + blocked >= limit) break;
    }
    if (candidates.rows.length < 100) break;
  }
  return { inspected, accepted, failed, blocked };
}

/** A signed Resend event is the only path that confirms delivery. */
export async function recordWorkshopRetentionDelivery(pool: Pool, providerId: string, event: "delivered" | "failed") {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(providerId))
    throw new Error("Identificador do aviso inválido.");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const updated = await client.query<{tenant_id:string;coverage_end:string;days_late:number}>(`
      UPDATE platform_admin.workshop_retention_notices SET
        status=CASE WHEN $2='delivered' THEN 'sent' ELSE 'failed' END,
        sent_at=CASE WHEN $2='delivered' THEN now() ELSE NULL END,
        provider_delivered_at=CASE WHEN $2='delivered' THEN now() ELSE NULL END,
        last_error_code=CASE WHEN $2='delivered' THEN NULL ELSE 'provider_failed' END,
        reserved_at=CASE WHEN $2='failed' THEN now() ELSE reserved_at END
      WHERE provider_email_id=$1 AND status='accepted'
      RETURNING tenant_id,coverage_end::text,days_late`, [providerId,event]);
    for (const row of updated.rows) {
      if (event === "delivered") await client.query(`UPDATE platform_admin.workshop_retention_cases SET status=$3,updated_at=now()
        WHERE tenant_id=$1 AND coverage_end=$2::date AND status NOT IN ('deleted','purged')`,
        [row.tenant_id,row.coverage_end,`notice_${row.days_late}`]);
      await client.query(`INSERT INTO platform_admin.audit_events(id,actor_email,subject_tenant_id,action,result,technical_context)
        VALUES($1,'retention',$2,$3,'success',$4::jsonb)`,
        [randomUUID(),row.tenant_id,event === "delivered" ? "retention.notice_delivered" : "retention.notice_failed",
          JSON.stringify({days_late:row.days_late,coverage_end:row.coverage_end})]);
    }
    await client.query("COMMIT");
    return updated.rowCount ?? 0;
  } catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }
  finally { client.release(); }
}
