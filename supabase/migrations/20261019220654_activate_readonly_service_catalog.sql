SET LOCAL search_path=service_catalog,pg_catalog;
DO $$ BEGIN
 IF (SELECT count(*) FROM service_catalog.models) <> 7534 OR (SELECT count(*) FROM service_catalog.repair_times) <> 836093 THEN RAISE EXCEPTION 'Catálogo incompleto'; END IF;
 IF (SELECT sum(t.n) FROM service_catalog.models m JOIN (SELECT base_id,count(*) n FROM service_catalog.repair_times GROUP BY base_id) t ON t.base_id=m.base_id) <> 7292579 THEN RAISE EXCEPTION 'Vínculos inválidos'; END IF;
END $$;
CREATE UNIQUE INDEX base_service ON repair_times(base_id,service_id) WHERE base_id IS NOT NULL;
CREATE UNIQUE INDEX model_service ON repair_times(model_id,service_id) WHERE model_id IS NOT NULL;
CREATE INDEX model_fipe ON models(fipe_code);
CREATE INDEX model_family ON models(family_id);
CREATE INDEX model_brand ON models(brand_id);
CREATE INDEX model_base ON models(base_id);
CREATE INDEX model_classification ON models(classification_id);
CREATE INDEX family_brand ON families(brand_id);
CREATE INDEX base_family ON bases(family_id);
CREATE INDEX time_service ON repair_times(service_id);
CREATE VIEW model_services WITH (security_invoker=true) AS
 SELECT m.id model_id,t.service_id,t.service_name,t.minutes,t.time_identifier,t.id repair_time_id
 FROM models m JOIN repair_times t ON t.base_id=m.base_id
 WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(m.excluded_service_ids::jsonb) e(value) WHERE e.value=t.service_id::text)
 AND NOT EXISTS(SELECT 1 FROM repair_times x WHERE x.model_id=m.id AND x.service_id=t.service_id)
 UNION ALL SELECT t.model_id,t.service_id,t.service_name,t.minutes,t.time_identifier,t.id FROM repair_times t WHERE t.model_id IS NOT NULL;
REVOKE ALL ON ALL TABLES IN SCHEMA service_catalog FROM PUBLIC,anon,authenticated,service_role,horse_power_app;
REVOKE ALL ON SCHEMA service_catalog FROM PUBLIC,anon,authenticated,service_role;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='hp_catalog_import') THEN
 REVOKE ALL ON ALL TABLES IN SCHEMA service_catalog FROM hp_catalog_import;
 REVOKE ALL ON SCHEMA service_catalog FROM hp_catalog_import;
 ALTER ROLE hp_catalog_import NOLOGIN PASSWORD NULL;
END IF; END $$;
GRANT USAGE ON SCHEMA service_catalog TO horse_power_app;
GRANT SELECT ON ALL TABLES IN SCHEMA service_catalog TO horse_power_app;
ALTER TABLE tenant_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_access FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_read ON tenant_access FOR SELECT TO horse_power_app USING(tenant_id = nullif(current_setting('app.tenant_id',true),''));
ALTER TABLE releases ENABLE ROW LEVEL SECURITY;
ALTER TABLE releases FORCE ROW LEVEL SECURITY;
CREATE POLICY release_read ON releases FOR SELECT TO horse_power_app USING(status='active');
ALTER TABLE brands ENABLE ROW LEVEL SECURITY;
ALTER TABLE brands FORCE ROW LEVEL SECURITY;
CREATE POLICY entitled_catalog_read ON brands FOR SELECT TO horse_power_app USING(
 (SELECT EXISTS(SELECT 1 FROM service_catalog.releases WHERE status='active')) AND
 (SELECT EXISTS(SELECT 1 FROM service_catalog.tenant_access WHERE tenant_id=nullif(current_setting('app.tenant_id',true),'') AND enabled AND (valid_until IS NULL OR valid_until>now())))
);
ALTER TABLE classifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE classifications FORCE ROW LEVEL SECURITY;
CREATE POLICY entitled_catalog_read ON classifications FOR SELECT TO horse_power_app USING(
 (SELECT EXISTS(SELECT 1 FROM service_catalog.releases WHERE status='active')) AND
 (SELECT EXISTS(SELECT 1 FROM service_catalog.tenant_access WHERE tenant_id=nullif(current_setting('app.tenant_id',true),'') AND enabled AND (valid_until IS NULL OR valid_until>now())))
);
ALTER TABLE families ENABLE ROW LEVEL SECURITY;
ALTER TABLE families FORCE ROW LEVEL SECURITY;
CREATE POLICY entitled_catalog_read ON families FOR SELECT TO horse_power_app USING(
 (SELECT EXISTS(SELECT 1 FROM service_catalog.releases WHERE status='active')) AND
 (SELECT EXISTS(SELECT 1 FROM service_catalog.tenant_access WHERE tenant_id=nullif(current_setting('app.tenant_id',true),'') AND enabled AND (valid_until IS NULL OR valid_until>now())))
);
ALTER TABLE bases ENABLE ROW LEVEL SECURITY;
ALTER TABLE bases FORCE ROW LEVEL SECURITY;
CREATE POLICY entitled_catalog_read ON bases FOR SELECT TO horse_power_app USING(
 (SELECT EXISTS(SELECT 1 FROM service_catalog.releases WHERE status='active')) AND
 (SELECT EXISTS(SELECT 1 FROM service_catalog.tenant_access WHERE tenant_id=nullif(current_setting('app.tenant_id',true),'') AND enabled AND (valid_until IS NULL OR valid_until>now())))
);
ALTER TABLE services ENABLE ROW LEVEL SECURITY;
ALTER TABLE services FORCE ROW LEVEL SECURITY;
CREATE POLICY entitled_catalog_read ON services FOR SELECT TO horse_power_app USING(
 (SELECT EXISTS(SELECT 1 FROM service_catalog.releases WHERE status='active')) AND
 (SELECT EXISTS(SELECT 1 FROM service_catalog.tenant_access WHERE tenant_id=nullif(current_setting('app.tenant_id',true),'') AND enabled AND (valid_until IS NULL OR valid_until>now())))
);
ALTER TABLE models ENABLE ROW LEVEL SECURITY;
ALTER TABLE models FORCE ROW LEVEL SECURITY;
CREATE POLICY entitled_catalog_read ON models FOR SELECT TO horse_power_app USING(
 (SELECT EXISTS(SELECT 1 FROM service_catalog.releases WHERE status='active')) AND
 (SELECT EXISTS(SELECT 1 FROM service_catalog.tenant_access WHERE tenant_id=nullif(current_setting('app.tenant_id',true),'') AND enabled AND (valid_until IS NULL OR valid_until>now())))
);
ALTER TABLE repair_times ENABLE ROW LEVEL SECURITY;
ALTER TABLE repair_times FORCE ROW LEVEL SECURITY;
CREATE POLICY entitled_catalog_read ON repair_times FOR SELECT TO horse_power_app USING(
 (SELECT EXISTS(SELECT 1 FROM service_catalog.releases WHERE status='active')) AND
 (SELECT EXISTS(SELECT 1 FROM service_catalog.tenant_access WHERE tenant_id=nullif(current_setting('app.tenant_id',true),'') AND enabled AND (valid_until IS NULL OR valid_until>now())))
);
UPDATE releases SET status='active',source_sha256='5557e09a16362452e1a5716164e9cc0e13d48a26140c1682ffdc5ae48b0eefaa',validated_at=now() WHERE version='1.2-operacional' AND status='loading';
