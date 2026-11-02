-- Password recovery for operational workshop accounts only.
-- Private tables remain inaccessible to Data API and the runtime role.
CREATE TABLE horse_power.password_reset_tokens (
  token_hash text PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  user_id text NOT NULL REFERENCES horse_power.users(id),
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  revoked_at timestamptz
);
CREATE INDEX password_reset_tokens_user_created ON horse_power.password_reset_tokens(user_id,created_at DESC);
ALTER TABLE horse_power.password_reset_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON horse_power.password_reset_tokens FROM PUBLIC,horse_power_app;

CREATE TABLE horse_power.password_reset_attempts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email_hash text NOT NULL CHECK (email_hash ~ '^[0-9a-f]{64}$'),
  ip_hash text NOT NULL CHECK (ip_hash ~ '^[0-9a-f]{64}$'),
  requested_at timestamptz NOT NULL DEFAULT statement_timestamp()
);
CREATE INDEX password_reset_attempts_email_time ON horse_power.password_reset_attempts(email_hash,requested_at DESC);
CREATE INDEX password_reset_attempts_ip_time ON horse_power.password_reset_attempts(ip_hash,requested_at DESC);
ALTER TABLE horse_power.password_reset_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON horse_power.password_reset_attempts FROM PUBLIC,horse_power_app;

CREATE FUNCTION horse_power.issue_password_reset(p_email text,p_ip_hash text,p_token_hash text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $function$
DECLARE v_email text; v_user_id text; v_email_hash text; v_now timestamptz:=statement_timestamp();
BEGIN
  IF p_email IS NULL OR length(p_email) NOT BETWEEN 3 AND 254
    OR p_ip_hash !~ '^[0-9a-f]{64}$' OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Invalid password reset request' USING ERRCODE='22023';
  END IF;
  v_email_hash:=encode(sha256(convert_to(lower(trim(p_email)),'UTF8')),'hex');
  PERFORM pg_advisory_xact_lock(hashtextextended(p_ip_hash, 1201));
  PERFORM pg_advisory_xact_lock(hashtextextended(v_email_hash, 1202));
  DELETE FROM horse_power.password_reset_attempts WHERE requested_at < v_now - interval '1 day';
  IF (SELECT count(*) FROM horse_power.password_reset_attempts WHERE ip_hash=p_ip_hash AND requested_at>v_now-interval '1 hour')>=10
    OR (SELECT count(*) FROM horse_power.password_reset_attempts WHERE email_hash=v_email_hash AND requested_at>v_now-interval '1 hour')>=3 THEN
    RETURN NULL;
  END IF;
  INSERT INTO horse_power.password_reset_attempts(email_hash,ip_hash,requested_at)
    VALUES(v_email_hash,p_ip_hash,v_now);
  SELECT u.id,u.email INTO v_user_id,v_email FROM horse_power.users u
    WHERE lower(u.email)=lower(trim(p_email))
      AND EXISTS(SELECT 1 FROM horse_power.memberships m WHERE m.user_id=u.id)
    FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  INSERT INTO horse_power.password_reset_tokens(token_hash,user_id,created_at,expires_at)
    VALUES(p_token_hash,v_user_id,v_now,v_now+interval '30 minutes');
  RETURN v_email;
END $function$;

CREATE FUNCTION horse_power.cancel_password_reset(p_token_hash text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $function$
BEGIN
  IF p_token_hash !~ '^[0-9a-f]{64}$' THEN RETURN; END IF;
  UPDATE horse_power.password_reset_tokens SET revoked_at=statement_timestamp()
    WHERE token_hash=p_token_hash AND used_at IS NULL AND revoked_at IS NULL;
END $function$;

CREATE FUNCTION horse_power.complete_password_reset(p_token_hash text,p_password_hash text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $function$
DECLARE v_user_id text; v_token horse_power.password_reset_tokens%ROWTYPE; v_now timestamptz:=statement_timestamp();
BEGIN
  IF p_token_hash !~ '^[0-9a-f]{64}$'
    OR p_password_hash !~ '^[0-9a-f]{32}:[0-9a-f]{128}$' THEN
    RAISE EXCEPTION 'Invalid password reset input' USING ERRCODE='22023';
  END IF;
  SELECT user_id INTO v_user_id FROM horse_power.password_reset_tokens WHERE token_hash=p_token_hash;
  IF NOT FOUND THEN RETURN false; END IF;
  PERFORM 1 FROM horse_power.users WHERE id=v_user_id FOR UPDATE;
  SELECT * INTO v_token FROM horse_power.password_reset_tokens WHERE token_hash=p_token_hash FOR UPDATE;
  IF NOT FOUND OR v_token.used_at IS NOT NULL OR v_token.revoked_at IS NOT NULL OR v_token.expires_at<=v_now THEN
    RETURN false;
  END IF;
  UPDATE horse_power.users SET password_hash=p_password_hash WHERE id=v_user_id;
  DELETE FROM horse_power.sessions WHERE user_id=v_user_id;
  UPDATE horse_power.password_reset_tokens SET revoked_at=v_now
    WHERE user_id=v_user_id AND token_hash<>p_token_hash AND used_at IS NULL AND revoked_at IS NULL;
  UPDATE horse_power.password_reset_tokens SET used_at=v_now WHERE token_hash=p_token_hash;
  RETURN true;
END $function$;

REVOKE ALL ON FUNCTION horse_power.issue_password_reset(text,text,text),
  horse_power.cancel_password_reset(text),
  horse_power.complete_password_reset(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION horse_power.issue_password_reset(text,text,text),
  horse_power.cancel_password_reset(text),
  horse_power.complete_password_reset(text,text) TO horse_power_app;
