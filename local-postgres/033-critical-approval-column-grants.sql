-- Permite somente a transição auditada das solicitações críticas pelo processo administrativo restrito.
GRANT UPDATE (status, approved_by, decided_at)
  ON platform_admin.critical_operation_requests TO hp_platform_admin_app;
