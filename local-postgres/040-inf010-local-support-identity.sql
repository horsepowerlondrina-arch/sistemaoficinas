CREATE OR REPLACE FUNCTION platform_support.workshop_support_identity() RETURNS TABLE(tenant_id text,user_id text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE t text:=nullif(current_setting('app.tenant_id',true),''); u text:=nullif(current_setting('app.user_id',true),'');
BEGIN
 IF (session_user NOT IN ('hp_local_app','horse_power_app') AND NOT (session_user='osdrive_local_app' AND COALESCE(pg_has_role(session_user,(SELECT oid FROM pg_roles WHERE rolname='horse_power_app'),'USAGE'),false))) OR t IS NULL OR u IS NULL OR NOT EXISTS
   (SELECT 1 FROM horse_power.memberships m WHERE m.tenant_id=t AND m.user_id=u) THEN
   RAISE EXCEPTION 'Sessão da oficina inválida' USING ERRCODE='42501';
 END IF;
 RETURN QUERY SELECT t,u;
END $$;
