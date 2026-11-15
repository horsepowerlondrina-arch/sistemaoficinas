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
  deliver: (notice: RetentionNotice) => Promise<unknown> = sendWorkshopRetentionNotice,
  now = new Date(),
  limit = 25,
) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("Lote de avisos inválido.");
  const today = billingDate(now);
  let cursor = "", inspected = 0, sent = 0, failed = 0, blocked = 0;
  while (sent + failed + blocked < limit) {
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
      const decision=`notice_${day}`;
      const activeCase = await pool.query(`INSERT INTO platform_admin.workshop_retention_cases(tenant_id,coverage_end)
        VALUES($1,$2::date)
        ON CONFLICT(tenant_id,coverage_end) DO UPDATE SET updated_at=platform_admin.workshop_retention_cases.updated_at
        WHERE platform_admin.workshop_retention_cases.status NOT IN ('deleted','purged')
        RETURNING status`, [row.tenant_id, coverage]);
      if (!activeCase.rowCount) { blocked++; continue; }
      const claimed = await pool.query(`INSERT INTO platform_admin.workshop_retention_notices(tenant_id,coverage_end,days_late,status)
      VALUES($1,$2::date,$3,'reserved')
      ON CONFLICT (tenant_id,coverage_end,days_late) DO UPDATE SET status='reserved',reserved_at=now(),last_error_code=NULL
      WHERE platform_admin.workshop_retention_notices.status='failed'
        AND platform_admin.workshop_retention_notices.reserved_at<now()-interval '1 hour'
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
        await deliver({ tenantId: row.tenant_id, workshopName: fresh.name, email: fresh.responsible_email,
          coverageEnd: coverage, removalDate: dateAfterDays(coverage, 90), daysLate: day });
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          await client.query("UPDATE platform_admin.workshop_retention_notices SET status='sent',sent_at=now(),last_error_code=NULL WHERE tenant_id=$1 AND coverage_end=$2 AND days_late=$3 AND status='reserved'", [row.tenant_id, coverage, day]);
          await client.query("UPDATE platform_admin.workshop_retention_cases SET status=$3,updated_at=now() WHERE tenant_id=$1 AND coverage_end=$2 AND status NOT IN ('deleted','purged')", [row.tenant_id, coverage, decision]);
          await client.query("INSERT INTO platform_admin.audit_events(id,actor_email,subject_tenant_id,action,result,technical_context) VALUES($1,'retention',$2,'retention.notice_sent','success',$3::jsonb)", [randomUUID(), row.tenant_id, JSON.stringify({ days_late: day, coverage_end: coverage })]);
          await client.query("COMMIT");
          sent++;
        } catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }
        finally { client.release(); }
      } catch (error) {
        await pool.query("UPDATE platform_admin.workshop_retention_notices SET status='failed',last_error_code=$4 WHERE tenant_id=$1 AND coverage_end=$2 AND days_late=$3 AND status='reserved'", [row.tenant_id, coverage, day, error instanceof Error && error.message === "coverage_changed" ? "coverage_changed" : "delivery_unconfirmed"]);
        failed++;
      }
      if (sent + failed + blocked >= limit) break;
    }
    if (candidates.rows.length < 100) break;
  }
  return { inspected, sent, failed, blocked };
}
