-- One-time read of service categories missing from the approved 2026-11-07 .hptx backup.
-- Apply only to homologation vnclahdnirqlcbamodqy after specific authorization.
CREATE OR REPLACE FUNCTION horse_power.definitive_restore_service_categories()
RETURNS TABLE (
  id text,
  tenant_id text,
  name text,
  name_key text,
  active integer,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  IF session_user <> 'hp_restore_source_login' THEN
    RAISE EXCEPTION 'Dedicated source login required' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT c.id,c.tenant_id,c.name,c.name_key,c.active,c.created_at
      FROM horse_power.workshop_service_categories c
     WHERE c.tenant_id = '59c85eea-7112-40de-b77f-c5627c541b48'
     ORDER BY c.id;
END
$function$;
REVOKE ALL ON FUNCTION horse_power.definitive_restore_service_categories() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION horse_power.definitive_restore_service_categories() TO hp_restore_source_login;
