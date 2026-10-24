-- ADM-001.2A: central workshop registry and safe, non-operational tenancy bridge.
ALTER TABLE platform_admin.administrators
  DROP CONSTRAINT platform_admin_permissions_allowlist;
ALTER TABLE platform_admin.administrators
  ADD CONSTRAINT platform_admin_permissions_allowlist
  CHECK (permissions <@ '["audit:read","administrators:manage","platform:settings","critical:request","critical:approve","workshops:read","workshops:manage"]'::jsonb);
ALTER TABLE platform_admin.audit_events ADD COLUMN subject_tenant_id text;

CREATE TABLE platform_admin.workshops (
  tenant_id text PRIMARY KEY,
  source text NOT NULL CHECK (source IN ('admin','self_service')),
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 2 AND 160),
  responsible_name text NOT NULL CHECK (length(trim(responsible_name)) BETWEEN 2 AND 120),
  responsible_email text NOT NULL CHECK (length(trim(responsible_email)) BETWEEN 3 AND 254),
  phone text NOT NULL DEFAULT '' CHECK (length(phone) <= 40),
  document text NOT NULL DEFAULT '' CHECK (length(document) <= 32),
  status text NOT NULL CHECK (status IN ('pending_verification','trial','active','grace_period','read_only','blocked','archived')),
  email_verified_at timestamptz,
  trial_started_at timestamptz,
  trial_ends_at timestamptz,
  status_reason text NOT NULL DEFAULT 'Aguardando confirmação do e-mail.',
  created_by_admin_id text REFERENCES platform_admin.administrators(id),
  status_updated_by_admin_id text REFERENCES platform_admin.administrators(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((trial_started_at IS NULL AND trial_ends_at IS NULL) OR
         (trial_started_at IS NOT NULL AND trial_ends_at = trial_started_at + interval '14 days')),
  CHECK (status <> 'trial' OR (email_verified_at IS NOT NULL AND trial_started_at IS NOT NULL))
);
CREATE UNIQUE INDEX platform_admin_workshops_email ON platform_admin.workshops(lower(responsible_email));
CREATE UNIQUE INDEX platform_admin_workshops_document ON platform_admin.workshops(upper(regexp_replace(document,'[^A-Za-z0-9]','','g'))) WHERE document <> '';
CREATE INDEX platform_admin_workshops_status_created ON platform_admin.workshops(status,created_at DESC,tenant_id);

-- A tightly scoped definer function is the only permanent bridge for the
-- central-admin role to create or update the tenant shell in horse_power.
CREATE FUNCTION platform_admin.register_workshop_internal(
  p_tenant_id text,p_name text,p_responsible_name text,p_responsible_email text,
  p_phone text,p_document text,p_source text,p_created_by text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,platform_admin AS $function$
DECLARE normalized_document text;
BEGIN
  IF p_tenant_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' OR length(trim(p_name)) NOT BETWEEN 2 AND 160 OR
     length(trim(p_responsible_name)) NOT BETWEEN 2 AND 120 OR
     length(trim(p_responsible_email)) NOT BETWEEN 3 AND 254 OR p_source <> 'admin' THEN
    RAISE EXCEPTION 'Dados de oficina inválidos' USING ERRCODE='22023';
  END IF;
  normalized_document := upper(regexp_replace(coalesce(p_document,''),'[^A-Za-z0-9]','','g'));
  PERFORM pg_advisory_xact_lock(hashtextextended(lower(trim(p_responsible_email)), 104729));
  IF normalized_document <> '' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(normalized_document, 104729));
  END IF;
  IF EXISTS (SELECT 1 FROM horse_power.users WHERE lower(email)=lower(trim(p_responsible_email))) OR
     EXISTS (SELECT 1 FROM platform_admin.workshops WHERE lower(responsible_email)=lower(trim(p_responsible_email))) THEN
    RAISE EXCEPTION 'E-mail já cadastrado' USING ERRCODE='23505';
  END IF;
  IF normalized_document <> '' AND EXISTS (
    SELECT 1 FROM horse_power.tenants t
    WHERE upper(regexp_replace(coalesce(t.document,''),'[^A-Za-z0-9]','','g'))=normalized_document
  ) THEN
    RAISE EXCEPTION 'Documento já cadastrado' USING ERRCODE='23505';
  END IF;
  INSERT INTO horse_power.tenants(id,name,document,phone,address)
    VALUES(p_tenant_id,trim(p_name),coalesce(trim(p_document),''),coalesce(trim(p_phone),''),'');
  INSERT INTO platform_admin.workshops(tenant_id,source,name,responsible_name,responsible_email,phone,document,status,created_by_admin_id)
    VALUES(p_tenant_id,p_source,trim(p_name),trim(p_responsible_name),lower(trim(p_responsible_email)),coalesce(trim(p_phone),''),coalesce(trim(p_document),''),'pending_verification',p_created_by);
END
$function$;

CREATE FUNCTION platform_admin.create_workshop_admin(
  p_tenant_id text,p_name text,p_responsible_name text,p_responsible_email text,
  p_phone text,p_document text,p_created_by text
) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,platform_admin AS $function$
  SELECT platform_admin.register_workshop_internal($1,$2,$3,$4,$5,$6,'admin',$7)
$function$;

CREATE FUNCTION platform_admin.update_workshop_admin(
  p_tenant_id text,p_name text,p_responsible_name text,p_responsible_email text,
  p_phone text,p_document text
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,platform_admin AS $function$
DECLARE normalized_document text;
BEGIN
  IF length(trim(p_name)) NOT BETWEEN 2 AND 160 OR length(trim(p_responsible_name)) NOT BETWEEN 2 AND 120 OR
     length(trim(p_responsible_email)) NOT BETWEEN 3 AND 254 OR length(coalesce(p_phone,'')) > 40 OR length(coalesce(p_document,'')) > 32 THEN
    RAISE EXCEPTION 'Dados de oficina inválidos' USING ERRCODE='22023';
  END IF;
  normalized_document := upper(regexp_replace(coalesce(p_document,''),'[^A-Za-z0-9]','','g'));
  PERFORM pg_advisory_xact_lock(hashtextextended(lower(trim(p_responsible_email)), 104729));
  IF normalized_document <> '' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(normalized_document, 104729));
  END IF;
  IF EXISTS (SELECT 1 FROM platform_admin.workshops WHERE tenant_id<>p_tenant_id AND lower(responsible_email)=lower(trim(p_responsible_email))) OR
     EXISTS (SELECT 1 FROM horse_power.users WHERE lower(email)=lower(trim(p_responsible_email))) THEN
    RAISE EXCEPTION 'E-mail já cadastrado' USING ERRCODE='23505';
  END IF;
  IF normalized_document <> '' AND EXISTS (
    SELECT 1 FROM horse_power.tenants t WHERE t.id<>p_tenant_id AND
    upper(regexp_replace(coalesce(t.document,''),'[^A-Za-z0-9]','','g'))=normalized_document
  ) THEN
    RAISE EXCEPTION 'Documento já cadastrado' USING ERRCODE='23505';
  END IF;
  UPDATE platform_admin.workshops SET name=trim(p_name),responsible_name=trim(p_responsible_name),
    responsible_email=lower(trim(p_responsible_email)),phone=coalesce(trim(p_phone),''),document=coalesce(trim(p_document),''),updated_at=now()
    WHERE tenant_id=p_tenant_id;
  IF NOT FOUND THEN RETURN false; END IF;
  UPDATE horse_power.tenants SET name=trim(p_name),document=coalesce(trim(p_document),''),phone=coalesce(trim(p_phone),'') WHERE id=p_tenant_id;
  RETURN true;
END
$function$;

CREATE FUNCTION platform_admin.set_workshop_status_admin(
  p_tenant_id text,p_status text,p_reason text,p_actor text
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,platform_admin AS $function$
DECLARE previous_status text; effective_status text;
BEGIN
  SELECT status,CASE WHEN status='trial' AND trial_ends_at<=statement_timestamp() THEN 'read_only' ELSE status END
    INTO previous_status,effective_status FROM platform_admin.workshops WHERE tenant_id=p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Oficina não encontrada' USING ERRCODE='P0002'; END IF;
  IF length(trim(p_reason)) NOT BETWEEN 10 AND 500 OR p_status NOT IN ('read_only','blocked','archived') THEN
    RAISE EXCEPTION 'Alteração de situação inválida' USING ERRCODE='22023';
  END IF;
  IF NOT ((effective_status='pending_verification' AND p_status IN ('blocked','archived')) OR
          (effective_status IN ('trial','active','grace_period') AND p_status IN ('read_only','blocked','archived')) OR
          (effective_status='read_only' AND p_status IN ('blocked','archived')) OR
          (effective_status='blocked' AND p_status IN ('read_only','archived'))) THEN
    RAISE EXCEPTION 'Transição de situação não permitida' USING ERRCODE='23514';
  END IF;
  UPDATE platform_admin.workshops SET status=p_status,status_reason=trim(p_reason),status_updated_by_admin_id=p_actor,updated_at=now()
    WHERE tenant_id=p_tenant_id;
  RETURN previous_status;
END
$function$;

CREATE FUNCTION platform_admin.workshop_directory(
  p_search text,p_status text,p_limit integer,p_offset integer,p_tenant_id text DEFAULT NULL
) RETURNS TABLE(
  tenant_id text,name text,document text,phone text,status text,source text,
  responsible_name text,responsible_email text,created_at timestamptz,updated_at timestamptz,
  email_verified_at timestamptz,trial_started_at timestamptz,trial_ends_at timestamptz,
  trial_days_remaining integer,status_reason text,total_count bigint
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $function$
  WITH directory AS (
    SELECT t.id AS tenant_id,t.name AS legacy_name,t.document AS legacy_document,t.phone AS legacy_phone,
      w.name,w.document,w.phone,w.status AS stored_status,w.source,w.responsible_name,w.responsible_email,
      w.created_at,w.updated_at,w.email_verified_at,w.trial_started_at,w.trial_ends_at,w.status_reason
    FROM horse_power.tenants t LEFT JOIN platform_admin.workshops w ON w.tenant_id=t.id
  ), effective AS (
    SELECT d.*,CASE WHEN d.stored_status='trial' AND d.trial_ends_at<=statement_timestamp() THEN 'read_only'
      ELSE coalesce(d.stored_status,'legacy') END AS effective_status
    FROM directory d
  ), filtered AS (
    SELECT e.* FROM effective e
    WHERE (p_tenant_id IS NULL OR e.tenant_id=p_tenant_id)
      AND (coalesce(p_search,'')='' OR e.tenant_id ILIKE '%'||p_search||'%' OR
        coalesce(e.name,e.legacy_name,'') ILIKE '%'||p_search||'%' OR
        coalesce(e.document,e.legacy_document,'') ILIKE '%'||p_search||'%' OR
        coalesce(e.responsible_email,'') ILIKE '%'||p_search||'%')
      AND (coalesce(p_status,'all')='all' OR e.effective_status=p_status)
  )
  SELECT f.tenant_id,coalesce(f.name,f.legacy_name),coalesce(f.document,f.legacy_document,''),
    coalesce(f.phone,f.legacy_phone,''),f.effective_status,coalesce(f.source,'legacy'),
    coalesce(f.responsible_name,''),coalesce(f.responsible_email,''),f.created_at,f.updated_at,
    f.email_verified_at,f.trial_started_at,f.trial_ends_at,
    CASE WHEN f.trial_ends_at IS NULL THEN NULL ELSE greatest(0,ceil(extract(epoch FROM (f.trial_ends_at-statement_timestamp()))/86400))::integer END,
    coalesce(f.status_reason,''),(SELECT count(*) FROM filtered)
  FROM filtered f
  ORDER BY f.created_at DESC NULLS LAST,coalesce(f.name,f.legacy_name),f.tenant_id
  LIMIT greatest(1,least(coalesce(p_limit,25),100)) OFFSET greatest(0,coalesce(p_offset,0))
$function$;

CREATE FUNCTION horse_power.local_tenant_access_state(p_tenant_id text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $function$
  SELECT coalesce((SELECT CASE WHEN status='trial' AND trial_ends_at<=statement_timestamp() THEN 'read_only' ELSE status END
    FROM platform_admin.workshops WHERE tenant_id=p_tenant_id),'legacy')
$function$;

REVOKE ALL ON FUNCTION platform_admin.register_workshop_internal(text,text,text,text,text,text,text,text) FROM PUBLIC,horse_power_app,hp_platform_admin_app;
REVOKE ALL ON FUNCTION platform_admin.create_workshop_admin(text,text,text,text,text,text,text) FROM PUBLIC,horse_power_app,hp_platform_admin_app;
REVOKE ALL ON FUNCTION platform_admin.update_workshop_admin(text,text,text,text,text,text) FROM PUBLIC,horse_power_app,hp_platform_admin_app;
REVOKE ALL ON FUNCTION platform_admin.set_workshop_status_admin(text,text,text,text) FROM PUBLIC,horse_power_app,hp_platform_admin_app;
REVOKE ALL ON FUNCTION platform_admin.workshop_directory(text,text,integer,integer,text) FROM PUBLIC,horse_power_app,hp_platform_admin_app;
REVOKE ALL ON FUNCTION horse_power.local_tenant_access_state(text) FROM PUBLIC,horse_power_app,hp_platform_admin_app;
GRANT USAGE ON SCHEMA platform_admin TO hp_platform_admin_app;
GRANT SELECT ON platform_admin.workshops TO hp_platform_admin_app;
GRANT EXECUTE ON FUNCTION platform_admin.create_workshop_admin(text,text,text,text,text,text,text),platform_admin.update_workshop_admin(text,text,text,text,text,text),platform_admin.set_workshop_status_admin(text,text,text,text),platform_admin.workshop_directory(text,text,integer,integer,text) TO hp_platform_admin_app;
GRANT EXECUTE ON FUNCTION horse_power.local_tenant_access_state(text) TO horse_power_app;
