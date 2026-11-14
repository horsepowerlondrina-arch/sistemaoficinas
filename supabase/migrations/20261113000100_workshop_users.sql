SET search_path=horse_power,pg_catalog;
CREATE TABLE workshop_user_access (
 tenant_id TEXT NOT NULL, user_id TEXT NOT NULL,
 profile TEXT NOT NULL CHECK(profile IN ('master','manager','advisor','mechanic','finance')),
 active BIGINT NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
 permissions TEXT NOT NULL DEFAULT '{}', order_scope TEXT NOT NULL DEFAULT 'all' CHECK(order_scope IN ('all','assigned')),
 discount_bps BIGINT NOT NULL DEFAULT 0 CHECK(discount_bps BETWEEN 0 AND 10000),
 discount_cents BIGINT CHECK(discount_cents>=0),
 PRIMARY KEY(tenant_id,user_id), FOREIGN KEY(user_id,tenant_id) REFERENCES memberships(user_id,tenant_id) ON DELETE CASCADE
);
INSERT INTO workshop_user_access(tenant_id,user_id,profile,discount_bps)
 SELECT tenant_id,user_id,CASE WHEN role='owner' THEN 'master' ELSE 'mechanic' END,CASE WHEN role='owner' THEN 10000 ELSE 0 END FROM memberships;
CREATE TABLE staff_accounts (
 tenant_id TEXT NOT NULL, professional_id TEXT NOT NULL, user_id TEXT,
 productive BIGINT NOT NULL DEFAULT 1 CHECK(productive IN (0,1)),
 PRIMARY KEY(tenant_id,professional_id), UNIQUE(tenant_id,user_id),
 FOREIGN KEY(tenant_id,professional_id) REFERENCES professionals(tenant_id,id),
 FOREIGN KEY(user_id,tenant_id) REFERENCES memberships(user_id,tenant_id) ON DELETE CASCADE
);
CREATE TABLE workshop_user_invites (
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL REFERENCES tenants(id),email TEXT NOT NULL,
 profile TEXT NOT NULL CHECK(profile IN ('master','manager','advisor','mechanic','finance')),
 permissions TEXT NOT NULL DEFAULT '{}',order_scope TEXT NOT NULL DEFAULT 'all' CHECK(order_scope IN ('all','assigned')),
 discount_bps BIGINT NOT NULL DEFAULT 0 CHECK(discount_bps BETWEEN 0 AND 10000), discount_cents BIGINT CHECK(discount_cents>=0),
 professional_id TEXT,token_hash TEXT NOT NULL UNIQUE,created_by TEXT NOT NULL REFERENCES users(id),
 created_at BIGINT NOT NULL,expires_at BIGINT NOT NULL,revoked_at BIGINT,accepted_at BIGINT,
 FOREIGN KEY(tenant_id,professional_id) REFERENCES professionals(tenant_id,id)
);
CREATE INDEX workshop_invites_pending ON workshop_user_invites(tenant_id,email,expires_at);
CREATE TABLE session_reauthentication(token_hash TEXT PRIMARY KEY REFERENCES sessions(token_hash) ON DELETE CASCADE,authenticated_at BIGINT NOT NULL);
CREATE TABLE order_assignments (
 tenant_id TEXT NOT NULL,order_id TEXT NOT NULL,professional_id TEXT NOT NULL,assigned_by TEXT NOT NULL REFERENCES users(id),assigned_at BIGINT NOT NULL,removed_at BIGINT,
 PRIMARY KEY(tenant_id,order_id,professional_id),
 FOREIGN KEY(tenant_id,order_id) REFERENCES orders(tenant_id,id),FOREIGN KEY(tenant_id,professional_id) REFERENCES professionals(tenant_id,id)
);
CREATE TABLE discount_requests (
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,order_id TEXT NOT NULL,requester_id TEXT NOT NULL REFERENCES users(id),
 subtotal BIGINT NOT NULL CHECK(subtotal>=0),discount BIGINT NOT NULL CHECK(discount>=0),state_digest TEXT NOT NULL,
 justification TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','invalidated')),
 created_at BIGINT NOT NULL,decided_by TEXT REFERENCES users(id),decided_at BIGINT,decision_reason TEXT,
 FOREIGN KEY(tenant_id,order_id) REFERENCES orders(tenant_id,id)
);
CREATE TABLE session_office_choices(token_hash TEXT PRIMARY KEY REFERENCES sessions(token_hash) ON DELETE CASCADE,confirmed BIGINT NOT NULL DEFAULT 0 CHECK(confirmed IN (0,1)));
INSERT INTO horse_power.migrations(version) VALUES(33) ON CONFLICT DO NOTHING;

CREATE FUNCTION horse_power.workshop_is_master() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM horse_power.memberships m
 LEFT JOIN horse_power.workshop_user_access a ON a.tenant_id=m.tenant_id AND a.user_id=m.user_id
 WHERE m.tenant_id=nullif(current_setting('app.tenant_id',true),'')
 AND m.user_id=nullif(current_setting('app.user_id',true),'') AND m.role='owner' AND coalesce(a.active,1)=1);
$$;
REVOKE ALL ON FUNCTION horse_power.workshop_is_master() FROM PUBLIC;
CREATE FUNCTION horse_power.workshop_user_directory() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NOT horse_power.workshop_is_master() THEN RAISE EXCEPTION 'Acesso não autorizado' USING ERRCODE='42501'; END IF;
 RETURN (SELECT coalesce(jsonb_agg(jsonb_build_object('user_id',m.user_id,'name',u.name,'email',u.email,'role',m.role,
 'profile',CASE WHEN m.role='owner' THEN 'master' WHEN a.profile='master' THEN 'mechanic' ELSE coalesce(a.profile,'mechanic') END,
 'active',coalesce(a.active,1),'permissions',coalesce(a.permissions,'{}'),'order_scope',coalesce(a.order_scope,'all'),
 'discount_bps',coalesce(a.discount_bps,CASE WHEN m.role='owner' THEN 10000 ELSE 0 END),'discount_cents',a.discount_cents)
 ORDER BY lower(u.name)),'[]'::jsonb)
 FROM horse_power.memberships m JOIN horse_power.users u ON u.id=m.user_id
 LEFT JOIN horse_power.workshop_user_access a ON a.tenant_id=m.tenant_id AND a.user_id=m.user_id
 WHERE m.tenant_id=nullif(current_setting('app.tenant_id',true),''));
END $$;
REVOKE ALL ON FUNCTION horse_power.workshop_user_directory() FROM PUBLIC;
CREATE FUNCTION horse_power.workshop_user_capacity() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE t text; max_users integer; used integer; pending integer;
BEGIN
 IF NOT horse_power.workshop_is_master() THEN RAISE EXCEPTION 'Acesso não autorizado' USING ERRCODE='42501'; END IF;
 t:=nullif(current_setting('app.tenant_id',true),'');
 max_users:=nullif(platform_admin.effective_workshop_entitlements(t)->>'max_users','')::integer;
 SELECT count(*) INTO used FROM horse_power.memberships m LEFT JOIN horse_power.workshop_user_access a
 ON a.tenant_id=m.tenant_id AND a.user_id=m.user_id WHERE m.tenant_id=t AND coalesce(a.active,1)=1;
 SELECT count(*) INTO pending FROM horse_power.workshop_user_invites i WHERE i.tenant_id=t
 AND i.revoked_at IS NULL AND i.accepted_at IS NULL AND i.expires_at>(extract(epoch FROM clock_timestamp())*1000)::bigint;
 RETURN jsonb_build_object('limit',max_users,'active',used,'pending',pending,'available',CASE WHEN max_users IS NULL THEN NULL ELSE greatest(0,max_users-used-pending) END);
END $$;
REVOKE ALL ON FUNCTION horse_power.workshop_user_capacity() FROM PUBLIC;
DO $policies$
DECLARE r text; t text; scope text;
BEGIN
 FOR t IN SELECT unnest(ARRAY['workshop_user_access','staff_accounts','workshop_user_invites','session_reauthentication','order_assignments','discount_requests','session_office_choices']) LOOP
  EXECUTE format('ALTER TABLE horse_power.%I ENABLE ROW LEVEL SECURITY',t);
 END LOOP;
 FOR r IN SELECT rolname FROM pg_roles WHERE rolname IN ('hp_local_app','horse_power_app') LOOP
  EXECUTE format('GRANT EXECUTE ON FUNCTION horse_power.workshop_is_master(),horse_power.workshop_user_directory(),horse_power.workshop_user_capacity() TO %I',r);
  FOR t IN SELECT unnest(ARRAY['workshop_user_access','staff_accounts','workshop_user_invites','order_assignments','discount_requests']) LOOP
   EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON horse_power.%I TO %I',t,r);
   scope:='tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')';
   IF t='workshop_user_access' THEN EXECUTE format('CREATE POLICY %I ON horse_power.%I FOR SELECT TO %I USING(user_id=nullif(current_setting(''app.user_id'',true),'''') OR (tenant_id=nullif(current_setting(''app.tenant_id'',true),'''') AND horse_power.workshop_is_master()))',r||'_read',t,r); ELSE
   IF t='workshop_user_invites' THEN scope:=scope||' AND horse_power.workshop_is_master()'; END IF;
   EXECUTE format('CREATE POLICY %I ON horse_power.%I FOR SELECT TO %I USING(%s)',r||'_read',t,r,scope); END IF;
   IF t IN ('workshop_user_access','workshop_user_invites') THEN scope:=scope||' AND horse_power.workshop_is_master()'; END IF;
   EXECUTE format('CREATE POLICY %I ON horse_power.%I FOR ALL TO %I USING(%s) WITH CHECK(%s)',r||'_write',t,r,scope,scope);
  END LOOP;
  EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON horse_power.session_office_choices TO %I',r);
  EXECUTE format('CREATE POLICY %I ON horse_power.session_office_choices TO %I USING(token_hash=nullif(current_setting(''app.session_hash'',true),'''')) WITH CHECK(token_hash=nullif(current_setting(''app.session_hash'',true),''''))',r||'_choice',r);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON horse_power.session_reauthentication TO %I',r);
  EXECUTE format('CREATE POLICY %I ON horse_power.session_reauthentication TO %I USING(token_hash=nullif(current_setting(''app.session_hash'',true),'''')) WITH CHECK(token_hash=nullif(current_setting(''app.session_hash'',true),''''))',r||'_session',r);
 END LOOP;
END $policies$;

CREATE FUNCTION horse_power.workshop_revoke_sessions(p_user text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NOT horse_power.workshop_is_master() THEN RAISE EXCEPTION 'Acesso não autorizado' USING ERRCODE='42501'; END IF;
 DELETE FROM horse_power.sessions WHERE tenant_id=nullif(current_setting('app.tenant_id',true),'') AND user_id=p_user;
END $$;
REVOKE ALL ON FUNCTION horse_power.workshop_revoke_sessions(text) FROM PUBLIC;
CREATE FUNCTION horse_power.employee_invite_info(p_hash text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('email',i.email,'workshop_name',t.name,'account_exists',EXISTS(SELECT 1 FROM horse_power.users u WHERE lower(u.email)=i.email))
 FROM horse_power.workshop_user_invites i JOIN horse_power.tenants t ON t.id=i.tenant_id
 WHERE i.token_hash=p_hash AND i.accepted_at IS NULL AND i.revoked_at IS NULL
 AND i.expires_at>(extract(epoch FROM statement_timestamp())*1000)::bigint;
$$;
REVOKE ALL ON FUNCTION horse_power.employee_invite_info(text) FROM PUBLIC;
CREATE FUNCTION horse_power.accept_employee_invite(p_hash text,p_session text,p_name text,p_password_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE i horse_power.workshop_user_invites; u text; now_ms bigint; new_id text;
BEGIN
 SELECT * INTO i FROM horse_power.workshop_user_invites WHERE token_hash=p_hash;
 IF NOT FOUND THEN RAISE EXCEPTION 'Convite inválido' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(i.tenant_id,104730));
 SELECT * INTO i FROM horse_power.workshop_user_invites WHERE token_hash=p_hash FOR UPDATE;
 now_ms:=(extract(epoch FROM clock_timestamp())*1000)::bigint;
 IF NOT FOUND OR i.accepted_at IS NOT NULL OR i.revoked_at IS NOT NULL OR i.expires_at<=now_ms THEN RAISE EXCEPTION 'Convite inválido ou expirado' USING ERRCODE='22023'; END IF;
 -- Serialize creation of the same global account from different workshops.
 PERFORM pg_advisory_xact_lock(hashtextextended(i.email,104731));
 SELECT id INTO u FROM horse_power.users WHERE lower(email)=i.email;
 IF u IS NOT NULL THEN
  IF NOT EXISTS(SELECT 1 FROM horse_power.sessions WHERE token_hash=p_session AND user_id=u AND expires_at>now_ms) AND NOT EXISTS(SELECT 1 FROM horse_power.users WHERE id=u AND password_hash=p_password_hash) THEN RAISE EXCEPTION 'Entre com a conta convidada' USING ERRCODE='42501'; END IF;
 ELSE
  IF length(trim(p_name)) NOT BETWEEN 2 AND 150 OR p_password_hash !~ '^[0-9a-f]{32}:[0-9a-f]{128}$' THEN RAISE EXCEPTION 'Ativação inválida' USING ERRCODE='22023'; END IF;
  u:=gen_random_uuid()::text;
  INSERT INTO horse_power.users(id,name,email,password_hash) VALUES(u,trim(p_name),i.email,p_password_hash);
 END IF;
 IF EXISTS(SELECT 1 FROM horse_power.memberships WHERE tenant_id=i.tenant_id AND user_id=u) THEN RAISE EXCEPTION 'Conta já vinculada' USING ERRCODE='23505'; END IF;
 UPDATE horse_power.workshop_user_invites SET accepted_at=now_ms WHERE id=i.id;
 INSERT INTO horse_power.memberships(user_id,tenant_id,role) VALUES(u,i.tenant_id,CASE WHEN i.profile='master' THEN 'owner' ELSE 'operator' END);
 INSERT INTO horse_power.workshop_user_access(tenant_id,user_id,profile,permissions,order_scope,discount_bps,discount_cents)
 VALUES(i.tenant_id,u,i.profile,i.permissions,i.order_scope,CASE WHEN i.profile='master' THEN 10000 ELSE i.discount_bps END,CASE WHEN i.profile='master' THEN NULL ELSE i.discount_cents END);
 IF i.professional_id IS NOT NULL THEN
  IF EXISTS(SELECT 1 FROM horse_power.staff_accounts WHERE tenant_id=i.tenant_id AND professional_id=i.professional_id AND user_id IS NOT NULL) THEN RAISE EXCEPTION 'Funcionário já vinculado' USING ERRCODE='23514'; END IF;
  IF NOT EXISTS(SELECT 1 FROM horse_power.professionals WHERE tenant_id=i.tenant_id AND id=i.professional_id AND active=1) THEN RAISE EXCEPTION 'Funcionário inativo' USING ERRCODE='23514'; END IF;
  INSERT INTO horse_power.staff_accounts(tenant_id,professional_id,user_id) VALUES(i.tenant_id,i.professional_id,u)
  ON CONFLICT(tenant_id,professional_id) DO UPDATE SET user_id=excluded.user_id;
 END IF;
 INSERT INTO horse_power.audit_events(id,tenant_id,user_id,action,entity_id) VALUES(gen_random_uuid()::text,i.tenant_id,u,'users.invite_accepted',i.id);
 RETURN jsonb_build_object('ok',true);
END $$;
REVOKE ALL ON FUNCTION horse_power.accept_employee_invite(text,text,text,text) FROM PUBLIC;

CREATE FUNCTION horse_power.guard_workshop_membership() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE t text; uid text; capacity integer; used integer; pending integer;
BEGIN
 t:=CASE WHEN TG_OP='DELETE' THEN OLD.tenant_id ELSE NEW.tenant_id END;
 uid:=CASE WHEN TG_OP='DELETE' THEN OLD.user_id ELSE NEW.user_id END;
 PERFORM pg_advisory_xact_lock(hashtextextended(t,104730));
 IF TG_OP='DELETE' OR (TG_OP='UPDATE' AND OLD.role='owner' AND NEW.role<>'owner') THEN
  IF OLD.role='owner' AND uid=nullif(current_setting('app.user_id',true),'') THEN RAISE EXCEPTION 'Não pode remover o próprio acesso Master' USING ERRCODE='42501'; END IF;
  IF OLD.role='owner' AND NOT EXISTS(SELECT 1 FROM horse_power.memberships m LEFT JOIN horse_power.workshop_user_access a ON a.tenant_id=m.tenant_id AND a.user_id=m.user_id WHERE m.tenant_id=t AND m.user_id<>uid AND m.role='owner' AND coalesce(a.active,1)=1) THEN RAISE EXCEPTION 'Último Master protegido' USING ERRCODE='23514'; END IF;
 END IF;
 IF TG_OP='INSERT' THEN
  capacity:=nullif(platform_admin.effective_workshop_entitlements(t)->>'max_users','')::integer;
  SELECT count(*) INTO used FROM horse_power.memberships m LEFT JOIN horse_power.workshop_user_access a ON a.tenant_id=m.tenant_id AND a.user_id=m.user_id WHERE m.tenant_id=t AND coalesce(a.active,1)=1;
  SELECT count(*) INTO pending FROM horse_power.workshop_user_invites WHERE tenant_id=t AND revoked_at IS NULL AND accepted_at IS NULL AND expires_at>(extract(epoch FROM clock_timestamp())*1000)::bigint;
  IF capacity IS NOT NULL AND used+pending>=capacity THEN RAISE EXCEPTION 'Limite de usuários atingido' USING ERRCODE='23514'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
DROP TRIGGER workshop_user_limit_before_insert ON horse_power.memberships;
CREATE TRIGGER ops004_membership_guard BEFORE INSERT OR UPDATE OF role OR DELETE ON horse_power.memberships FOR EACH ROW EXECUTE FUNCTION horse_power.guard_workshop_membership();

CREATE FUNCTION horse_power.guard_workshop_access() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE limit_n integer; total_n integer;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.tenant_id,104730));
 IF NEW.active=0 AND (TG_OP='INSERT' OR OLD.active=1) AND EXISTS(SELECT 1 FROM horse_power.memberships WHERE tenant_id=NEW.tenant_id AND user_id=NEW.user_id AND role='owner') THEN
  IF NEW.user_id=nullif(current_setting('app.user_id',true),'') THEN RAISE EXCEPTION 'Não pode desativar o próprio Master' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM horse_power.memberships m LEFT JOIN horse_power.workshop_user_access a ON a.tenant_id=m.tenant_id AND a.user_id=m.user_id WHERE m.tenant_id=NEW.tenant_id AND m.user_id<>NEW.user_id AND m.role='owner' AND coalesce(a.active,1)=1) THEN RAISE EXCEPTION 'Último Master protegido' USING ERRCODE='23514'; END IF;
 END IF;
 IF TG_OP='UPDATE' AND OLD.active=0 AND NEW.active=1 THEN
  limit_n:=nullif(platform_admin.effective_workshop_entitlements(NEW.tenant_id)->>'max_users','')::integer;
  SELECT count(*) INTO total_n FROM horse_power.memberships m LEFT JOIN horse_power.workshop_user_access a ON a.tenant_id=m.tenant_id AND a.user_id=m.user_id WHERE m.tenant_id=NEW.tenant_id AND coalesce(a.active,1)=1;
  total_n:=total_n+(SELECT count(*) FROM horse_power.workshop_user_invites WHERE tenant_id=NEW.tenant_id AND revoked_at IS NULL AND accepted_at IS NULL AND expires_at>(extract(epoch FROM clock_timestamp())*1000)::bigint);
  IF limit_n IS NOT NULL AND total_n>=limit_n THEN RAISE EXCEPTION 'Limite de usuários atingido' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.active=0 THEN DELETE FROM horse_power.sessions WHERE tenant_id=NEW.tenant_id AND user_id=NEW.user_id; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ops004_access_guard BEFORE INSERT OR UPDATE ON horse_power.workshop_user_access FOR EACH ROW EXECUTE FUNCTION horse_power.guard_workshop_access();

CREATE FUNCTION horse_power.guard_employee_invite() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE limit_n integer; used integer;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.tenant_id,104730));
 IF NEW.revoked_at IS NULL AND NEW.accepted_at IS NULL AND NEW.expires_at>(extract(epoch FROM clock_timestamp())*1000)::bigint THEN
  limit_n:=nullif(platform_admin.effective_workshop_entitlements(NEW.tenant_id)->>'max_users','')::integer;
  SELECT count(*) INTO used FROM horse_power.memberships m LEFT JOIN horse_power.workshop_user_access a ON a.tenant_id=m.tenant_id AND a.user_id=m.user_id WHERE m.tenant_id=NEW.tenant_id AND coalesce(a.active,1)=1;
  used:=used+(SELECT count(*) FROM horse_power.workshop_user_invites WHERE tenant_id=NEW.tenant_id AND id<>NEW.id AND revoked_at IS NULL AND accepted_at IS NULL AND expires_at>(extract(epoch FROM clock_timestamp())*1000)::bigint);
  IF limit_n IS NOT NULL AND used>=limit_n THEN RAISE EXCEPTION 'Limite de usuários atingido' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ops004_invite_guard BEFORE INSERT OR UPDATE ON horse_power.workshop_user_invites FOR EACH ROW EXECUTE FUNCTION horse_power.guard_employee_invite();
DO $grants$ DECLARE r text; BEGIN
 FOR r IN SELECT rolname FROM pg_roles WHERE rolname IN ('horse_power_app','hp_local_app') LOOP
  EXECUTE format('GRANT EXECUTE ON FUNCTION horse_power.workshop_revoke_sessions(text),horse_power.employee_invite_info(text),horse_power.accept_employee_invite(text,text,text,text) TO %I',r);
  EXECUTE format('GRANT UPDATE(role) ON horse_power.memberships TO %I',r);
  EXECUTE format('CREATE POLICY %I ON horse_power.memberships FOR SELECT TO %I USING(tenant_id=nullif(current_setting(''app.tenant_id'',true),'''') AND horse_power.workshop_is_master())',r||'_master_read',r);
  EXECUTE format('CREATE POLICY %I ON horse_power.memberships FOR UPDATE TO %I USING(tenant_id=nullif(current_setting(''app.tenant_id'',true),'''') AND horse_power.workshop_is_master()) WITH CHECK(tenant_id=nullif(current_setting(''app.tenant_id'',true),'''') AND horse_power.workshop_is_master())',r||'_master_update',r);
 END LOOP;
END $grants$;
CREATE TABLE horse_power.user_access_attempts(key text PRIMARY KEY,attempts integer NOT NULL,until_at bigint NOT NULL);
ALTER TABLE horse_power.user_access_attempts ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION horse_power.record_user_access_attempt(p_key text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE n integer; now_ms bigint;
BEGIN
 IF p_key !~ '^[a-f0-9]{64}$' THEN RETURN false; END IF;
 now_ms:=(extract(epoch FROM clock_timestamp())*1000)::bigint;
 INSERT INTO horse_power.user_access_attempts(key,attempts,until_at) VALUES(p_key,1,now_ms+300000)
 ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN horse_power.user_access_attempts.until_at<now_ms THEN 1 ELSE horse_power.user_access_attempts.attempts+1 END,until_at=CASE WHEN horse_power.user_access_attempts.until_at<now_ms THEN now_ms+300000 ELSE horse_power.user_access_attempts.until_at END RETURNING attempts INTO n;
 DELETE FROM horse_power.user_access_attempts WHERE until_at<now_ms-86400000;
 RETURN n<=10;
END $$;
REVOKE ALL ON FUNCTION horse_power.record_user_access_attempt(text) FROM PUBLIC;
CREATE FUNCTION horse_power.employee_invite_account(p_hash text) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('password_hash',u.password_hash) FROM horse_power.workshop_user_invites i JOIN horse_power.users u ON lower(u.email)=i.email WHERE i.token_hash=p_hash AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at>(extract(epoch FROM statement_timestamp())*1000)::bigint;
$$;
REVOKE ALL ON FUNCTION horse_power.employee_invite_account(text) FROM PUBLIC;
DO $grants$ DECLARE r text; BEGIN FOR r IN SELECT rolname FROM pg_roles WHERE rolname IN ('horse_power_app','hp_local_app') LOOP
 EXECUTE format('GRANT EXECUTE ON FUNCTION horse_power.record_user_access_attempt(text),horse_power.employee_invite_account(text) TO %I',r);
END LOOP; END $grants$;

CREATE FUNCTION horse_power.workshop_occupied_seats(p_tenant text) RETURNS bigint
LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT (SELECT count(*) FROM horse_power.memberships m LEFT JOIN horse_power.workshop_user_access a ON a.tenant_id=m.tenant_id AND a.user_id=m.user_id WHERE m.tenant_id=p_tenant AND coalesce(a.active,1)=1)
 +(SELECT count(*) FROM horse_power.workshop_user_invites WHERE tenant_id=p_tenant AND revoked_at IS NULL AND accepted_at IS NULL AND expires_at>(extract(epoch FROM statement_timestamp())*1000)::bigint);
$$;
REVOKE ALL ON FUNCTION horse_power.workshop_occupied_seats(text) FROM PUBLIC;
DO $compat$ DECLARE definition text; original text; BEGIN
 original:=pg_get_functiondef('platform_admin.effective_workshop_entitlements(text)'::regprocedure);
 definition:=replace(original,'''user_count'',(SELECT count(*) FROM horse_power.memberships m WHERE m.tenant_id=p_tenant_id)','''user_count'',horse_power.workshop_occupied_seats(p_tenant_id)');
 IF definition=original THEN RAISE EXCEPTION 'Contagem de vagas incompatível com a migração OPS-004'; END IF;
 EXECUTE definition;
 original:=pg_get_functiondef('platform_admin.manage_workshop_membership(text,text,text,text,text,text)'::regprocedure);
 definition:=replace(original,'IF p_action=''remove'' THEN DELETE FROM horse_power.memberships','IF p_action=''remove'' THEN DELETE FROM horse_power.sessions WHERE tenant_id=p_tenant_id AND user_id=p_user_id; DELETE FROM horse_power.memberships');
 IF definition=original THEN RAISE EXCEPTION 'Gestão administrativa incompatível com OPS-004'; END IF;
 EXECUTE definition;
END $compat$;

REVOKE ALL ON FUNCTION horse_power.guard_workshop_membership(),horse_power.guard_workshop_access(),horse_power.guard_employee_invite() FROM PUBLIC;

-- Assignment scope also constrains SQL reads; empty identities retain only the
-- pre-existing public-share/service policies, never a new grant.
CREATE FUNCTION horse_power.workshop_order_visible(p_tenant text,p_order text) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE uid text; scope text; active_state bigint; member_role text;
BEGIN
 uid:=nullif(current_setting('app.user_id',true),'');
 IF uid IS NULL THEN RETURN true; END IF;
 SELECT m.role,coalesce(a.order_scope,'all'),coalesce(a.active,1) INTO member_role,scope,active_state
 FROM horse_power.memberships m LEFT JOIN horse_power.workshop_user_access a ON a.tenant_id=m.tenant_id AND a.user_id=m.user_id WHERE m.tenant_id=p_tenant AND m.user_id=uid;
 IF NOT FOUND OR active_state<>1 THEN RETURN false; END IF;
 IF member_role='owner' OR scope='all' THEN RETURN true; END IF;
 RETURN EXISTS(SELECT 1 FROM horse_power.order_assignments a JOIN horse_power.staff_accounts s ON s.tenant_id=a.tenant_id AND s.professional_id=a.professional_id WHERE a.tenant_id=p_tenant AND a.order_id=p_order AND s.user_id=uid AND a.removed_at IS NULL);
END $$;
REVOKE ALL ON FUNCTION horse_power.workshop_order_visible(text,text) FROM PUBLIC;
CREATE FUNCTION horse_power.workshop_document_visible(p_tenant text,p_kind text,p_id text) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE oid text;
BEGIN
 IF p_kind='order' THEN RETURN horse_power.workshop_order_visible(p_tenant,p_id); END IF;
 SELECT order_id INTO oid FROM horse_power.checklists WHERE tenant_id=p_tenant AND id=p_id;
 RETURN horse_power.workshop_order_visible(p_tenant,oid);
END $$;
REVOKE ALL ON FUNCTION horse_power.workshop_document_visible(text,text,text) FROM PUBLIC;
DO $scope$ DECLARE r text; t text; expression text; BEGIN
 FOR r IN SELECT rolname FROM pg_roles WHERE rolname IN ('horse_power_app','hp_local_app') LOOP
  EXECUTE format('GRANT EXECUTE ON FUNCTION horse_power.workshop_order_visible(text,text),horse_power.workshop_document_visible(text,text,text) TO %I',r);
  FOR t IN SELECT unnest(ARRAY['orders','order_items','receivables','checklists','checklist_photos','document_revisions','discount_requests']) LOOP
   expression:=CASE WHEN t='orders' THEN 'horse_power.workshop_order_visible(tenant_id,id)'
    WHEN t='checklists' THEN 'horse_power.workshop_document_visible(tenant_id,''checklist'',id)'
    WHEN t='checklist_photos' THEN 'horse_power.workshop_document_visible(tenant_id,''checklist'',checklist_id)'
    WHEN t='document_revisions' THEN 'horse_power.workshop_document_visible(tenant_id,kind,entity_id)'
    ELSE 'horse_power.workshop_order_visible(tenant_id,order_id)' END;
   EXECUTE format('CREATE POLICY %I ON horse_power.%I AS RESTRICTIVE FOR SELECT TO %I USING(%s)',r||'_ops004_scope',t,r,expression);
  END LOOP;
 END LOOP;
END $scope$;
