-- Commercial enrollment stays behind the restricted administrative backend and the release flag.
CREATE TABLE platform_admin.commercial_workshops (
  tenant_id text PRIMARY KEY REFERENCES platform_admin.workshops(tenant_id) ON DELETE CASCADE
);
REVOKE ALL ON platform_admin.commercial_workshops FROM PUBLIC;
ALTER TABLE platform_admin.commercial_workshops ENABLE ROW LEVEL SECURITY;
CREATE POLICY commercial_workshop_backend ON platform_admin.commercial_workshops
  FOR SELECT TO hp_platform_admin_app USING (true);
GRANT SELECT ON platform_admin.commercial_workshops TO hp_platform_admin_app;

CREATE FUNCTION platform_admin.create_workshop_commercial(
 p_tenant text,p_name text,p_responsible text,p_email text,p_phone text,p_document text,
 p_plan text,p_invite text,p_token_hash text,p_expires timestamptz
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $function$
BEGIN
 IF p_plan NOT IN ('basic','professional','premium') OR
    length(p_email) NOT BETWEEN 3 AND 254 OR
    position('@' in p_email)=0 OR lower(p_email) LIKE '%@testes.osdrive.com.br' OR
    p_token_hash !~ '^[a-f0-9]{64}$' OR p_expires<=now() OR p_expires>now()+interval '49 hours' OR
    NOT EXISTS(SELECT 1 FROM platform_admin.plan_defaults WHERE plan_code=p_plan AND configured)
 THEN RAISE EXCEPTION 'Cadastro indisponível' USING ERRCODE='22023'; END IF;
 PERFORM platform_admin.register_workshop_internal(p_tenant,p_name,p_responsible,p_email,p_phone,p_document,'admin',NULL);
 UPDATE platform_admin.workshops SET source='self_service',plan_code=p_plan,plan_policy_activated_at=now() WHERE tenant_id=p_tenant;
 INSERT INTO platform_admin.commercial_workshops(tenant_id) VALUES(p_tenant);
 INSERT INTO platform_admin.workshop_activation_invites(id,tenant_id,token_hash,responsible_email,expires_at)
 VALUES(p_invite,p_tenant,p_token_hash,lower(p_email),p_expires);
 INSERT INTO platform_admin.audit_events(id,subject_tenant_id,actor_email,action,result,technical_context)
 VALUES(p_invite,p_tenant,lower(p_email),'workshop.commercial.registered','success',jsonb_build_object('plan_code',p_plan));
END
$function$;
REVOKE ALL ON FUNCTION platform_admin.create_workshop_commercial(text,text,text,text,text,text,text,text,text,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform_admin.create_workshop_commercial(text,text,text,text,text,text,text,text,text,timestamptz) TO hp_platform_admin_app;
