-- The replace workflow deletes only these tenant-scoped operational tables.
-- Existing tenant_scope RLS policies still constrain every affected row.
GRANT DELETE ON horse_power.stock_movements,
  horse_power.cash_entries,
  horse_power.service_merge_history TO horse_power_app;

-- Audit history and immutable document revisions must remain undeletable.
REVOKE DELETE ON horse_power.audit_events,
  horse_power.document_revisions FROM horse_power_app;
