-- Runtime access is bound to a server-validated tenant context. The application role
-- cannot select a tenant by sending a tenant_id; only auth/session middleware sets it.
GRANT USAGE ON SCHEMA horse_power TO horse_power_app;

GRANT SELECT ON horse_power.labor_categories, horse_power.labor_portes TO horse_power_app;
GRANT SELECT, UPDATE ON horse_power.tenants TO horse_power_app;
GRANT SELECT ON horse_power.users TO horse_power_app;
GRANT UPDATE (password_hash) ON horse_power.users TO horse_power_app;
GRANT SELECT ON horse_power.memberships TO horse_power_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON horse_power.sessions TO horse_power_app;
GRANT SELECT, UPDATE ON horse_power.admin_setup TO horse_power_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON horse_power.login_attempts TO horse_power_app;
GRANT SELECT, INSERT ON horse_power.audit_events TO horse_power_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON horse_power.capture_sessions TO horse_power_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON horse_power.public_shares TO horse_power_app;
GRANT SELECT, INSERT ON horse_power.stock_movements, horse_power.cash_entries,
  horse_power.service_merge_history TO horse_power_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  horse_power.card_rates, horse_power.cash_accounts, horse_power.cash_movements,
  horse_power.catalog, horse_power.customers, horse_power.expense_templates,
  horse_power.external_captures, horse_power.external_catalog_links,
  horse_power.labor_commercial_rates, horse_power.labor_rates,
  horse_power.order_items, horse_power.orders, horse_power.payables,
  horse_power.payment_installments, horse_power.payment_settings,
  horse_power.product_categories, horse_power.professionals,
  horse_power.receivables, horse_power.service_aliases, horse_power.service_times,
  horse_power.stock_invoice_products, horse_power.stock_invoices,
  horse_power.suppliers, horse_power.vehicle_lookup_cache, horse_power.vehicles,
  horse_power.workshop_services TO horse_power_app;

-- Remove legacy policies that allowed every application connection to access all
-- tenants. Replace them only on the explicit allowlist of tenant-owned tables.
DO $migration$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'card_rates','cash_accounts','cash_movements','catalog','customers',
    'expense_templates','external_captures','external_catalog_links',
    'labor_commercial_rates','labor_rates','order_items','orders','payables',
    'payment_installments','payment_settings','product_categories','professionals',
    'receivables','service_aliases','service_times','stock_invoice_products',
    'stock_invoices','suppliers','vehicle_lookup_cache','vehicles','workshop_services',
    'stock_movements','cash_entries','service_merge_history','audit_events'
  ] LOOP
    EXECUTE format('ALTER TABLE horse_power.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS backend_access ON horse_power.%I', table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_rates ON horse_power.%I', table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_services ON horse_power.%I', table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_scope ON horse_power.%I', table_name);
    EXECUTE format(
      'CREATE POLICY tenant_scope ON horse_power.%I FOR ALL TO horse_power_app USING (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')) WITH CHECK (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), ''''))',
      table_name
    );
  END LOOP;
END
$migration$;

ALTER TABLE horse_power.tenants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_scope ON horse_power.tenants;
CREATE POLICY tenant_scope ON horse_power.tenants FOR SELECT TO horse_power_app
  USING (id = NULLIF(current_setting('app.tenant_id', true), '')
    OR EXISTS (SELECT 1 FROM horse_power.memberships m
      WHERE m.tenant_id=tenants.id AND m.user_id=NULLIF(current_setting('app.user_id', true), '')));
CREATE POLICY tenant_update ON horse_power.tenants FOR UPDATE TO horse_power_app
  USING (id = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (id = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE horse_power.users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_self ON horse_power.users;
CREATE POLICY user_self ON horse_power.users FOR SELECT TO horse_power_app
  USING (id = NULLIF(current_setting('app.user_id', true), '')
    OR lower(email) = lower(NULLIF(current_setting('app.login_email', true), '')));
CREATE POLICY user_password_setup ON horse_power.users FOR UPDATE TO horse_power_app
  USING (id = NULLIF(current_setting('app.user_id', true), ''))
  WITH CHECK (id = NULLIF(current_setting('app.user_id', true), ''));

ALTER TABLE horse_power.memberships ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS membership_self ON horse_power.memberships;
CREATE POLICY membership_self ON horse_power.memberships FOR SELECT TO horse_power_app
  USING (user_id = NULLIF(current_setting('app.user_id', true), ''));

ALTER TABLE horse_power.sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS session_scope ON horse_power.sessions;
CREATE POLICY session_select ON horse_power.sessions FOR SELECT TO horse_power_app
  USING (
    token_hash = NULLIF(current_setting('app.session_hash', true), '')
    OR (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')
        AND user_id = NULLIF(current_setting('app.user_id', true), ''))
    OR EXISTS (
      SELECT 1 FROM horse_power.capture_sessions c
      WHERE c.token_hash = NULLIF(current_setting('app.extension_hash', true), '')
        AND c.session_hash = sessions.token_hash AND c.user_id = sessions.user_id
        AND c.tenant_id = sessions.tenant_id
    )
  );
CREATE POLICY session_insert ON horse_power.sessions FOR INSERT TO horse_power_app
  WITH CHECK (
    user_id = NULLIF(current_setting('app.user_id', true), '')
    AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')
    AND EXISTS (SELECT 1 FROM horse_power.memberships m
      WHERE m.user_id = sessions.user_id AND m.tenant_id = sessions.tenant_id)
  );
CREATE POLICY session_update ON horse_power.sessions FOR UPDATE TO horse_power_app
  USING (token_hash = NULLIF(current_setting('app.session_hash', true), '')
      OR (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')
          AND user_id = NULLIF(current_setting('app.user_id', true), '')))
  WITH CHECK (user_id = NULLIF(current_setting('app.user_id', true), '')
      AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')
      AND EXISTS (SELECT 1 FROM horse_power.memberships m
        WHERE m.user_id = sessions.user_id AND m.tenant_id = sessions.tenant_id));
CREATE POLICY session_delete ON horse_power.sessions FOR DELETE TO horse_power_app
  USING (
    token_hash = NULLIF(current_setting('app.session_hash', true), '')
    OR expires_at < (extract(epoch FROM statement_timestamp()) * 1000)::bigint
    OR EXISTS (SELECT 1 FROM horse_power.admin_setup a
      WHERE a.token_hash = NULLIF(current_setting('app.setup_hash', true), '')
        AND a.user_id = sessions.user_id)
  );

ALTER TABLE horse_power.admin_setup ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS setup_token ON horse_power.admin_setup;
CREATE POLICY setup_token ON horse_power.admin_setup FOR SELECT TO horse_power_app
  USING (token_hash = NULLIF(current_setting('app.setup_hash', true), ''));
CREATE POLICY setup_mark_used ON horse_power.admin_setup FOR UPDATE TO horse_power_app
  USING (token_hash = NULLIF(current_setting('app.setup_hash', true), ''))
  WITH CHECK (token_hash = NULLIF(current_setting('app.setup_hash', true), ''));

ALTER TABLE horse_power.login_attempts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS login_attempt_scope ON horse_power.login_attempts;
CREATE POLICY login_attempt_scope ON horse_power.login_attempts FOR ALL TO horse_power_app
  USING (key = NULLIF(current_setting('app.login_key', true), ''))
  WITH CHECK (key = NULLIF(current_setting('app.login_key', true), ''));

ALTER TABLE horse_power.capture_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS backend_access ON horse_power.capture_sessions;
DROP POLICY IF EXISTS capture_session_scope ON horse_power.capture_sessions;
CREATE POLICY capture_session_scope ON horse_power.capture_sessions FOR ALL TO horse_power_app
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')
    OR token_hash = NULLIF(current_setting('app.extension_hash', true), ''))
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE horse_power.public_shares ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS public_share_scope ON horse_power.public_shares;
CREATE POLICY public_share_scope ON horse_power.public_shares FOR ALL TO horse_power_app
  USING (
    token_hash = NULLIF(current_setting('app.public_share_hash', true), '')
    OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')
  )
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), ''));
