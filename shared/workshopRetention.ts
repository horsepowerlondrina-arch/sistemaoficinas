import { billingDate } from "./stripeBilling.js";

export const retentionNoticeDays = [30, 60, 89] as const;
export const workshopDeletionDay = 90;
export const recoveryCopyDays = 15;

/** Calendar days in São Paulo. Coverage is valid through its last paid day. */
export function daysAfterCoverage(coverageEnd: string, now = new Date()): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(coverageEnd)) throw new Error("Fim da cobertura inválido.");
  const [year, month, day] = coverageEnd.split("-").map(Number);
  const end = Date.UTC(year, month - 1, day);
  if (new Date(end).toISOString().slice(0, 10) !== coverageEnd) throw new Error("Fim da cobertura inválido.");
  const today = billingDate(now);
  const [todayYear, todayMonth, todayDay] = today.split("-").map(Number);
  return Math.max(0, Math.floor((Date.UTC(todayYear, todayMonth - 1, todayDay) - end) / 86400000));
}

export type RetentionDecision = "covered" | "read_only" | "notice_30" | "notice_60" | "notice_89" | "deletion_due";
export function retentionDecision(coverageEnd: string, now = new Date()): RetentionDecision {
  const days = daysAfterCoverage(coverageEnd, now);
  if (days === 0) return "covered";
  if (days >= workshopDeletionDay) return "deletion_due";
  if (days === 89) return "notice_89";
  if (days === 60) return "notice_60";
  if (days === 30) return "notice_30";
  return "read_only";
}

export type WorkshopCoverage = {
  status: string;
  emailVerified: boolean;
  managedBilling: boolean;
  paidUntil: string | null;
  dueOn: string | null;
  trialEndsOn: string | null;
};

/** Administrative access without a billing contract is not an expired subscription. */
export function retentionCoverageEnd(value: WorkshopCoverage): string | null {
  if (!value.emailVerified || !["active", "trial", "read_only"].includes(value.status)) return null;
  const valid = (day: string | null) => day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
  const trial = valid(value.trialEndsOn);
  if (value.managedBilling) {
    const billed = valid(value.paidUntil) ?? valid(value.dueOn);
    return billed && trial ? (billed > trial ? billed : trial) : billed ?? trial;
  }
  return value.status === "trial" || value.status === "read_only" ? trial : null;
}
