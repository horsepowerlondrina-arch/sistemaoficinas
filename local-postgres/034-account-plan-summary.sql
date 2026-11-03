-- OPS-004: only the authenticated workshop may read its own plan summary.
CREATE OR REPLACE FUNCTION horse_power.local_tenant_plan_summary(p_tenant_id text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $function$
DECLARE v_user text; v_tenant text; v_plan jsonb;
BEGIN
  v_tenant:=nullif(current_setting('app.tenant_id',true),'');
  v_user:=nullif(current_setting('app.user_id',true),'');
  IF v_tenant IS DISTINCT FROM p_tenant_id OR v_user IS NULL
     OR NOT EXISTS(SELECT 1 FROM horse_power.memberships m WHERE m.tenant_id=p_tenant_id AND m.user_id=v_user AND m.role='owner')
  THEN RAISE EXCEPTION 'Acesso à oficina não autorizado' USING ERRCODE='42501'; END IF;
  SELECT jsonb_build_object('plan_code',w.plan_code,'status',w.status,'trial_ends_at',w.trial_ends_at)
    INTO v_plan FROM platform_admin.workshops w WHERE w.tenant_id=p_tenant_id;
  RETURN v_plan;
END
$function$;
REVOKE ALL ON FUNCTION horse_power.local_tenant_plan_summary(text) FROM PUBLIC;
DO $grants$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='hp_local_app') THEN
    GRANT EXECUTE ON FUNCTION horse_power.local_tenant_plan_summary(text) TO hp_local_app;
  END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='horse_power_app') THEN
    GRANT EXECUTE ON FUNCTION horse_power.local_tenant_plan_summary(text) TO horse_power_app;
  END IF;
END $grants$;
