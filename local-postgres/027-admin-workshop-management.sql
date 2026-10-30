-- ADM-002 scoped workshop membership and lifecycle operations.
CREATE OR REPLACE FUNCTION platform_admin.workshop_member_directory(p_tenant_id text,p_session_token_hash text)
RETURNS TABLE(user_id text,name text,email text,role text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $function$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM platform_admin.sessions s JOIN platform_admin.administrators a ON a.id=s.administrator_id
  WHERE s.token_hash=p_session_token_hash AND s.expires_at>statement_timestamp() AND a.active AND a.enrolled AND a.permissions @> '["workshops:read"]'::jsonb)
 THEN RAISE EXCEPTION 'Permissão administrativa insuficiente' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM horse_power.tenants t WHERE t.id=p_tenant_id) THEN RAISE EXCEPTION 'Oficina não encontrada' USING ERRCODE='P0002'; END IF;
 RETURN QUERY SELECT u.id,u.name,u.email,m.role FROM horse_power.memberships m JOIN horse_power.users u ON u.id=m.user_id
 WHERE m.tenant_id=p_tenant_id ORDER BY (m.role='owner') DESC,lower(u.name),u.id;
END $function$;

CREATE OR REPLACE FUNCTION platform_admin.manage_workshop_membership(p_tenant_id text,p_session_token_hash text,p_user_id text,p_action text,p_role text,p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $function$
DECLARE admin_row record; member_row record; owners integer; new_role text; detail jsonb;
BEGIN
 SELECT a.id,a.email INTO admin_row FROM platform_admin.sessions s JOIN platform_admin.administrators a ON a.id=s.administrator_id
 WHERE s.token_hash=p_session_token_hash AND s.expires_at>statement_timestamp() AND a.active AND a.enrolled AND a.permissions @> '["workshops:manage"]'::jsonb;
 IF NOT FOUND THEN RAISE EXCEPTION 'Permissão administrativa insuficiente' USING ERRCODE='42501'; END IF;
 IF p_action NOT IN ('set_role','remove') OR (p_action='set_role' AND (p_role IS NULL OR p_role NOT IN ('owner','operator')))
   OR (p_action='remove' AND p_role IS NOT NULL) OR length(trim(coalesce(p_reason,''))) NOT BETWEEN 10 AND 500
 THEN RAISE EXCEPTION 'Operação ou justificativa inválida' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_tenant_id,104730));
 SELECT u.id,u.name,u.email,m.role INTO member_row FROM horse_power.memberships m JOIN horse_power.users u ON u.id=m.user_id
 WHERE m.tenant_id=p_tenant_id AND m.user_id=p_user_id FOR UPDATE OF m;
 IF NOT FOUND THEN RAISE EXCEPTION 'Vínculo da oficina não encontrado' USING ERRCODE='P0002'; END IF;
 IF member_row.role='owner' AND (p_action='remove' OR p_role='operator') THEN
  SELECT count(*) INTO owners FROM horse_power.memberships m WHERE m.tenant_id=p_tenant_id AND m.role='owner';
  IF owners<=1 THEN RAISE EXCEPTION 'A operação não pode remover o último proprietário' USING ERRCODE='23514'; END IF;
 END IF;
 IF p_action='remove' THEN DELETE FROM horse_power.memberships WHERE tenant_id=p_tenant_id AND user_id=p_user_id; new_role:=NULL;
 ELSE UPDATE horse_power.memberships SET role=p_role WHERE tenant_id=p_tenant_id AND user_id=p_user_id; new_role:=p_role; END IF;
 detail:=jsonb_build_object('user_id',member_row.id,'name',member_row.name,'email',member_row.email,'previous_role',member_row.role,'role',new_role,'action',p_action);
 INSERT INTO platform_admin.audit_events(id,actor_administrator_id,actor_email,subject_tenant_id,action,result,technical_context,created_at)
 VALUES(md5(clock_timestamp()::text||random()::text||p_tenant_id||p_user_id),admin_row.id,admin_row.email,p_tenant_id,'admin.workshop.membership_changed','success',jsonb_build_object('reason',trim(p_reason),'change',detail),statement_timestamp());
 RETURN detail;
END $function$;

CREATE OR REPLACE FUNCTION platform_admin.manage_workshop_lifecycle(p_tenant_id text,p_session_token_hash text,p_status text,p_trial_days integer,p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $function$
DECLARE admin_row record; workshop_row record; current_status text; v_trial_days integer; before_state jsonb; after_state jsonb;
BEGIN
 SELECT a.id,a.email INTO admin_row FROM platform_admin.sessions s JOIN platform_admin.administrators a ON a.id=s.administrator_id
 WHERE s.token_hash=p_session_token_hash AND s.expires_at>statement_timestamp() AND a.active AND a.enrolled AND a.permissions @> '["workshops:manage"]'::jsonb;
 IF NOT FOUND THEN RAISE EXCEPTION 'Permissão administrativa insuficiente' USING ERRCODE='42501'; END IF;
 IF p_status NOT IN ('trial','active','read_only','blocked','archived') OR (p_status='trial' AND p_trial_days IS NOT NULL AND p_trial_days NOT BETWEEN 1 AND 90)
  OR (p_status<>'trial' AND p_trial_days IS NOT NULL) OR length(trim(coalesce(p_reason,''))) NOT BETWEEN 10 AND 500
 THEN RAISE EXCEPTION 'Situação, período de teste ou justificativa inválidos' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_tenant_id,104730));
 SELECT tenant_id,status,status_reason,email_verified_at,trial_started_at,trial_ends_at INTO workshop_row
 FROM platform_admin.workshops WHERE tenant_id=p_tenant_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Oficina gerenciada não encontrada' USING ERRCODE='P0002'; END IF;
 current_status:=CASE WHEN workshop_row.status='trial' AND workshop_row.trial_ends_at<=statement_timestamp() THEN 'read_only' ELSE workshop_row.status END;
 before_state:=jsonb_build_object('status',workshop_row.status,'effective_status',current_status,'trial_started_at',workshop_row.trial_started_at,'trial_ends_at',workshop_row.trial_ends_at);
 IF current_status IN ('archived','legacy') OR (current_status='pending_verification' AND p_status IN ('trial','active')) THEN RAISE EXCEPTION 'Transição de situação não permitida' USING ERRCODE='23514'; END IF;
 IF p_status='trial' THEN
  IF current_status NOT IN ('trial','read_only','blocked') OR workshop_row.email_verified_at IS NULL THEN RAISE EXCEPTION 'Oficina não elegível para teste' USING ERRCODE='23514'; END IF;
  v_trial_days:=coalesce(p_trial_days,(platform_admin.effective_workshop_entitlements(p_tenant_id)->>'trial_days')::integer,14);
  IF p_trial_days IS NOT NULL THEN
   INSERT INTO platform_admin.workshop_entitlements(tenant_id,trial_days_override,updated_by_admin_id,updated_at,reason)
   VALUES(p_tenant_id,p_trial_days,admin_row.id,statement_timestamp(),trim(p_reason))
   ON CONFLICT(tenant_id) DO UPDATE SET trial_days_override=EXCLUDED.trial_days_override,updated_by_admin_id=EXCLUDED.updated_by_admin_id,updated_at=EXCLUDED.updated_at,reason=EXCLUDED.reason;
  END IF;
 ELSIF p_status='active' THEN
  IF current_status NOT IN ('trial','read_only','blocked') OR workshop_row.email_verified_at IS NULL THEN RAISE EXCEPTION 'Oficina não elegível para reativação' USING ERRCODE='23514'; END IF;
 ELSIF p_status='read_only' THEN
  IF current_status NOT IN ('trial','active','grace_period','blocked') THEN RAISE EXCEPTION 'Transição para somente leitura não permitida' USING ERRCODE='23514'; END IF;
 ELSIF p_status='blocked' THEN
  IF current_status NOT IN ('pending_verification','trial','active','grace_period','read_only') THEN RAISE EXCEPTION 'Transição para bloqueada não permitida' USING ERRCODE='23514'; END IF;
 END IF;
 UPDATE platform_admin.workshops SET status=p_status,status_reason=trim(p_reason),status_updated_by_admin_id=admin_row.id,
  trial_started_at=CASE WHEN p_status='trial' THEN statement_timestamp() ELSE trial_started_at END,
  trial_ends_at=CASE WHEN p_status='trial' THEN statement_timestamp()+make_interval(days=>v_trial_days) ELSE trial_ends_at END,
  updated_at=statement_timestamp() WHERE tenant_id=p_tenant_id;
 SELECT jsonb_build_object('status',status,'trial_started_at',trial_started_at,'trial_ends_at',trial_ends_at) INTO after_state FROM platform_admin.workshops WHERE tenant_id=p_tenant_id;
 INSERT INTO platform_admin.audit_events(id,actor_administrator_id,actor_email,subject_tenant_id,action,result,technical_context,created_at)
 VALUES(md5(clock_timestamp()::text||random()::text||p_tenant_id),admin_row.id,admin_row.email,p_tenant_id,'admin.workshop.status_changed','success',jsonb_build_object('reason',trim(p_reason),'before',before_state,'after',after_state),statement_timestamp());
 RETURN jsonb_build_object('before',before_state,'after',after_state);
END $function$;

REVOKE ALL ON FUNCTION platform_admin.workshop_member_directory(text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform_admin.manage_workshop_membership(text,text,text,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform_admin.manage_workshop_lifecycle(text,text,text,integer,text) FROM PUBLIC;
DO $grants$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='hp_platform_admin_app') THEN
  GRANT EXECUTE ON FUNCTION platform_admin.workshop_member_directory(text,text),platform_admin.manage_workshop_membership(text,text,text,text,text,text),platform_admin.manage_workshop_lifecycle(text,text,text,integer,text) TO hp_platform_admin_app;
 END IF;
END $grants$;
