-- Mirror the production membership visibility rules for the local application role.
DROP POLICY IF EXISTS backend_access ON horse_power.memberships;
DROP POLICY IF EXISTS membership_self ON horse_power.memberships;
DROP POLICY IF EXISTS membership_platform_admin_transfer_owner ON horse_power.memberships;
CREATE POLICY membership_self
  ON horse_power.memberships
  FOR SELECT
  TO hp_local_app
  USING (user_id = NULLIF(current_setting('app.user_id', true), ''));
CREATE POLICY membership_platform_admin_transfer_owner
  ON horse_power.memberships
  FOR SELECT
  TO hp_local_app
  USING (
    role = 'owner'
    AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')
    AND current_setting('app.platform_admin_transfer', true) = 'on'
  );
