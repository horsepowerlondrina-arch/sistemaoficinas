-- Retire the former bulk catalog testing control without changing workshop access.
-- Historical access rows and audit events remain intact for individual review.
DROP TRIGGER IF EXISTS catalog_test_access_after_activation ON platform_admin.workshops;
DROP FUNCTION IF EXISTS platform_admin.catalog_test_access_after_activation();
DROP FUNCTION IF EXISTS platform_admin.set_catalog_test_access(text,text,boolean,timestamptz,text);
DROP FUNCTION IF EXISTS platform_admin.apply_catalog_test_access(text,text);
DROP FUNCTION IF EXISTS platform_admin.catalog_test_access_status();
COMMENT ON TABLE platform_admin.catalog_test_access IS
  'Retired bulk catalog test control. Retained solely for historical audit; individual workshop entitlements remain authoritative.';
