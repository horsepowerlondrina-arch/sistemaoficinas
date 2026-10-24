-- Enforce the mandatory MFA activation and permission allow-list at the data layer.
ALTER TABLE platform_admin.administrators
  ADD CONSTRAINT platform_admin_active_requires_mfa
  CHECK (NOT active OR (enrolled AND password_hash <> '' AND totp_secret_ciphertext <> ''));

ALTER TABLE platform_admin.administrators
  ADD CONSTRAINT platform_admin_permissions_allowlist
  CHECK (permissions <@ '["audit:read","administrators:manage","platform:settings","critical:request","critical:approve"]'::jsonb);
