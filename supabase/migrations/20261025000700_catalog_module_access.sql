-- CAT-008: commercial access to the shared service catalog.
-- The catalog stays read-only for workshops; platform access changes use audited procedures.
ALTER TABLE service_catalog.tenant_access
  ADD COLUMN grant_source text NOT NULL DEFAULT 'commercial',
  ADD COLUMN activated_at timestamptz,
  ADD COLUMN updated_by_admin_id text REFERENCES platform_admin.administrators(id);

ALTER TABLE service_catalog.tenant_access
  ADD CONSTRAINT tenant_access_grant_source_check
  CHECK (grant_source IN ('commercial','homologation-test'));

UPDATE service_catalog.tenant_access
SET grant_source='homologation-test', activated_at=updated_at
WHERE grant_reason='Liberação para testes no HPDesenvolvimento; não representa contratação de assinatura';

UPDATE service_catalog.tenant_access
SET grant_source='homologation-test', activated_at=updated_at
WHERE grant_reason='Fixture sintética de homologação';

UPDATE service_catalog.tenant_access
SET activated_at=updated_at
WHERE enabled AND activated_at IS NULL;

ALTER TABLE platform_admin.administrators
  DROP CONSTRAINT platform_admin_permissions_allowlist;
ALTER TABLE platform_admin.administrators
  ADD CONSTRAINT platform_admin_permissions_allowlist
  CHECK (permissions <@ '["audit:read","administrators:manage","platform:settings","critical:request","critical:approve","workshops:read","workshops:manage","data-transfer:manage","modules:manage"]'::jsonb);

CREATE TABLE platform_admin.catalog_test_access (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  enabled boolean NOT NULL DEFAULT false,
  project_id text NOT NULL DEFAULT 'prj_rLVsFKBpMXQFtfm1kgYHFQObr4Jc'
    CHECK (project_id='prj_rLVsFKBpMXQFtfm1kgYHFQObr4Jc'),
  valid_until timestamptz,
  updated_by_admin_id text REFERENCES platform_admin.administrators(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  reason text NOT NULL DEFAULT 'Desabilitado por padrão.'
);
INSERT INTO platform_admin.catalog_test_access(singleton) VALUES(true);
REVOKE ALL ON platform_admin.catalog_test_access FROM PUBLIC,horse_power_app,hp_platform_admin_app;

CREATE FUNCTION platform_admin.catalog_access_status(p_tenant_id text)
RETURNS TABLE(status text,enabled boolean,valid_until timestamptz,activated_at timestamptz,
  grant_source text,updated_by_admin_id text,updated_by_admin_email text,updated_at timestamptz,reason text,catalog_installed boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $function$
  SELECT CASE
    WHEN NOT EXISTS(SELECT 1 FROM service_catalog.releases WHERE status='active') THEN 'not_installed'
    WHEN a.tenant_id IS NULL THEN 'not_contracted'
    WHEN a.enabled AND a.valid_until IS NOT NULL AND a.valid_until<=statement_timestamp() THEN 'expired'
    WHEN a.enabled THEN 'active'
    ELSE 'revoked' END,
    coalesce(a.enabled,false),a.valid_until,a.activated_at,coalesce(a.grant_source,''),
    a.updated_by_admin_id,coalesce(admin.email,''),a.updated_at,coalesce(a.grant_reason,''),
    EXISTS(SELECT 1 FROM service_catalog.releases WHERE status='active')
  FROM (SELECT p_tenant_id AS tenant_id) requested
  LEFT JOIN service_catalog.tenant_access a ON a.tenant_id=requested.tenant_id
  LEFT JOIN platform_admin.administrators admin ON admin.id=a.updated_by_admin_id
$function$;

CREATE FUNCTION platform_admin.manage_catalog_access(
  p_tenant_id text,p_session_token_hash text,p_enabled boolean,p_valid_until timestamptz,p_reason text
) RETURNS TABLE(actor_id text,actor_email text,previous_enabled boolean,previous_valid_until timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $function$
DECLARE admin_row record; previous_row record;
BEGIN
  SELECT a.id,a.email INTO admin_row
  FROM platform_admin.sessions s JOIN platform_admin.administrators a ON a.id=s.administrator_id
  WHERE s.token_hash=p_session_token_hash AND s.expires_at>statement_timestamp()
    AND a.active AND a.enrolled AND a.permissions @> '["modules:manage"]'::jsonb;
  IF NOT FOUND THEN RAISE EXCEPTION 'Permissão administrativa insuficiente' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM horse_power.tenants WHERE id=p_tenant_id) THEN
    RAISE EXCEPTION 'Oficina não encontrada' USING ERRCODE='P0002';
  END IF;
  IF length(trim(coalesce(p_reason,''))) NOT BETWEEN 10 AND 500 OR
     (p_enabled AND p_valid_until IS NOT NULL AND p_valid_until<=statement_timestamp()) THEN
    RAISE EXCEPTION 'Parâmetros de autorização inválidos' USING ERRCODE='22023';
  END IF;
  SELECT enabled,valid_until INTO previous_row FROM service_catalog.tenant_access WHERE tenant_id=p_tenant_id FOR UPDATE;
  INSERT INTO service_catalog.tenant_access(tenant_id,enabled,valid_until,grant_reason,grant_source,activated_at,updated_by_admin_id,updated_at)
  VALUES(p_tenant_id,p_enabled,CASE WHEN p_enabled THEN p_valid_until ELSE NULL END,trim(p_reason),'commercial',
    CASE WHEN p_enabled THEN statement_timestamp() ELSE NULL END,admin_row.id,statement_timestamp())
  ON CONFLICT(tenant_id) DO UPDATE SET enabled=EXCLUDED.enabled,valid_until=EXCLUDED.valid_until,
    grant_reason=EXCLUDED.grant_reason,grant_source='commercial',
    activated_at=CASE WHEN EXCLUDED.enabled THEN coalesce(service_catalog.tenant_access.activated_at,statement_timestamp()) ELSE service_catalog.tenant_access.activated_at END,
    updated_by_admin_id=EXCLUDED.updated_by_admin_id,updated_at=statement_timestamp();
  actor_id:=admin_row.id; actor_email:=admin_row.email;
  previous_enabled:=coalesce(previous_row.enabled,false); previous_valid_until:=previous_row.valid_until;
  RETURN NEXT;
END
$function$;

CREATE FUNCTION platform_admin.apply_catalog_test_access(p_project_id text,p_reason text DEFAULT 'Liberação de testes na homologação')
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $function$
DECLARE settings platform_admin.catalog_test_access%ROWTYPE; changed integer;
BEGIN
  SELECT * INTO settings FROM platform_admin.catalog_test_access WHERE singleton;
  IF NOT coalesce(settings.enabled,false) OR settings.valid_until<=statement_timestamp() OR
     settings.project_id<>p_project_id OR current_setting('app.vercel_project_id',true) IS DISTINCT FROM settings.project_id OR
     current_setting('app.vercel_env',true) IS DISTINCT FROM 'production' THEN RETURN 0; END IF;
  INSERT INTO service_catalog.tenant_access(tenant_id,enabled,valid_until,grant_reason,grant_source,activated_at,updated_by_admin_id,updated_at)
  SELECT t.id,true,settings.valid_until,trim(p_reason),'homologation-test',statement_timestamp(),settings.updated_by_admin_id,statement_timestamp()
  FROM horse_power.tenants t
  LEFT JOIN service_catalog.tenant_access a ON a.tenant_id=t.id
  WHERE a.tenant_id IS NULL OR a.grant_source='homologation-test'
  ON CONFLICT(tenant_id) DO UPDATE SET enabled=true,valid_until=EXCLUDED.valid_until,
    grant_reason=EXCLUDED.grant_reason,grant_source='homologation-test',
    activated_at=coalesce(service_catalog.tenant_access.activated_at,statement_timestamp()),
    updated_by_admin_id=settings.updated_by_admin_id,updated_at=statement_timestamp()
  WHERE service_catalog.tenant_access.grant_source='homologation-test';
  GET DIAGNOSTICS changed=ROW_COUNT;
  RETURN changed;
END
$function$;

CREATE FUNCTION platform_admin.set_catalog_test_access(
  p_session_token_hash text,p_project_id text,p_enabled boolean,p_valid_until timestamptz,p_reason text
) RETURNS TABLE(actor_id text,actor_email text,changed_count integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $function$
DECLARE admin_row record; settings platform_admin.catalog_test_access%ROWTYPE; changed integer:=0;
BEGIN
  SELECT a.id,a.email INTO admin_row
  FROM platform_admin.sessions s JOIN platform_admin.administrators a ON a.id=s.administrator_id
  WHERE s.token_hash=p_session_token_hash AND s.expires_at>statement_timestamp()
    AND a.active AND a.enrolled AND a.permissions @> '["modules:manage"]'::jsonb;
  IF NOT FOUND THEN RAISE EXCEPTION 'Permissão administrativa insuficiente' USING ERRCODE='42501'; END IF;
  IF p_project_id<>'prj_rLVsFKBpMXQFtfm1kgYHFQObr4Jc' OR
     current_setting('app.vercel_project_id',true) IS DISTINCT FROM p_project_id OR
     current_setting('app.vercel_env',true) IS DISTINCT FROM 'production' THEN
    RAISE EXCEPTION 'Ação disponível somente no projeto de homologação autorizado' USING ERRCODE='42501';
  END IF;
  IF length(trim(coalesce(p_reason,''))) NOT BETWEEN 10 AND 500 OR
     (p_enabled AND (p_valid_until IS NULL OR p_valid_until<=statement_timestamp() OR p_valid_until>statement_timestamp()+interval '30 days')) THEN
    RAISE EXCEPTION 'Período ou justificativa inválidos' USING ERRCODE='22023';
  END IF;
  SELECT * INTO settings FROM platform_admin.catalog_test_access WHERE singleton FOR UPDATE;
  UPDATE platform_admin.catalog_test_access SET enabled=p_enabled,valid_until=CASE WHEN p_enabled THEN p_valid_until ELSE NULL END,
    updated_by_admin_id=admin_row.id,updated_at=statement_timestamp(),reason=trim(p_reason) WHERE singleton;
  IF p_enabled THEN
    SELECT platform_admin.apply_catalog_test_access(p_project_id,trim(p_reason)) INTO changed;
  ELSE
    UPDATE service_catalog.tenant_access SET enabled=false,valid_until=NULL,updated_by_admin_id=admin_row.id,
      grant_reason=trim(p_reason),updated_at=statement_timestamp()
    WHERE grant_source='homologation-test' AND enabled;
    GET DIAGNOSTICS changed=ROW_COUNT;
  END IF;
  actor_id:=admin_row.id; actor_email:=admin_row.email; changed_count:=changed; RETURN NEXT;
END
$function$;

CREATE FUNCTION platform_admin.catalog_test_access_status()
RETURNS TABLE(enabled boolean,valid_until timestamptz,updated_by_admin_id text,updated_by_admin_email text,updated_at timestamptz,reason text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $function$
  SELECT c.enabled,c.valid_until,c.updated_by_admin_id,coalesce(a.email,''),c.updated_at,c.reason
  FROM platform_admin.catalog_test_access c
  LEFT JOIN platform_admin.administrators a ON a.id=c.updated_by_admin_id
  WHERE c.singleton
$function$;

CREATE FUNCTION platform_admin.catalog_test_access_after_activation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $function$
BEGIN
  IF TG_OP='INSERT' AND NEW.status IN ('trial','active','grace_period') THEN
    PERFORM platform_admin.apply_catalog_test_access(
      current_setting('app.vercel_project_id',true),'Concessão temporária automática para testes de homologação');
  ELSIF TG_OP='UPDATE' AND OLD.status IS DISTINCT FROM NEW.status AND NEW.status IN ('trial','active','grace_period') THEN
    PERFORM platform_admin.apply_catalog_test_access(
      current_setting('app.vercel_project_id',true),'Concessão temporária automática para testes de homologação');
  END IF;
  RETURN NEW;
END
$function$;
CREATE TRIGGER catalog_test_access_after_activation
AFTER INSERT OR UPDATE OF status ON platform_admin.workshops
FOR EACH ROW EXECUTE FUNCTION platform_admin.catalog_test_access_after_activation();

CREATE FUNCTION service_catalog.audit_tenant_access_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,service_catalog,platform_admin AS $function$
DECLARE actor_email text:='Sistema'; action_name text;
BEGIN
  IF TG_OP='UPDATE' AND OLD.enabled IS NOT DISTINCT FROM NEW.enabled AND
    OLD.valid_until IS NOT DISTINCT FROM NEW.valid_until AND OLD.grant_reason IS NOT DISTINCT FROM NEW.grant_reason AND
    OLD.grant_source IS NOT DISTINCT FROM NEW.grant_source AND OLD.updated_by_admin_id IS NOT DISTINCT FROM NEW.updated_by_admin_id THEN
    RETURN NEW;
  END IF;
  SELECT email INTO actor_email FROM platform_admin.administrators WHERE id=NEW.updated_by_admin_id;
  IF NEW.grant_source='homologation-test' THEN action_name:='admin.catalog_access.homologation_test';
  ELSIF TG_OP='INSERT' AND NEW.enabled THEN action_name:='admin.catalog_access.granted';
  ELSIF TG_OP='UPDATE' AND OLD.enabled AND NOT NEW.enabled THEN action_name:='admin.catalog_access.revoked';
  ELSIF TG_OP='UPDATE' AND OLD.enabled AND NEW.enabled THEN action_name:='admin.catalog_access.renewed';
  ELSIF NEW.enabled THEN action_name:='admin.catalog_access.granted';
  ELSE action_name:='admin.catalog_access.disabled'; END IF;
  INSERT INTO platform_admin.audit_events(id,actor_administrator_id,subject_tenant_id,actor_email,action,result,technical_context)
  VALUES(md5(clock_timestamp()::text||pg_backend_pid()::text||random()::text),NEW.updated_by_admin_id,NEW.tenant_id,
    coalesce(actor_email,'Sistema'),action_name,'success',jsonb_build_object('enabled',NEW.enabled,'valid_until',NEW.valid_until,
      'grant_source',NEW.grant_source,'reason',NEW.grant_reason));
  RETURN NEW;
END
$function$;
REVOKE ALL ON FUNCTION service_catalog.audit_tenant_access_change() FROM PUBLIC,horse_power_app,hp_platform_admin_app;
CREATE TRIGGER tenant_access_audit AFTER INSERT OR UPDATE ON service_catalog.tenant_access
FOR EACH ROW EXECUTE FUNCTION service_catalog.audit_tenant_access_change();

REVOKE ALL ON FUNCTION platform_admin.catalog_access_status(text) FROM PUBLIC,horse_power_app;
REVOKE ALL ON FUNCTION platform_admin.manage_catalog_access(text,text,boolean,timestamptz,text) FROM PUBLIC,horse_power_app;
REVOKE ALL ON FUNCTION platform_admin.apply_catalog_test_access(text,text) FROM PUBLIC,horse_power_app,hp_platform_admin_app;
REVOKE ALL ON FUNCTION platform_admin.set_catalog_test_access(text,text,boolean,timestamptz,text) FROM PUBLIC,horse_power_app;
REVOKE ALL ON FUNCTION platform_admin.catalog_test_access_status() FROM PUBLIC,horse_power_app;
REVOKE ALL ON FUNCTION platform_admin.catalog_test_access_after_activation() FROM PUBLIC,horse_power_app,hp_platform_admin_app;
GRANT EXECUTE ON FUNCTION platform_admin.catalog_access_status(text),platform_admin.manage_catalog_access(text,text,boolean,timestamptz,text),
  platform_admin.set_catalog_test_access(text,text,boolean,timestamptz,text),platform_admin.catalog_test_access_status() TO hp_platform_admin_app;

COMMENT ON TABLE platform_admin.catalog_test_access IS
  'Habilitação temporária de homologação, desligada por padrão e fixada ao ID Vercel aprovado.';
COMMENT ON COLUMN service_catalog.tenant_access.grant_source IS
  'Origem da autorização; somente concessões homologation-test são revogadas em lote pelo procedimento de teste.';
