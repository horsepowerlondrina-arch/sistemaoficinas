-- ADM-003: permit the explicit central-admin transfer capability.
-- Existing administrator permissions are intentionally not changed by this migration.
ALTER TABLE platform_admin.administrators
  DROP CONSTRAINT platform_admin_permissions_allowlist;
ALTER TABLE platform_admin.administrators
  ADD CONSTRAINT platform_admin_permissions_allowlist
  CHECK (permissions <@ '["audit:read","administrators:manage","platform:settings","critical:request","critical:approve","workshops:read","workshops:manage","data-transfer:manage"]'::jsonb);
