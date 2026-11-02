-- Homologação: concede somente as colunas exigidas para aprovar solicitações críticas.
-- A API continua exigindo uma segunda conta e grava a aprovação com auditoria na mesma transação.
GRANT UPDATE (status, approved_by, decided_at)
  ON platform_admin.critical_operation_requests TO hp_platform_admin_app;
