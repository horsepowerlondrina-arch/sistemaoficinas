-- ADM-003: plan defaults are activated only by an explicit administrative assignment.
-- Existing workshops and memberships retain their access until that assignment.
SET search_path=pg_catalog;

ALTER TABLE platform_admin.workshops ADD COLUMN IF NOT EXISTS plan_policy_activated_at timestamptz;
ALTER TABLE platform_admin.workshops DROP CONSTRAINT IF EXISTS workshops_plan_code_check;
ALTER TABLE platform_admin.workshops ADD CONSTRAINT workshops_plan_code_check
  CHECK (plan_code IS NULL OR plan_code IN ('basic','professional','premium'));
ALTER TABLE platform_admin.plan_defaults DROP CONSTRAINT IF EXISTS plan_defaults_plan_code_check;
ALTER TABLE platform_admin.plan_defaults ADD CONSTRAINT plan_defaults_plan_code_check
  CHECK (plan_code IN ('basic','professional','premium'));
ALTER TABLE platform_admin.workshop_entitlements ADD COLUMN IF NOT EXISTS override_expires_at jsonb NOT NULL DEFAULT '{}'::jsonb
  CHECK (jsonb_typeof(override_expires_at)='object');

INSERT INTO platform_admin.plan_defaults(plan_code,configured,module_defaults,max_users,trial_days)
VALUES
 ('basic',true,'{"dashboard":true,"orders":true,"checklists":true,"customers_vehicles":true,"catalog":true,"technical_catalog":false,"external_plate_lookup":false,"professionals":true,"suppliers":false,"inventory":false,"finance":false,"settings":true}'::jsonb,2,14),
 ('professional',true,'{"dashboard":true,"orders":true,"checklists":true,"customers_vehicles":true,"catalog":true,"technical_catalog":false,"external_plate_lookup":true,"professionals":true,"suppliers":true,"inventory":true,"finance":true,"settings":true}'::jsonb,5,14),
 ('premium',true,'{"dashboard":true,"orders":true,"checklists":true,"customers_vehicles":true,"catalog":true,"technical_catalog":true,"external_plate_lookup":true,"professionals":true,"suppliers":true,"inventory":true,"finance":true,"settings":true}'::jsonb,10,14)
ON CONFLICT(plan_code) DO UPDATE SET configured=EXCLUDED.configured,module_defaults=EXCLUDED.module_defaults,
  max_users=EXCLUDED.max_users,trial_days=EXCLUDED.trial_days,updated_at=statement_timestamp();

CREATE OR REPLACE FUNCTION platform_admin.effective_workshop_entitlements(p_tenant_id text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $function$
DECLARE
  v_plan text; v_activated timestamptz; v_status text; v_trial_end timestamptz;
  v_effective_plan text; v_trial_active boolean; v_plan_configured boolean;
  v_plan_modules jsonb; v_plan_users integer; v_plan_trial integer;
  v_overrides jsonb; v_expiry jsonb; v_active_overrides jsonb;
  v_max_override integer; v_trial_override integer; v_modules jsonb;
BEGIN
  SELECT w.plan_code,w.plan_policy_activated_at,w.status,w.trial_ends_at,
         coalesce(e.module_overrides,'{}'::jsonb),coalesce(e.override_expires_at,'{}'::jsonb),
         e.max_users_override,e.trial_days_override
  INTO v_plan,v_activated,v_status,v_trial_end,v_overrides,v_expiry,v_max_override,v_trial_override
  FROM horse_power.tenants t
  LEFT JOIN platform_admin.workshops w ON w.tenant_id=t.id
  LEFT JOIN platform_admin.workshop_entitlements e ON e.tenant_id=t.id
  WHERE t.id=p_tenant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Oficina não encontrada' USING ERRCODE='P0002'; END IF;

  v_trial_active:=coalesce(v_status='trial' AND v_trial_end>statement_timestamp(),false);
  v_effective_plan:=CASE WHEN v_trial_active THEN 'premium' WHEN v_activated IS NOT NULL THEN v_plan END;
  SELECT coalesce(configured,false),coalesce(module_defaults,'{}'::jsonb),max_users,trial_days
    INTO v_plan_configured,v_plan_modules,v_plan_users,v_plan_trial
  FROM platform_admin.plan_defaults WHERE plan_code=v_effective_plan;
  v_plan_configured:=coalesce(v_plan_configured,false);
  v_plan_modules:=coalesce(v_plan_modules,'{}'::jsonb);

  SELECT coalesce(jsonb_object_agg(k,v),'{}'::jsonb) INTO v_active_overrides
  FROM jsonb_each(v_overrides) AS entry(k,v)
  WHERE NOT (v_expiry ? k) OR (v_expiry->>k)::timestamptz>statement_timestamp();
  SELECT jsonb_object_agg(k,CASE
    WHEN jsonb_typeof(v_active_overrides->k)='boolean' THEN v_active_overrides->k
    WHEN v_plan_configured AND jsonb_typeof(v_plan_modules->k)='boolean' THEN v_plan_modules->k
    WHEN k='external_plate_lookup' THEN 'null'::jsonb
    ELSE 'true'::jsonb END) INTO v_modules
  FROM unnest(ARRAY['dashboard','orders','checklists','customers_vehicles','catalog','technical_catalog',
    'external_plate_lookup','professionals','suppliers','inventory','finance','settings']) AS keys(k);

  RETURN jsonb_build_object(
    'plan_code',v_plan,'effective_plan_code',v_effective_plan,'plan_policy_activated_at',v_activated,
    'trial_active',v_trial_active,'plan_configured',v_plan_configured,
    'plan_module_defaults',CASE WHEN v_plan_configured THEN v_plan_modules ELSE '{}'::jsonb END,
    'module_overrides',v_overrides,'override_expires_at',v_expiry,
    'modules',jsonb_strip_nulls(coalesce(v_modules,'{}'::jsonb)),
    'max_users_override',v_max_override,
    'max_users',coalesce(CASE WHEN v_expiry ? 'max_users' AND (v_expiry->>'max_users')::timestamptz<=statement_timestamp() THEN NULL ELSE v_max_override END,
      CASE WHEN v_plan_configured THEN v_plan_users END),
    'trial_days_override',v_trial_override,
    'trial_days',coalesce(CASE WHEN v_expiry ? 'trial_days' AND (v_expiry->>'trial_days')::timestamptz<=statement_timestamp() THEN NULL ELSE v_trial_override END,
      CASE WHEN v_plan_configured THEN v_plan_trial END,14),
    'user_count',(SELECT count(*) FROM horse_power.memberships m WHERE m.tenant_id=p_tenant_id));
END
$function$;

CREATE FUNCTION platform_admin.set_workshop_plan(p_tenant_id text,p_session_token_hash text,p_plan text,p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $function$
DECLARE v_admin record; v_before jsonb; v_after jsonb;
BEGIN
  SELECT a.id,a.email INTO v_admin FROM platform_admin.sessions s
  JOIN platform_admin.administrators a ON a.id=s.administrator_id
  WHERE s.token_hash=p_session_token_hash AND s.expires_at>statement_timestamp()
    AND a.active AND a.enrolled AND a.permissions @> '["workshops:manage"]'::jsonb;
  IF NOT FOUND THEN RAISE EXCEPTION 'Permissão administrativa insuficiente' USING ERRCODE='42501'; END IF;
  IF p_plan NOT IN ('basic','professional','premium') OR length(trim(coalesce(p_reason,''))) NOT BETWEEN 10 AND 500 THEN
    RAISE EXCEPTION 'Plano ou justificativa inválida' USING ERRCODE='22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_tenant_id,104730));
  IF NOT EXISTS (SELECT 1 FROM platform_admin.workshops WHERE tenant_id=p_tenant_id AND source<>'legacy') THEN
    RAISE EXCEPTION 'Oficina gerenciada não encontrada' USING ERRCODE='P0002';
  END IF;
  v_before:=platform_admin.effective_workshop_entitlements(p_tenant_id);
  UPDATE platform_admin.workshops SET plan_code=p_plan,plan_policy_activated_at=statement_timestamp(),updated_at=statement_timestamp()
  WHERE tenant_id=p_tenant_id;
  v_after:=platform_admin.effective_workshop_entitlements(p_tenant_id);
  INSERT INTO platform_admin.audit_events(id,actor_administrator_id,actor_email,subject_tenant_id,action,result,technical_context,created_at)
  VALUES(md5(clock_timestamp()::text||random()::text||p_tenant_id),v_admin.id,v_admin.email,p_tenant_id,
    'admin.workshop.plan_changed','success',jsonb_build_object('reason',trim(p_reason),'before',v_before,'after',v_after),statement_timestamp());
  RETURN v_after;
END
$function$;

CREATE FUNCTION platform_admin.set_workshop_entitlements(
  p_tenant_id text,p_session_token_hash text,p_module_overrides jsonb,p_max_users integer,
  p_trial_days integer,p_reason text,p_override_expires_at jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $function$
DECLARE v_admin record; v_before jsonb; v_after jsonb; v_invalid text;
BEGIN
  SELECT a.id,a.email INTO v_admin FROM platform_admin.sessions s
  JOIN platform_admin.administrators a ON a.id=s.administrator_id
  WHERE s.token_hash=p_session_token_hash AND s.expires_at>statement_timestamp()
    AND a.active AND a.enrolled AND a.permissions @> '["workshops:manage"]'::jsonb;
  IF NOT FOUND THEN RAISE EXCEPTION 'Permissão administrativa insuficiente' USING ERRCODE='42501'; END IF;
  IF jsonb_typeof(p_module_overrides) IS DISTINCT FROM 'object' OR jsonb_typeof(p_override_expires_at) IS DISTINCT FROM 'object'
    OR p_max_users IS NOT NULL AND p_max_users NOT BETWEEN 1 AND 10000
    OR p_trial_days IS NOT NULL AND p_trial_days NOT BETWEEN 1 AND 90
    OR length(trim(coalesce(p_reason,''))) NOT BETWEEN 10 AND 500 THEN
    RAISE EXCEPTION 'Exceções ou justificativa inválidas' USING ERRCODE='22023';
  END IF;
  SELECT k INTO v_invalid FROM jsonb_each(p_module_overrides) e(k,v)
  WHERE k NOT IN ('dashboard','orders','checklists','customers_vehicles','catalog','technical_catalog','external_plate_lookup',
    'professionals','suppliers','inventory','finance','settings') OR jsonb_typeof(v)<>'boolean' LIMIT 1;
  IF v_invalid IS NOT NULL THEN RAISE EXCEPTION 'Permissão inválida' USING ERRCODE='22023'; END IF;
  SELECT k INTO v_invalid FROM jsonb_each(p_override_expires_at) e(k,v)
  WHERE (NOT (p_module_overrides ? k) AND NOT (k='max_users' AND p_max_users IS NOT NULL)
    AND NOT (k='trial_days' AND p_trial_days IS NOT NULL))
    OR jsonb_typeof(v)<>'string' OR v#>>'{}' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}.*Z$'
  LIMIT 1;
  IF v_invalid IS NOT NULL THEN RAISE EXCEPTION 'Validade da exceção inválida' USING ERRCODE='22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_tenant_id,104730));
  IF NOT EXISTS (SELECT 1 FROM horse_power.tenants WHERE id=p_tenant_id) THEN
    RAISE EXCEPTION 'Oficina não encontrada' USING ERRCODE='P0002';
  END IF;
  v_before:=platform_admin.effective_workshop_entitlements(p_tenant_id);
  INSERT INTO platform_admin.workshop_entitlements(tenant_id,module_overrides,max_users_override,trial_days_override,
    override_expires_at,updated_by_admin_id,updated_at,reason)
  VALUES(p_tenant_id,p_module_overrides,p_max_users,p_trial_days,p_override_expires_at,v_admin.id,statement_timestamp(),trim(p_reason))
  ON CONFLICT(tenant_id) DO UPDATE SET module_overrides=EXCLUDED.module_overrides,
    max_users_override=EXCLUDED.max_users_override,trial_days_override=EXCLUDED.trial_days_override,
    override_expires_at=EXCLUDED.override_expires_at,updated_by_admin_id=EXCLUDED.updated_by_admin_id,
    updated_at=EXCLUDED.updated_at,reason=EXCLUDED.reason;
  UPDATE platform_admin.workshops SET updated_at=statement_timestamp()
  WHERE tenant_id=p_tenant_id AND status='trial' AND trial_started_at IS NOT NULL;
  v_after:=platform_admin.effective_workshop_entitlements(p_tenant_id);
  INSERT INTO platform_admin.audit_events(id,actor_administrator_id,actor_email,subject_tenant_id,action,result,technical_context,created_at)
  VALUES(md5(clock_timestamp()::text||random()::text||p_tenant_id),v_admin.id,v_admin.email,p_tenant_id,
    'admin.workshop.entitlements.updated','success',jsonb_build_object('reason',trim(p_reason),'before',v_before,'after',v_after),statement_timestamp());
  RETURN v_after;
END
$function$;

-- The six-argument entry point remains for existing callers and clears expirations on replacement.
CREATE OR REPLACE FUNCTION platform_admin.set_workshop_entitlements(
  p_tenant_id text,p_session_token_hash text,p_module_overrides jsonb,p_max_users integer,p_trial_days integer,p_reason text
) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $function$
  SELECT platform_admin.set_workshop_entitlements($1,$2,$3,$4,$5,$6,'{}'::jsonb)
$function$;

-- The operational role can only ask if its authenticated tenant has plan-included catalog access.
CREATE FUNCTION horse_power.local_tenant_catalog_included(p_tenant_id text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $function$
DECLARE v_entitlements jsonb;
BEGIN
  PERFORM horse_power.local_tenant_module_access(p_tenant_id);
  v_entitlements:=platform_admin.effective_workshop_entitlements(p_tenant_id);
  RETURN coalesce((v_entitlements->'modules'->>'technical_catalog')::boolean,false)
    AND v_entitlements->>'effective_plan_code'='premium';
END
$function$;

REVOKE ALL ON FUNCTION platform_admin.set_workshop_plan(text,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform_admin.set_workshop_entitlements(text,text,jsonb,integer,integer,text,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION horse_power.local_tenant_catalog_included(text) FROM PUBLIC;
DO $grants$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='hp_platform_admin_app') THEN
    GRANT EXECUTE ON FUNCTION platform_admin.set_workshop_plan(text,text,text,text) TO hp_platform_admin_app;
    GRANT EXECUTE ON FUNCTION platform_admin.set_workshop_entitlements(text,text,jsonb,integer,integer,text,jsonb) TO hp_platform_admin_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='horse_power_app') THEN
    GRANT EXECUTE ON FUNCTION horse_power.local_tenant_catalog_included(text) TO horse_power_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='hp_local_app') THEN
    GRANT EXECUTE ON FUNCTION horse_power.local_tenant_catalog_included(text) TO hp_local_app;
  END IF;
END $grants$;
