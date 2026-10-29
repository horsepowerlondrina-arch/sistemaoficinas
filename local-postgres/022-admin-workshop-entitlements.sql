-- ADM-001.6: per-workshop administrative entitlements, with plan-ready defaults.
-- Additive only: existing workshops keep their current access and effective features.
ALTER TABLE platform_admin.workshops
  ADD COLUMN plan_code text CHECK (plan_code IS NULL OR plan_code IN ('basic','professional'));

CREATE TABLE platform_admin.plan_defaults (
  plan_code text PRIMARY KEY CHECK (plan_code IN ('basic','professional')),
  configured boolean NOT NULL DEFAULT false,
  module_defaults jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(module_defaults)='object'),
  max_users integer CHECK (max_users IS NULL OR max_users BETWEEN 1 AND 10000),
  trial_days integer CHECK (trial_days IS NULL OR trial_days BETWEEN 1 AND 90),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO platform_admin.plan_defaults(plan_code) VALUES ('basic'),('professional');

CREATE TABLE platform_admin.workshop_entitlements (
  tenant_id text PRIMARY KEY REFERENCES horse_power.tenants(id) ON DELETE CASCADE,
  module_overrides jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(module_overrides)='object'),
  max_users_override integer CHECK (max_users_override IS NULL OR max_users_override BETWEEN 1 AND 10000),
  trial_days_override integer CHECK (trial_days_override IS NULL OR trial_days_override BETWEEN 1 AND 90),
  updated_by_admin_id text REFERENCES platform_admin.administrators(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  reason text NOT NULL DEFAULT 'Padrões vigentes.'
);
REVOKE ALL ON platform_admin.plan_defaults,platform_admin.workshop_entitlements FROM PUBLIC;
DO $table_grants$
DECLARE r record;
BEGIN
  FOR r IN SELECT rolname FROM pg_roles WHERE rolname IN ('horse_power_app','hp_local_app','hp_platform_admin_app') LOOP
    EXECUTE format('REVOKE ALL ON platform_admin.plan_defaults,platform_admin.workshop_entitlements FROM %I',r.rolname);
  END LOOP;
END
$table_grants$;

CREATE FUNCTION platform_admin.effective_workshop_entitlements(p_tenant_id text)
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
  FROM unnest(ARRAY['dashboard','orders','checklists','customers_vehicles','catalog','professionals','suppliers','inventory','finance','settings']) AS keys(k);

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

CREATE FUNCTION platform_admin.workshop_entitlement_status(p_tenant_id text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $function$
  SELECT platform_admin.effective_workshop_entitlements(p_tenant_id)
$function$;

CREATE FUNCTION platform_admin.set_workshop_entitlements(
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
  WHERE k NOT IN ('dashboard','orders','checklists','customers_vehicles','catalog','professionals','suppliers','inventory','finance','settings')
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

-- Only the authenticated workshop backend may read its own effective module flags.
CREATE FUNCTION horse_power.local_tenant_module_access(p_tenant_id text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $function$
DECLARE v_user_id text;
BEGIN
  v_user_id:=current_setting('app.user_id',true);
  IF current_setting('app.tenant_id',true) IS DISTINCT FROM p_tenant_id OR coalesce(v_user_id,'')='' THEN
    RAISE EXCEPTION 'Contexto da oficina inválido' USING ERRCODE='42501';
  END IF;
  IF v_user_id='public' THEN
    IF NOT EXISTS (
      SELECT 1 FROM horse_power.public_shares s
      WHERE s.token_hash=current_setting('app.public_share_hash',true)
        AND s.tenant_id=p_tenant_id AND s.revoked=0 AND s.expires_at>(extract(epoch FROM statement_timestamp())*1000)::bigint
    ) THEN RAISE EXCEPTION 'Contexto público inválido' USING ERRCODE='42501'; END IF;
  ELSIF NOT EXISTS (
    SELECT 1 FROM horse_power.memberships m WHERE m.tenant_id=p_tenant_id AND m.user_id=v_user_id
  ) THEN
    RAISE EXCEPTION 'Contexto da oficina inválido' USING ERRCODE='42501';
  END IF;
  RETURN platform_admin.effective_workshop_entitlements(p_tenant_id)->'modules';
END
$function$;

-- Enforce caps in PostgreSQL, including concurrent membership creation. Existing members are never removed.
CREATE FUNCTION horse_power.enforce_workshop_user_limit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $function$
DECLARE v_limit integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.tenant_id,104730));
  IF EXISTS (SELECT 1 FROM horse_power.memberships m WHERE m.tenant_id=NEW.tenant_id AND m.user_id=NEW.user_id) THEN
    RETURN NEW;
  END IF;
  v_limit:=NULLIF(platform_admin.effective_workshop_entitlements(NEW.tenant_id)->>'max_users','')::integer;
  IF v_limit IS NOT NULL AND
     (SELECT count(*) FROM horse_power.memberships m WHERE m.tenant_id=NEW.tenant_id)>=v_limit THEN
    RAISE EXCEPTION 'Limite de usuários desta oficina atingido' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END
$function$;
CREATE TRIGGER workshop_user_limit_before_insert
BEFORE INSERT ON horse_power.memberships
FOR EACH ROW EXECUTE FUNCTION horse_power.enforce_workshop_user_limit();

-- Use the configured administrative period for trial creation while keeping the legacy 14-day default.
CREATE FUNCTION platform_admin.apply_workshop_trial_period()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $function$
DECLARE v_days integer;
BEGIN
  IF NEW.status='trial' AND NEW.trial_started_at IS NOT NULL THEN
    v_days:=coalesce((platform_admin.effective_workshop_entitlements(NEW.tenant_id)->>'trial_days')::integer,14);
    NEW.trial_ends_at:=NEW.trial_started_at+make_interval(days=>v_days);
  END IF;
  RETURN NEW;
END
$function$;
CREATE TRIGGER platform_admin_workshop_trial_period
BEFORE INSERT OR UPDATE ON platform_admin.workshops
FOR EACH ROW EXECUTE FUNCTION platform_admin.apply_workshop_trial_period();

-- Replace only the original fixed 14-day check; keep all existing status and identity checks.
DO $migration$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid='platform_admin.workshops'::regclass AND contype='c'
      AND pg_get_constraintdef(oid) LIKE '%14 days%'
  LOOP
    EXECUTE format('ALTER TABLE platform_admin.workshops DROP CONSTRAINT %I',c.conname);
  END LOOP;
END
$migration$;
ALTER TABLE platform_admin.workshops
  ADD CONSTRAINT platform_admin_workshops_trial_window
  CHECK ((trial_started_at IS NULL AND trial_ends_at IS NULL) OR
    (trial_started_at IS NOT NULL AND trial_ends_at>trial_started_at AND
     trial_ends_at<=trial_started_at+interval '90 days'));

REVOKE ALL ON FUNCTION platform_admin.effective_workshop_entitlements(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform_admin.workshop_entitlement_status(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform_admin.set_workshop_entitlements(text,text,jsonb,integer,integer,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION horse_power.local_tenant_module_access(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION horse_power.enforce_workshop_user_limit() FROM PUBLIC;
REVOKE ALL ON FUNCTION platform_admin.apply_workshop_trial_period() FROM PUBLIC;

DO $grants$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='hp_platform_admin_app') THEN
    GRANT EXECUTE ON FUNCTION platform_admin.workshop_entitlement_status(text) TO hp_platform_admin_app;
    GRANT EXECUTE ON FUNCTION platform_admin.set_workshop_entitlements(text,text,jsonb,integer,integer,text) TO hp_platform_admin_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='horse_power_app') THEN
    GRANT EXECUTE ON FUNCTION horse_power.local_tenant_module_access(text) TO horse_power_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='hp_local_app') THEN
    GRANT EXECUTE ON FUNCTION horse_power.local_tenant_module_access(text) TO hp_local_app;
  END IF;
END
$grants$;
