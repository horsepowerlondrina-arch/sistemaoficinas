-- ADM-001.6.1: add the Technical Time Catalog to the existing workshop entitlements.
-- The compatibility default is enabled; explicit admin overrides take precedence over plan defaults.
-- Replacing these functions preserves their existing ownership and EXECUTE grants.
SET search_path=pg_catalog;

CREATE OR REPLACE FUNCTION platform_admin.effective_workshop_entitlements(p_tenant_id text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $function$
DECLARE
  v_plan text;
  v_plan_configured boolean;
  v_plan_modules jsonb;
  v_plan_users integer;
  v_plan_trial integer;
  v_overrides jsonb;
  v_max_users integer;
  v_trial_days integer;
  v_modules jsonb;
BEGIN
  SELECT w.plan_code,coalesce(p.configured,false),coalesce(p.module_defaults,'{}'::jsonb),p.max_users,p.trial_days,
         coalesce(e.module_overrides,'{}'::jsonb),e.max_users_override,e.trial_days_override
    INTO v_plan,v_plan_configured,v_plan_modules,v_plan_users,v_plan_trial,v_overrides,v_max_users,v_trial_days
  FROM horse_power.tenants t
  LEFT JOIN platform_admin.workshops w ON w.tenant_id=t.id
  LEFT JOIN platform_admin.plan_defaults p ON p.plan_code=w.plan_code
  LEFT JOIN platform_admin.workshop_entitlements e ON e.tenant_id=t.id
  WHERE t.id=p_tenant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Oficina não encontrada' USING ERRCODE='P0002'; END IF;

  SELECT jsonb_object_agg(k,CASE
    WHEN jsonb_typeof(v_overrides->k)='boolean' THEN v_overrides->k
    WHEN v_plan_configured AND jsonb_typeof(v_plan_modules->k)='boolean' THEN v_plan_modules->k
    ELSE 'true'::jsonb END)
    INTO v_modules
  FROM unnest(ARRAY['dashboard','orders','checklists','customers_vehicles','catalog','technical_catalog','professionals','suppliers','inventory','finance','settings']) AS keys(k);

  RETURN jsonb_build_object(
    'plan_code',v_plan,
    'plan_configured',v_plan_configured,
    'module_overrides',v_overrides,
    'modules',coalesce(v_modules,'{}'::jsonb),
    'plan_module_defaults',CASE WHEN v_plan_configured THEN v_plan_modules ELSE '{}'::jsonb END,
    'max_users_override',v_max_users,
    'max_users',coalesce(v_max_users,CASE WHEN v_plan_configured THEN v_plan_users END),
    'trial_days_override',v_trial_days,
    'trial_days',coalesce(v_trial_days,CASE WHEN v_plan_configured THEN v_plan_trial END,14),
    'user_count',(SELECT count(*) FROM horse_power.memberships m WHERE m.tenant_id=p_tenant_id)
  );
END
$function$;

CREATE OR REPLACE FUNCTION platform_admin.set_workshop_entitlements(
  p_tenant_id text,p_session_token_hash text,p_module_overrides jsonb,
  p_max_users integer,p_trial_days integer,p_reason text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $function$
DECLARE
  admin_row record;
  before_state jsonb;
  after_state jsonb;
  invalid_key text;
BEGIN
  SELECT a.id,a.email INTO admin_row
  FROM platform_admin.sessions s
  JOIN platform_admin.administrators a ON a.id=s.administrator_id
  WHERE s.token_hash=p_session_token_hash AND s.expires_at>statement_timestamp()
    AND a.active AND a.enrolled AND a.permissions @> '["workshops:manage"]'::jsonb;
  IF NOT FOUND THEN RAISE EXCEPTION 'Permissão administrativa insuficiente' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM horse_power.tenants WHERE id=p_tenant_id) THEN
    RAISE EXCEPTION 'Oficina não encontrada' USING ERRCODE='P0002';
  END IF;
  IF jsonb_typeof(p_module_overrides) IS DISTINCT FROM 'object'
     OR p_max_users IS NOT NULL AND p_max_users NOT BETWEEN 1 AND 10000
     OR p_trial_days IS NOT NULL AND p_trial_days NOT BETWEEN 1 AND 90
     OR length(trim(coalesce(p_reason,''))) NOT BETWEEN 10 AND 500 THEN
    RAISE EXCEPTION 'Parâmetros de permissões ou justificativa inválidos' USING ERRCODE='22023';
  END IF;
  SELECT k INTO invalid_key
  FROM jsonb_each(p_module_overrides) e(k,v)
  WHERE k NOT IN ('dashboard','orders','checklists','customers_vehicles','catalog','technical_catalog','professionals','suppliers','inventory','finance','settings')
     OR jsonb_typeof(v) IS DISTINCT FROM 'boolean'
  LIMIT 1;
  IF invalid_key IS NOT NULL THEN
    RAISE EXCEPTION 'Permissão de funcionalidade inválida' USING ERRCODE='22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_tenant_id,104730));
  before_state:=platform_admin.effective_workshop_entitlements(p_tenant_id);
  INSERT INTO platform_admin.workshop_entitlements(tenant_id,module_overrides,max_users_override,trial_days_override,updated_by_admin_id,updated_at,reason)
  VALUES(p_tenant_id,p_module_overrides,p_max_users,p_trial_days,admin_row.id,statement_timestamp(),trim(p_reason))
  ON CONFLICT(tenant_id) DO UPDATE SET module_overrides=EXCLUDED.module_overrides,
    max_users_override=EXCLUDED.max_users_override,trial_days_override=EXCLUDED.trial_days_override,
    updated_by_admin_id=EXCLUDED.updated_by_admin_id,updated_at=EXCLUDED.updated_at,reason=EXCLUDED.reason;

  -- Changing a trial period affects the current trial only; other workshop states are untouched.
  UPDATE platform_admin.workshops SET updated_at=statement_timestamp()
  WHERE tenant_id=p_tenant_id AND status='trial' AND trial_started_at IS NOT NULL;

  after_state:=platform_admin.effective_workshop_entitlements(p_tenant_id);
  INSERT INTO platform_admin.audit_events(id,actor_administrator_id,actor_email,subject_tenant_id,action,result,technical_context,created_at)
  VALUES(md5(clock_timestamp()::text||random()::text||p_tenant_id),admin_row.id,admin_row.email,p_tenant_id,
    'admin.workshop.entitlements.updated','success',
    jsonb_build_object('reason',trim(p_reason),'before',before_state,'after',after_state),statement_timestamp());
  RETURN after_state;
END
$function$;
