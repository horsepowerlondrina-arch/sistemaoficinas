-- ADM-002: local mirror of supabase/migrations/20261024100000_workshop_activation.sql.
CREATE TABLE platform_admin.workshop_activation_invites (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES platform_admin.workshops(tenant_id),
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  responsible_email text NOT NULL CHECK (length(trim(responsible_email)) BETWEEN 3 AND 254),
  created_by_admin_id text REFERENCES platform_admin.administrators(id),
  expires_at timestamptz NOT NULL,
  sent_at timestamptz,
  used_at timestamptz,
  revoked_at timestamptz,
  delivery_status text NOT NULL DEFAULT 'pending'
    CHECK (delivery_status IN ('pending','sent','failed','used','revoked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (used_at IS NULL OR revoked_at IS NULL)
);
CREATE INDEX workshop_activation_invites_tenant_created
  ON platform_admin.workshop_activation_invites(tenant_id, created_at DESC);
ALTER TABLE platform_admin.workshop_activation_invites ENABLE ROW LEVEL SECURITY;
CREATE POLICY workshop_activation_invites_backend_only
  ON platform_admin.workshop_activation_invites
  FOR ALL TO hp_platform_admin_app
  USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE ON platform_admin.workshop_activation_invites TO hp_platform_admin_app;

CREATE FUNCTION platform_admin.revoke_workshop_activation_invites_on_email_change()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $function$
BEGIN
  IF lower(OLD.responsible_email) <> lower(NEW.responsible_email) THEN
    UPDATE platform_admin.workshop_activation_invites
      SET revoked_at=clock_timestamp(), delivery_status='revoked'
      WHERE tenant_id=OLD.tenant_id AND used_at IS NULL AND revoked_at IS NULL;
  END IF;
  RETURN NEW;
END
$function$;
CREATE TRIGGER workshop_activation_invites_revoke_email_change
  BEFORE UPDATE OF responsible_email ON platform_admin.workshops
  FOR EACH ROW EXECUTE FUNCTION platform_admin.revoke_workshop_activation_invites_on_email_change();

CREATE FUNCTION platform_admin.inspect_workshop_activation(p_token_hash text)
RETURNS TABLE(valid boolean, workshop_name text, responsible_email text, expires_at timestamptz, account_exists boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $function$
  SELECT i.used_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > statement_timestamp()
       AND i.responsible_email=lower(w.responsible_email) AND w.source='admin'
       AND w.status='pending_verification' AND w.email_verified_at IS NULL
       AND w.trial_started_at IS NULL,
    CASE WHEN i.used_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > statement_timestamp()
          AND i.responsible_email=lower(w.responsible_email) AND w.source='admin'
          AND w.status='pending_verification' AND w.email_verified_at IS NULL
          AND w.trial_started_at IS NULL THEN w.name ELSE '' END,
    CASE WHEN i.used_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > statement_timestamp()
          AND i.responsible_email=lower(w.responsible_email) AND w.source='admin'
          AND w.status='pending_verification' AND w.email_verified_at IS NULL
          AND w.trial_started_at IS NULL THEN i.responsible_email ELSE '' END,
    i.expires_at,
    EXISTS (SELECT 1 FROM horse_power.users u WHERE lower(u.email)=lower(i.responsible_email))
  FROM platform_admin.workshop_activation_invites i
  JOIN platform_admin.workshops w ON w.tenant_id=i.tenant_id
  WHERE i.token_hash=p_token_hash
$function$;

CREATE FUNCTION platform_admin.complete_workshop_activation(
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
  IF NOT FOUND OR v_workshop.source <> 'admin' OR v_workshop.status <> 'pending_verification'
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

REVOKE ALL ON FUNCTION platform_admin.revoke_workshop_activation_invites_on_email_change() FROM PUBLIC, hp_local_app, hp_platform_admin_app;
REVOKE ALL ON FUNCTION platform_admin.inspect_workshop_activation(text) FROM PUBLIC, hp_local_app, hp_platform_admin_app;
REVOKE ALL ON FUNCTION platform_admin.complete_workshop_activation(text,text,text,text,bigint,text) FROM PUBLIC, hp_local_app, hp_platform_admin_app;
GRANT EXECUTE ON FUNCTION platform_admin.inspect_workshop_activation(text),
  platform_admin.complete_workshop_activation(text,text,text,text,bigint,text)
  TO hp_platform_admin_app;
