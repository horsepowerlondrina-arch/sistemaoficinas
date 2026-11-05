-- Stripe billing is opt-in. No existing workshop or Mercado Pago row is changed.
CREATE TABLE platform_admin.stripe_prices (
 id text PRIMARY KEY,
 plan_code text NOT NULL CHECK(plan_code IN ('basic','professional','premium')),
 amount_cents integer NOT NULL CHECK(amount_cents BETWEEN 50 AND 100000000),
 active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(),
 created_by text NOT NULL REFERENCES platform_admin.administrators(id),
 reason text NOT NULL CHECK(length(reason) BETWEEN 10 AND 500)
);
CREATE UNIQUE INDEX stripe_one_active_price ON platform_admin.stripe_prices(plan_code) WHERE active;
CREATE TABLE platform_admin.stripe_accounts (
 tenant_id text PRIMARY KEY REFERENCES horse_power.tenants(id),
 customer_id text UNIQUE,
 billing_email text NOT NULL,
 retry_after timestamptz,
 subscription_status text,
 cancel_at_period_end boolean NOT NULL DEFAULT false,
 subscription_id text UNIQUE,
 plan_code text NOT NULL CHECK(plan_code IN ('basic','professional','premium')),
 price_id text NOT NULL REFERENCES platform_admin.stripe_prices(id),
 method text NOT NULL CHECK(method IN ('card','pix')),
 managed boolean NOT NULL DEFAULT false,
 due_on date,
 paid_until date,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE platform_admin.stripe_checkouts (
 id text PRIMARY KEY,
 tenant_id text NOT NULL REFERENCES platform_admin.stripe_accounts(tenant_id),
 price_id text NOT NULL REFERENCES platform_admin.stripe_prices(id),
 method text NOT NULL CHECK(method IN ('card','pix')),
 due_on date NOT NULL,
 period_end date NOT NULL,
 provider_id text UNIQUE,
 url text,
 request_body jsonb NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','open','paid','expired')),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX stripe_one_open_checkout ON platform_admin.stripe_checkouts(tenant_id) WHERE status IN ('pending','open');
CREATE TABLE platform_admin.stripe_payments (
 provider_id text PRIMARY KEY,
 tenant_id text NOT NULL REFERENCES platform_admin.stripe_accounts(tenant_id),
 amount_cents integer NOT NULL CHECK(amount_cents>=0),
 payment_intent_id text UNIQUE,
 price_id text NOT NULL REFERENCES platform_admin.stripe_prices(id),
 period_start date NOT NULL,
 period_end date NOT NULL,
 status text NOT NULL CHECK(status IN ('paid','refunded','disputed')),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE platform_admin.stripe_events (
 id text PRIMARY KEY,
 event_type text NOT NULL,
 resource_id text NOT NULL,
 processed_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON platform_admin.stripe_prices,platform_admin.stripe_accounts,platform_admin.stripe_checkouts,
 platform_admin.stripe_payments,platform_admin.stripe_events FROM PUBLIC;
ALTER TABLE platform_admin.stripe_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_admin.stripe_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_admin.stripe_checkouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_admin.stripe_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_admin.stripe_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY stripe_backend ON platform_admin.stripe_prices TO hp_platform_admin_app USING(true) WITH CHECK(true);
CREATE POLICY stripe_backend ON platform_admin.stripe_accounts TO hp_platform_admin_app USING(true) WITH CHECK(true);
CREATE POLICY stripe_backend ON platform_admin.stripe_checkouts TO hp_platform_admin_app USING(true) WITH CHECK(true);
CREATE POLICY stripe_backend ON platform_admin.stripe_payments TO hp_platform_admin_app USING(true) WITH CHECK(true);
CREATE POLICY stripe_backend ON platform_admin.stripe_events TO hp_platform_admin_app USING(true) WITH CHECK(true);
GRANT SELECT,INSERT,UPDATE ON platform_admin.stripe_prices,platform_admin.stripe_accounts,platform_admin.stripe_checkouts,
 platform_admin.stripe_payments TO hp_platform_admin_app;
GRANT SELECT,INSERT ON platform_admin.stripe_events TO hp_platform_admin_app;

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

  -- Only a settled, locally reconciled subscription supplies a commercial plan.
  -- Administrative suspensions remain authoritative in the access-state function.
  SELECT a.plan_code, a.created_at INTO v_effective_plan,v_activated
    FROM platform_admin.stripe_accounts a WHERE a.tenant_id=p_tenant_id AND a.managed;
  IF FOUND THEN v_plan:=v_effective_plan;
  ELSE SELECT plan_policy_activated_at INTO v_activated FROM platform_admin.workshops WHERE tenant_id=p_tenant_id; END IF;
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


-- Existing manual suspensions cannot be cleared by a provider event.
CREATE OR REPLACE FUNCTION horse_power.local_tenant_access_state(p_tenant_id text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $function$
 SELECT coalesce((SELECT CASE
   WHEN w.status IN ('pending_verification','blocked','archived','read_only') THEN w.status
   WHEN w.status='trial' AND w.trial_ends_at>statement_timestamp() THEN 'trial'
   WHEN a.managed AND (a.paid_until IS NULL OR a.paid_until<(statement_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date)
     AND a.due_on<(statement_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date THEN 'read_only'
   WHEN a.managed AND a.paid_until>=(statement_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date THEN 'active'
   WHEN w.status='trial' AND w.trial_ends_at<=statement_timestamp() THEN 'read_only'
   ELSE w.status END
 FROM platform_admin.workshops w LEFT JOIN platform_admin.stripe_accounts a ON a.tenant_id=w.tenant_id WHERE w.tenant_id=p_tenant_id),'legacy')
$function$;
