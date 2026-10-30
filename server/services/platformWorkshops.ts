import { z } from "zod";
import { validTaxDocument } from "../../shared/workshopIdentity.js";

export const workshopStatuses = ["pending_verification", "trial", "active", "grace_period", "read_only", "blocked", "archived", "legacy"] as const;
export type WorkshopStatus = typeof workshopStatuses[number];

const optionalText = (max: number) => z.string().trim().max(max).default("");
export const workshopRegistrationSchema = z.object({
  name: z.string().trim().min(2).max(160),
  responsible_name: z.string().trim().min(2).max(120),
  responsible_email: z.string().trim().email().max(254),
  phone: optionalText(40),
  document: optionalText(32),
}).strict().superRefine((value, context) => {
  if (value.document && !validTaxDocument(value.document))
    context.addIssue({ code: "custom", path: ["document"], message: "CPF ou CNPJ inválido." });
});

export const manualWorkshopStatuses = ["trial", "active", "read_only", "blocked", "archived"] as const;
export const workshopStatusChangeSchema = z.object({
  status: z.enum(manualWorkshopStatuses),
  trial_days: z.number().int().min(1).max(90).nullable().optional(),
  reason: z.string().trim().min(10).max(500),
}).strict().superRefine((value, context) => {
  if (value.status !== "trial" && value.trial_days != null)
    context.addIssue({ code: "custom", path: ["trial_days"], message: "O período só pode acompanhar a concessão de teste." });
});

/** Billing remains external; only verified workshops can be reactivated administratively. */
export function canManuallyTransitionWorkshop(from: WorkshopStatus, to: WorkshopStatus) {
  if (from === "legacy" || to === "legacy" || to === "pending_verification" || to === "grace_period") return false;
  if (to === "archived" || to === "blocked") return from !== "archived";
  if (to === "read_only") return ["trial", "active", "grace_period", "blocked"].includes(from);
  if (to === "active" || to === "trial") return ["trial", "read_only", "blocked"].includes(from);
  return false;
}

export function effectiveWorkshopStatus(status: WorkshopStatus, trialEndsAt: string | Date | null, now = Date.now()): WorkshopStatus {
  return status === "trial" && trialEndsAt && new Date(trialEndsAt).getTime() <= now ? "read_only" : status;
}
