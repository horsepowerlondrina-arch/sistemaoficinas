import { z } from "zod";
import { transaction, type DB } from "../db/database.js";
import type { Context } from "../auth/session.js";
import { audit } from "./workshop.js";
import { requireAdmin } from "./payments.js";
import { defaultManagementResultsSettings, type ManagementResultsSettings } from "../../shared/managementResultsSettings.js";

const schema = z.object({
  hourly_rate: z.number().int().min(1).max(10000000),
  weekly_capacity: z.number().positive().max(10000),
  yellow_hours: z.number().min(0).max(10000),
  green_hours: z.number().positive().max(10000),
  goals: z.array(z.number().int().positive().max(1000000000)).min(1).max(6),
}).superRefine((value, ctx) => {
  if (value.yellow_hours >= value.green_hours || value.green_hours > value.weekly_capacity)
    ctx.addIssue({ code: "custom", message: "Os limites devem seguir: amarelo < verde ≤ capacidade semanal." });
});

function profileData(raw: unknown): Record<string, unknown> {
  try {
    const value = JSON.parse(String(raw || "{}"));
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch { return {}; }
}

export async function getManagementResultsSettings(db: DB, ctx: Context): Promise<ManagementResultsSettings & { configured: boolean }> {
  requireAdmin(ctx);
  const row = await db.prepare("SELECT profile_data FROM tenants WHERE id=?").get(ctx.tenantId);
  if (!row) throw Object.assign(new Error("Oficina não encontrada."), { status: 404 });
  const stored = profileData(row.profile_data).management_results;
  const parsed = schema.safeParse(stored);
  return { ...(parsed.success ? parsed.data : defaultManagementResultsSettings), configured: parsed.success };
}

export async function saveManagementResultsSettings(db: DB, ctx: Context, input: unknown) {
  requireAdmin(ctx);
  const settings = schema.parse(input);
  return transaction(db, async () => {
    const row = await db.prepare("SELECT profile_data FROM tenants WHERE id=?").get(ctx.tenantId);
    if (!row) throw Object.assign(new Error("Oficina não encontrada."), { status: 404 });
    const data = profileData(row.profile_data);
    await db.prepare("UPDATE tenants SET profile_data=? WHERE id=?")
      .run(JSON.stringify({ ...data, management_results: settings }), ctx.tenantId);
    await audit(db, ctx, "management_results.settings_updated", ctx.tenantId, { settings });
    return { ...settings, configured: true };
  });
}
