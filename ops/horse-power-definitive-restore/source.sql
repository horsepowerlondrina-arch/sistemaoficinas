-- One-time, narrowly scoped source access. Apply only to homologation vnclahdnirqlcbamodqy after approval.
DO $block$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hp_restore_source_login') THEN
    CREATE ROLE hp_restore_source_login NOLOGIN;
  END IF;
END
$block$;

GRANT CONNECT ON DATABASE postgres TO hp_restore_source_login;
GRANT USAGE ON SCHEMA horse_power TO hp_restore_source_login;

CREATE OR REPLACE FUNCTION horse_power.definitive_restore_source()
RETURNS TABLE (
  tenant_id text,
  tenant_name text,
  owner_user_id text,
  owner_name text,
  owner_email text,
  owner_password_hash text,
  email_verified_at timestamptz,
  backup_id text,
  backup_sha256 text,
  backup_bytes bigint,
  encrypted_package bytea
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  IF session_user <> 'hp_restore_source_login' THEN
    RAISE EXCEPTION 'Dedicated source login required' USING ERRCODE = '42501';
  END IF;
  IF (SELECT count(*) FROM horse_power.memberships m
      WHERE m.tenant_id = '59c85eea-7112-40de-b77f-c5627c541b48' AND m.role = 'owner') <> 1 THEN
    RAISE EXCEPTION 'Source owner is not unique' USING ERRCODE = 'P0001';
  END IF;
  RETURN QUERY
    SELECT t.id,t.name,u.id,u.name,u.email,u.password_hash,w.email_verified_at,
           b.id,b.package_sha256,octet_length(b.package)::bigint,b.package
    FROM horse_power.tenants t
    JOIN horse_power.memberships m ON m.tenant_id = t.id AND m.role = 'owner'
    JOIN horse_power.users u ON u.id = m.user_id
    JOIN platform_admin.workshops w ON w.tenant_id = t.id
    JOIN horse_power.data_transfer_backups b ON b.tenant_id = t.id
    WHERE t.id = '59c85eea-7112-40de-b77f-c5627c541b48'
      AND b.id = '05fa154b-3f96-4fe0-855a-a0af10f46e8f'
      AND b.package_sha256 = 'f0c8a897919c61dd912a711c0c6d9ac6149638c9a423d3c1da22aa76592154a1'
      AND b.expires_at > statement_timestamp()
      AND w.email_verified_at IS NOT NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Approved encrypted backup unavailable' USING ERRCODE = 'P0002';
  END IF;
END
$function$;

REVOKE ALL ON FUNCTION horse_power.definitive_restore_source() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION horse_power.definitive_restore_source() TO hp_restore_source_login;
