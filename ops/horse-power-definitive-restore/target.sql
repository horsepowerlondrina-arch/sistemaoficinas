-- One-time provisioning gate. Apply only to the empty definitive project rvlovjpquozbrsszsxwe after approval.
DO $block$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hp_restore_target_login') THEN
    CREATE ROLE hp_restore_target_login NOLOGIN;
  END IF;
END
$block$;

GRANT CONNECT ON DATABASE postgres TO hp_restore_target_login;
GRANT USAGE ON SCHEMA horse_power, platform_admin TO hp_restore_target_login;
GRANT horse_power_app TO hp_restore_target_login;

CREATE OR REPLACE FUNCTION platform_admin.provision_definitive_horse_power(
  p_tenant_id text,
  p_tenant_name text,
  p_owner_id text,
  p_owner_name text,
  p_owner_email text,
  p_password_hash text,
  p_email_verified_at timestamptz
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  IF session_user <> 'hp_restore_target_login' THEN
    RAISE EXCEPTION 'Dedicated target login required' USING ERRCODE = '42501';
  END IF;
  IF p_tenant_id <> '59c85eea-7112-40de-b77f-c5627c541b48'
     OR p_tenant_name <> 'Horse Power Car Service'
     OR p_owner_id !~ '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'
     OR length(trim(p_owner_name)) < 2
     OR p_owner_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     OR p_password_hash !~ '^[a-f0-9]{32}:[a-f0-9]{128}$'
     OR p_email_verified_at IS NULL THEN
    RAISE EXCEPTION 'Source identity is invalid' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(724009331);
  IF EXISTS (SELECT 1 FROM horse_power.tenants)
     OR EXISTS (SELECT 1 FROM horse_power.users)
     OR EXISTS (SELECT 1 FROM horse_power.memberships)
     OR EXISTS (SELECT 1 FROM platform_admin.workshops) THEN
    RAISE EXCEPTION 'Definitive destination is not empty' USING ERRCODE = '23505';
  END IF;
  INSERT INTO horse_power.tenants(id,name,document,phone,address)
    VALUES(p_tenant_id,p_tenant_name,'','','');
  INSERT INTO horse_power.users(id,name,email,password_hash)
    VALUES(p_owner_id,p_owner_name,p_owner_email,p_password_hash);
  INSERT INTO platform_admin.workshops(
    tenant_id,source,name,responsible_name,responsible_email,status,
    email_verified_at,status_reason,plan_code,plan_policy_activated_at
  ) VALUES (
    p_tenant_id,'admin',p_tenant_name,p_owner_name,p_owner_email,'active',
    p_email_verified_at,'Acesso Premium vitalício da Horse Power definitiva.','premium',statement_timestamp()
  );
  INSERT INTO horse_power.memberships(user_id,tenant_id,role)
    VALUES(p_owner_id,p_tenant_id,'owner');
END
$function$;

REVOKE ALL ON FUNCTION platform_admin.provision_definitive_horse_power(text,text,text,text,text,text,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform_admin.provision_definitive_horse_power(text,text,text,text,text,text,timestamptz) TO hp_restore_target_login;
