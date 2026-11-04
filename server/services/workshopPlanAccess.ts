import type { PoolClient } from "pg";

export type WorkshopAccessChoice = "none" | "basic" | "professional" | "premium";

type WorkshopRow = {
  status: string;
  source: string;
  email_verified_at: string | null;
};

/** Call inside a transaction: every plan, override and status change succeeds together. */
export async function applyWorkshopAccess(
  client: Pick<PoolClient, "query">,
  tenantId: string,
  sessionHash: string,
  choice: WorkshopAccessChoice,
  reason: string,
) {
  // The runtime admin role has SELECT and EXECUTE on scoped functions, but no direct UPDATE.
  // Serialize package changes with the same advisory lock used by the database functions.
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,104730))", [tenantId]);
  const lookup = await client.query<WorkshopRow>(
    "SELECT status,source,email_verified_at FROM platform_admin.workshops WHERE tenant_id=$1",
    [tenantId],
  );
  const workshop = lookup.rows[0];
  if (!workshop || workshop.source === "legacy") {
    throw Object.assign(new Error("Oficina gerenciada não encontrada."), { code: "P0002" });
  }
  if (workshop.status === "pending_verification" || workshop.status === "archived" || workshop.status === "legacy") {
    throw Object.assign(new Error("Conclua a ativação antes de alterar o acesso."), { code: "23514" });
  }

  if (choice === "none") {
    if (workshop.status !== "read_only") {
      await client.query(
        "SELECT platform_admin.manage_workshop_lifecycle($1,$2,'read_only',NULL,$3)",
        [tenantId, sessionHash, reason],
      );
    }
  } else {
    await client.query("SELECT platform_admin.set_workshop_plan($1,$2,$3,$4)", [tenantId, sessionHash, choice, reason]);
    // A package replaces individual exceptions and restores its standard user limit.
    await client.query(
      "SELECT platform_admin.set_workshop_entitlements($1,$2,'{}'::jsonb,NULL,NULL,$3,'{}'::jsonb)",
      [tenantId, sessionHash, reason],
    );
    if (workshop.status === "grace_period") {
      await client.query(
        "SELECT platform_admin.manage_workshop_lifecycle($1,$2,'read_only',NULL,$3)",
        [tenantId, sessionHash, reason],
      );
    }
    if (workshop.status !== "active") {
      await client.query(
        "SELECT platform_admin.manage_workshop_lifecycle($1,$2,'active',NULL,$3)",
        [tenantId, sessionHash, reason],
      );
    }
  }
  const result = await client.query<{ status: string; entitlements: Record<string, unknown> }>(
    "SELECT w.status,platform_admin.workshop_entitlement_status(w.tenant_id) AS entitlements FROM platform_admin.workshops w WHERE w.tenant_id=$1",
    [tenantId],
  );
  return result.rows[0];
}
