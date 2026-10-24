-- Replace needs to remove tenant-owned operational rows before inserting the
-- replacement snapshot. RLS tenant_scope policies remain the row boundary.
GRANT DELETE ON horse_power.stock_movements,
  horse_power.cash_entries,
  horse_power.service_merge_history TO hp_local_app;

-- Keep audit events append-only and document revisions immutable for the
-- runtime role, matching the hosted Supabase permission model.
REVOKE DELETE ON horse_power.audit_events,
  horse_power.document_revisions FROM hp_local_app;
