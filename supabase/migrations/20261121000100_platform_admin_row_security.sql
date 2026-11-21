-- Maintain the private admin service's existing SQL privileges.
-- The owner retains its existing access for vetted SECURITY DEFINER functions.
DO $rls$
DECLARE
  table_name text;
  relation oid;
  owner_role oid;
  admin_role oid := 'hp_platform_admin_app'::regrole;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'administrators', 'audit_events', 'billing_invoices', 'billing_subscriptions',
    'billing_webhook_events', 'catalog_test_access', 'critical_operation_requests',
    'login_attempts', 'plan_defaults', 'plan_prices', 'sessions', 'settings',
    'setup_tokens', 'workshop_entitlements', 'workshops'
  ] LOOP
    relation := to_regclass(format('platform_admin.%I', table_name));
    IF relation IS NULL THEN CONTINUE; END IF;
    SELECT relowner INTO owner_role FROM pg_class WHERE oid = relation;
    IF EXISTS (
      SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a
      WHERE c.oid = relation AND a.grantee NOT IN (owner_role, admin_role)
      UNION ALL
      SELECT 1 FROM pg_attribute c CROSS JOIN LATERAL aclexplode(c.attacl) a
      WHERE c.attrelid = relation AND a.grantee NOT IN (owner_role, admin_role)
    ) THEN
      RAISE EXCEPTION 'Privilégios inesperados na tabela administrativa %', table_name;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = relation AND relrowsecurity) THEN
      IF EXISTS (
        SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a
        WHERE c.oid = relation AND a.grantee = admin_role
        UNION ALL
        SELECT 1 FROM pg_attribute c CROSS JOIN LATERAL aclexplode(c.attacl) a
        WHERE c.attrelid = relation AND a.grantee = admin_role
      ) THEN
        EXECUTE format(
          'CREATE POLICY backend_admin_access ON platform_admin.%I FOR ALL TO hp_platform_admin_app USING (true) WITH CHECK (true)',
          table_name
        );
      END IF;
      EXECUTE format('ALTER TABLE platform_admin.%I ENABLE ROW LEVEL SECURITY', table_name);
    END IF;
  END LOOP;
END
$rls$;

ALTER FUNCTION platform_admin.reject_audit_mutation() SET search_path = pg_catalog;
