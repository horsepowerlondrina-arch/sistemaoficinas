CREATE OR REPLACE FUNCTION platform_admin.update_workshop_admin(p_tenant_id text, p_name text, p_responsible_name text, p_responsible_email text, p_phone text, p_document text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'platform_admin'
AS $function$
DECLARE
  normalized_document text;
  current_email text;
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
  SELECT lower(trim(responsible_email)) INTO current_email
  FROM platform_admin.workshops WHERE tenant_id=p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF current_email IS DISTINCT FROM lower(trim(p_responsible_email)) AND (
     EXISTS (SELECT 1 FROM platform_admin.workshops WHERE tenant_id<>p_tenant_id AND lower(responsible_email)=lower(trim(p_responsible_email))) OR
     EXISTS (SELECT 1 FROM horse_power.users WHERE lower(email)=lower(trim(p_responsible_email)))
  ) THEN
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
