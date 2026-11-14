-- Run only on homologation after explicit authorization. No passwords, no existing role changes.
-- Reversal: disable/drop the new logins and remove the provisioning helper. Existing grants are untouched.
CREATE ROLE osdrive_local_app NOLOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 4;
CREATE ROLE osdrive_local_admin NOLOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 3;
GRANT horse_power_app TO osdrive_local_app WITH INHERIT TRUE, SET FALSE, ADMIN FALSE;
GRANT hp_platform_admin_app TO osdrive_local_admin WITH INHERIT TRUE, SET FALSE, ADMIN FALSE;
CREATE FUNCTION platform_admin.inf010_enable_local_login(p_role text,p_scram text) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 IF current_user <> 'postgres' OR p_role NOT IN ('osdrive_local_app','osdrive_local_admin') OR
    p_scram !~ '^SCRAM-SHA-256\$[0-9]+:[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$' OR
    EXISTS(SELECT 1 FROM pg_roles WHERE rolname=p_role AND rolcanlogin) THEN
   RAISE EXCEPTION 'Preparação local recusada';
 END IF;
 EXECUTE format('ALTER ROLE %I LOGIN PASSWORD %L VALID UNTIL %L',p_role,p_scram,(statement_timestamp()+interval '30 days')::text);
END $$;
REVOKE ALL ON FUNCTION platform_admin.inf010_enable_local_login(text,text) FROM PUBLIC;
