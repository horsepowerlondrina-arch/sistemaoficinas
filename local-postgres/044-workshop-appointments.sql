-- Match the production appointment schema in disposable PostgreSQL 17 tests.
CREATE TABLE horse_power.appointments (
 id text PRIMARY KEY, tenant_id text NOT NULL REFERENCES horse_power.tenants(id) ON DELETE CASCADE,
 starts_at text NOT NULL, ends_at text NOT NULL,
 plate text NOT NULL, customer_id text,
 customer_name text NOT NULL, phone text NOT NULL,
 planned_services text NOT NULL DEFAULT '',
 status text NOT NULL DEFAULT 'scheduled' CHECK(status IN ('scheduled','arrived','cancelled')),
 checklist_id text, created_by text NOT NULL REFERENCES horse_power.users(id),
 created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(tenant_id,id), CHECK(ends_at>starts_at)
);
CREATE INDEX appointments_tenant_day ON horse_power.appointments(tenant_id,starts_at,status);
CREATE INDEX appointments_tenant_plate ON horse_power.appointments(tenant_id,plate,starts_at);
ALTER TABLE horse_power.appointments ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope_local ON horse_power.appointments FOR ALL TO hp_local_app
 USING (tenant_id=NULLIF(current_setting('app.tenant_id',true),''))
 WITH CHECK (tenant_id=NULLIF(current_setting('app.tenant_id',true),''));
REVOKE ALL ON horse_power.appointments FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE,DELETE ON horse_power.appointments TO hp_local_app;

CREATE OR REPLACE FUNCTION horse_power.local_tenant_module_access(p_tenant_id text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $function$
DECLARE v_user_id text; v_entitlements jsonb; v_source text;
BEGIN
  v_user_id:=current_setting('app.user_id',true);
  IF current_setting('app.tenant_id',true) IS DISTINCT FROM p_tenant_id OR coalesce(v_user_id,'')='' THEN
    RAISE EXCEPTION 'Contexto da oficina inválido' USING ERRCODE='42501';
  END IF;
  IF v_user_id='public' THEN
    IF NOT EXISTS (SELECT 1 FROM horse_power.public_shares s
      WHERE s.token_hash=current_setting('app.public_share_hash',true)
        AND s.tenant_id=p_tenant_id AND s.revoked=0
        AND s.expires_at>(extract(epoch FROM statement_timestamp())*1000)::bigint)
    THEN RAISE EXCEPTION 'Contexto público inválido' USING ERRCODE='42501'; END IF;
  ELSIF NOT EXISTS (SELECT 1 FROM horse_power.memberships m WHERE m.tenant_id=p_tenant_id AND m.user_id=v_user_id) THEN
    RAISE EXCEPTION 'Contexto da oficina inválido' USING ERRCODE='42501';
  END IF;
  v_entitlements:=platform_admin.effective_workshop_entitlements(p_tenant_id);
  SELECT source INTO v_source FROM platform_admin.workshops WHERE tenant_id=p_tenant_id;
  RETURN (v_entitlements->'modules') || jsonb_build_object('agenda',
    coalesce(v_source='legacy' OR v_entitlements->>'effective_plan_code' IN ('professional','premium'),false));
END
$function$;

-- The retention routine fails closed when a tenant table is absent from its
-- deletion order. Add appointments before customer/vehicle/user deletion.
DO $retention$
DECLARE definition text; marker text:='''horse_power.audit_events'',''horse_power.capture_sessions''';
BEGIN
  SELECT pg_get_functiondef('platform_admin.retention_delete_workshop(text,date)'::regprocedure) INTO definition;
  IF definition IS NULL OR position(marker IN definition)=0 OR position('''horse_power.appointments''' IN definition)>0 THEN
    RAISE EXCEPTION 'A rotina de retenção mudou; revise a agenda antes de aplicá-la.';
  END IF;
  EXECUTE replace(definition,marker,chr(39)||'horse_power.appointments'||chr(39)||','||marker);
END $retention$;
