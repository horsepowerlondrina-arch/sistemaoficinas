import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
export type Integration = "stripe" | "fipeplaca" | "resend";
export type IntegrationFailure = (provider: Integration) => Promise<void>;
// No request URL, payload, error message or customer identity is persisted.
export function integrationFailureRecorder(pool: Pick<Pool,"query">): IntegrationFailure {
 return async provider => {
  if (!["stripe","fipeplaca","resend"].includes(provider)) return;
  try {
   await pool.query("INSERT INTO platform_admin.audit_events(id,actor_email,action,result,technical_context) VALUES($1,'system',$2,'failure','{}'::jsonb)", [randomUUID(),`integration.${provider}.failure`]);
  } catch { console.warn("Integration monitoring record unavailable"); }
 };
}
export async function observeIntegration<T>(provider: Integration, record: IntegrationFailure, operation: () => Promise<T>): Promise<T> {
 try { return await operation(); }
 catch(error) { try { await record(provider); } catch { /* Monitoring must not replace the original failure. */ } throw error; }
}
