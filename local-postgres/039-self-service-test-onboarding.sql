-- Self-service is exposed only through the restricted backend. No anonymous SQL grants.
CREATE FUNCTION platform_admin.create_workshop_self_service(
 p_tenant text,p_name text,p_responsible text,p_email text,p_phone text,p_document text,
 p_plan text,p_invite text,p_token_hash text,p_expires timestamptz
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $function$
BEGIN
 IF p_plan NOT IN ('basic','professional','premium') OR
    lower(p_email) !~ '^[a-z0-9][a-z0-9._-]{0,63}@testes[.]osdrive[.]com[.]br$' OR
    p_token_hash !~ '^[a-f0-9]{64}$' OR p_expires<=now() OR p_expires>now()+interval '49 hours' OR
    NOT EXISTS(SELECT 1 FROM platform_admin.plan_defaults WHERE plan_code=p_plan AND configured)
 THEN RAISE EXCEPTION 'Cadastro indisponível' USING ERRCODE='22023'; END IF;
 PERFORM platform_admin.register_workshop_internal(p_tenant,p_name,p_responsible,p_email,p_phone,p_document,'admin',NULL);
 UPDATE platform_admin.workshops SET source='self_service',plan_code=p_plan,plan_policy_activated_at=now() WHERE tenant_id=p_tenant;
 INSERT INTO platform_admin.workshop_activation_invites(id,tenant_id,token_hash,responsible_email,expires_at)
 VALUES(p_invite,p_tenant,p_token_hash,lower(p_email),p_expires);
 INSERT INTO platform_admin.audit_events(id,subject_tenant_id,actor_email,action,result,technical_context)
 VALUES(p_invite,p_tenant,lower(p_email),'workshop.self_service.registered','success',jsonb_build_object('plan_code',p_plan));
END
$function$;
REVOKE ALL ON FUNCTION platform_admin.create_workshop_self_service(text,text,text,text,text,text,text,text,text,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform_admin.create_workshop_self_service(text,text,text,text,text,text,text,text,text,timestamptz) TO hp_platform_admin_app;


CREATE OR REPLACE FUNCTION platform_admin.inspect_workshop_activation(p_token_hash text)
RETURNS TABLE(valid boolean, workshop_name text, responsible_email text, expires_at timestamptz, account_exists boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $function$
  SELECT i.used_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > statement_timestamp()
       AND i.responsible_email=lower(w.responsible_email) AND w.source IN ('admin','self_service')
       AND w.status='pending_verification' AND w.email_verified_at IS NULL
       AND w.trial_started_at IS NULL,
    CASE WHEN i.used_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > statement_timestamp()
          AND i.responsible_email=lower(w.responsible_email) AND w.source IN ('admin','self_service')
          AND w.status='pending_verification' AND w.email_verified_at IS NULL
          AND w.trial_started_at IS NULL THEN w.name ELSE '' END,
    CASE WHEN i.used_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > statement_timestamp()
          AND i.responsible_email=lower(w.responsible_email) AND w.source IN ('admin','self_service')
          AND w.status='pending_verification' AND w.email_verified_at IS NULL
          AND w.trial_started_at IS NULL THEN i.responsible_email ELSE '' END,
    i.expires_at,
    EXISTS (SELECT 1 FROM horse_power.users u WHERE lower(u.email)=lower(i.responsible_email))
  FROM platform_admin.workshop_activation_invites i
  JOIN platform_admin.workshops w ON w.tenant_id=i.tenant_id
  WHERE i.token_hash=p_token_hash
$function$;

CREATE OR REPLACE FUNCTION platform_admin.complete_workshop_activation(
  p_token_hash text, p_user_id text, p_password_hash text,
  p_session_hash text, p_session_expires_at bigint, p_audit_id text
) RETURNS TABLE(activated boolean, account_created boolean, tenant_id text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $function$
DECLARE
  v_invite platform_admin.workshop_activation_invites%ROWTYPE;
  v_workshop platform_admin.workshops%ROWTYPE;
  v_user_id text;
  v_membership_role text;
  v_account_created boolean := false;
  v_now timestamptz := clock_timestamp();
BEGIN
  SELECT * INTO v_invite FROM platform_admin.workshop_activation_invites
    WHERE token_hash=p_token_hash FOR UPDATE;
  IF NOT FOUND OR v_invite.used_at IS NOT NULL OR v_invite.revoked_at IS NOT NULL
     OR v_invite.expires_at <= v_now THEN
    RETURN QUERY SELECT false, false, NULL::text;
    RETURN;
  END IF;

  SELECT w.* INTO v_workshop FROM platform_admin.workshops AS w
    WHERE w.tenant_id=v_invite.tenant_id FOR UPDATE;
  IF NOT FOUND OR v_workshop.source NOT IN ('admin','self_service') OR v_workshop.status <> 'pending_verification'
     OR v_workshop.email_verified_at IS NOT NULL OR v_workshop.trial_started_at IS NOT NULL
     OR lower(v_workshop.responsible_email) <> lower(v_invite.responsible_email) THEN
    RETURN QUERY SELECT false, false, NULL::text;
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(lower(v_invite.responsible_email), 2089));
  SELECT u.id INTO v_user_id FROM horse_power.users u
    WHERE lower(u.email)=lower(v_invite.responsible_email) FOR UPDATE;
  IF NOT FOUND THEN
    IF p_user_id !~ '^[0-9a-fA-F-]{36}$' OR length(p_password_hash) NOT BETWEEN 100 AND 300 THEN
      RAISE EXCEPTION 'Invalid activation identity' USING ERRCODE='22023';
    END IF;
    INSERT INTO horse_power.users(id,name,email,password_hash)
      VALUES(p_user_id,v_workshop.responsible_name,lower(v_invite.responsible_email),p_password_hash);
    v_user_id := p_user_id;
    v_account_created := true;
  END IF;

  SELECT m.role INTO v_membership_role FROM horse_power.memberships m
    WHERE m.user_id=v_user_id AND m.tenant_id=v_workshop.tenant_id FOR UPDATE;
  IF v_membership_role IS NOT NULL AND v_membership_role <> 'owner' THEN
    RAISE EXCEPTION 'Identity already has a non-owner membership' USING ERRCODE='23505';
  END IF;
  IF v_membership_role IS NULL THEN
    INSERT INTO horse_power.memberships(user_id,tenant_id,role)
      VALUES(v_user_id,v_workshop.tenant_id,'owner');
  END IF;

  UPDATE platform_admin.workshops AS w SET status='trial', email_verified_at=v_now,
    trial_started_at=v_now, trial_ends_at=v_now+interval '14 days',
    status_reason='E-mail confirmado; teste grátis iniciado por 14 dias.', updated_at=v_now
    WHERE w.tenant_id=v_workshop.tenant_id;
  UPDATE platform_admin.workshop_activation_invites
    SET used_at=v_now, delivery_status='used' WHERE id=v_invite.id;
  UPDATE platform_admin.workshop_activation_invites AS i
    SET revoked_at=v_now, delivery_status='revoked'
    WHERE i.tenant_id=v_workshop.tenant_id AND i.id<>v_invite.id
      AND i.used_at IS NULL AND i.revoked_at IS NULL;

  IF v_account_created AND p_session_hash ~ '^[a-f0-9]{64}$' THEN
    INSERT INTO horse_power.sessions(token_hash,user_id,tenant_id,expires_at)
      VALUES(p_session_hash,v_user_id,v_workshop.tenant_id,p_session_expires_at);
  END IF;

  INSERT INTO platform_admin.audit_events(
    id,actor_administrator_id,subject_tenant_id,actor_email,action,result,technical_context
  ) VALUES (
    p_audit_id,NULL,v_workshop.tenant_id,v_invite.responsible_email,
    'workshop.activation.completed','success',
    jsonb_build_object('trial_days',14,'owner_account_created',v_account_created)
  );
  RETURN QUERY SELECT true, v_account_created, v_workshop.tenant_id;
END
$function$;

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
  v_trial_active:=coalesce(v_status='trial' AND v_trial_end>statement_timestamp(),false) AND NOT EXISTS(SELECT 1 FROM platform_admin.stripe_accounts WHERE tenant_id=p_tenant_id AND managed);
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
    'user_count',horse_power.workshop_occupied_seats(p_tenant_id));
END
$function$;

CREATE OR REPLACE FUNCTION horse_power.local_tenant_access_state(p_tenant_id text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $function$
 SELECT coalesce((SELECT CASE
   WHEN w.status IN ('pending_verification','blocked','archived','read_only') THEN w.status
   WHEN a.managed AND (a.paid_until IS NULL OR a.paid_until<(statement_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date)
     AND a.due_on<(statement_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date THEN 'read_only'
   WHEN a.managed AND a.paid_until>=(statement_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date THEN 'active'
   WHEN w.status='trial' AND w.trial_ends_at>statement_timestamp() THEN 'trial'
   WHEN w.status='trial' AND w.trial_ends_at<=statement_timestamp() THEN 'read_only'
   ELSE w.status END
 FROM platform_admin.workshops w LEFT JOIN platform_admin.stripe_accounts a ON a.tenant_id=w.tenant_id WHERE w.tenant_id=p_tenant_id),'legacy')
$function$;
