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

export const manualWorkshopStatuses = ["read_only", "blocked", "archived"] as const;
export const workshopStatusChangeSchema = z.object({
  status: z.enum(manualWorkshopStatuses),
  reason: z.string().trim().min(10).max(500),
}).strict();

const allowedManualTransitions: Record<Exclude<WorkshopStatus, "legacy">, readonly WorkshopStatus[]> = {
  pending_verification: ["blocked", "archived"],
  trial: ["read_only", "blocked", "archived"],
  active: ["read_only", "blocked", "archived"],
  grace_period: ["read_only", "blocked", "archived"],
  read_only: ["blocked", "archived"],
  blocked: ["read_only", "archived"],
  archived: [],
};

/** Billing states can only be entered by their future verified/billing workflows. */
export function canManuallyTransitionWorkshop(from: WorkshopStatus, to: WorkshopStatus) {
  if (from === "legacy" || to === "legacy" || to === "trial" || to === "active" || to === "grace_period" || to === "pending_verification")
    return false;
  return allowedManualTransitions[from].includes(to);
}

export function effectiveWorkshopStatus(status: WorkshopStatus, trialEndsAt: string | Date | null, now = Date.now()): WorkshopStatus {
  return status === "trial" && trialEndsAt && new Date(trialEndsAt).getTime() <= now ? "read_only" : status;
}
