-- Permit the backend's tightly scoped platform-admin transfer context to read only owner memberships for the selected tenant.
-- This is intentionally SELECT-only; it does not grant table privileges or bypass RLS.
DROP POLICY IF EXISTS membership_platform_admin_transfer_owner ON horse_power.memberships;
CREATE POLICY membership_platform_admin_transfer_owner
  ON horse_power.memberships
  FOR SELECT
  TO horse_power_app
  USING (
    role = 'owner'
    AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')
    AND current_setting('app.platform_admin_transfer', true) = 'on'
  );
