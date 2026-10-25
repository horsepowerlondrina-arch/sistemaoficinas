-- CAT-008.1: isolated, least-privilege role for the one-time catalog loader.
DO $role$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='hp_catalog_importer' AND (rolsuper OR rolbypassrls OR rolcanlogin)) THEN
    RAISE EXCEPTION 'hp_catalog_importer already exists with unsafe attributes';
  ELSIF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='hp_catalog_importer') THEN
    CREATE ROLE hp_catalog_importer NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END
$role$;

REVOKE ALL ON SCHEMA service_catalog FROM hp_catalog_importer;
GRANT USAGE ON SCHEMA service_catalog TO hp_catalog_importer;
GRANT SELECT,INSERT,UPDATE ON service_catalog.brands,service_catalog.classifications,
  service_catalog.families,service_catalog.bases,service_catalog.services,
  service_catalog.models,service_catalog.repair_times,service_catalog.releases,
  service_catalog.model_labor_categories TO hp_catalog_importer;
GRANT SELECT ON service_catalog.model_labor_category_overrides TO hp_catalog_importer;
DO $grant_temp$
BEGIN
  EXECUTE format('GRANT TEMPORARY ON DATABASE %I TO hp_catalog_importer',current_database());
END
$grant_temp$;

CREATE POLICY catalog_importer_write ON service_catalog.model_labor_categories
  FOR ALL TO hp_catalog_importer USING (true) WITH CHECK (true);
CREATE POLICY catalog_importer_read ON service_catalog.model_labor_category_overrides
  FOR SELECT TO hp_catalog_importer USING (true);

CREATE FUNCTION service_catalog.prepare_catalog_import_for_cat008()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $function$
DECLARE
  fixture_brand constant uuid := '00000000-0000-4000-8000-000000000001';
  fixture_family constant uuid := '00000000-0000-4000-8000-000000000002';
  fixture_base constant uuid := '00000000-0000-4000-8000-000000000003';
  fixture_classification constant uuid := '00000000-0000-4000-8000-000000000004';
  fixture_service constant uuid := '00000000-0000-4000-8000-000000000005';
  fixture_model constant uuid := '00000000-0000-4000-8000-000000000006';
  fixture_time constant uuid := '00000000-0000-4000-8000-000000000007';
BEGIN
  IF (SELECT count(*) FROM service_catalog.brands)=0
    AND (SELECT count(*) FROM service_catalog.classifications)=0
    AND (SELECT count(*) FROM service_catalog.families)=0
    AND (SELECT count(*) FROM service_catalog.bases)=0
    AND (SELECT count(*) FROM service_catalog.services)=0
    AND (SELECT count(*) FROM service_catalog.models)=0
    AND (SELECT count(*) FROM service_catalog.repair_times)=0
    AND (SELECT count(*) FROM service_catalog.model_labor_categories)=0
    AND NOT EXISTS (SELECT 1 FROM service_catalog.releases WHERE status='active') THEN
    RETURN;
  END IF;

  IF (SELECT count(*) FROM service_catalog.brands)<>1 OR NOT EXISTS
       (SELECT 1 FROM service_catalog.brands WHERE id=fixture_brand AND name='Marca Fictícia') OR
     (SELECT count(*) FROM service_catalog.classifications)<>1 OR NOT EXISTS
       (SELECT 1 FROM service_catalog.classifications WHERE id=fixture_classification AND name='Veículo Compacto') OR
     (SELECT count(*) FROM service_catalog.families)<>1 OR NOT EXISTS
       (SELECT 1 FROM service_catalog.families WHERE id=fixture_family AND brand_id=fixture_brand) OR
     (SELECT count(*) FROM service_catalog.bases)<>1 OR NOT EXISTS
       (SELECT 1 FROM service_catalog.bases WHERE id=fixture_base AND family_id=fixture_family AND service_count=1) OR
     (SELECT count(*) FROM service_catalog.services)<>1 OR NOT EXISTS
       (SELECT 1 FROM service_catalog.services WHERE id=fixture_service AND name='Inspeção Fictícia') OR
     (SELECT count(*) FROM service_catalog.models)<>1 OR NOT EXISTS
       (SELECT 1 FROM service_catalog.models WHERE id=fixture_model AND name='Modelo Fictício'
         AND brand_id=fixture_brand AND family_id=fixture_family AND base_id=fixture_base
         AND classification_id=fixture_classification) OR
     (SELECT count(*) FROM service_catalog.repair_times)<>1 OR NOT EXISTS
       (SELECT 1 FROM service_catalog.repair_times WHERE id=fixture_time AND base_id=fixture_base
         AND model_id IS NULL AND service_id=fixture_service AND service_name='Inspeção Fictícia'
         AND minutes=30 AND time_identifier='synthetic-demo') OR
     (SELECT count(*) FROM service_catalog.model_labor_categories)<>1 OR NOT EXISTS
       (SELECT 1 FROM service_catalog.model_labor_categories WHERE model_id=fixture_model AND category_id='compacto') OR
     (SELECT count(*) FROM service_catalog.model_labor_category_history)<>0 OR
     (SELECT count(*) FROM service_catalog.model_labor_category_overrides)<>51 OR
     NOT EXISTS (SELECT 1 FROM service_catalog.releases WHERE version='homologacao-sintetica'
       AND status='active' AND source_sha256='synthetic') OR
     NOT EXISTS (SELECT 1 FROM service_catalog.releases WHERE version='1.2-operacional'
       AND status='loading' AND source_sha256='pending') OR
     EXISTS (SELECT 1 FROM horse_power.order_items
       WHERE position(fixture_model::text IN service_snapshot)>0 OR position(fixture_service::text IN service_snapshot)>0) THEN
    RAISE EXCEPTION 'CAT-008 import refused: homologation catalog is not the exact untouched synthetic fixture';
  END IF;

  DELETE FROM service_catalog.model_labor_categories WHERE model_id=fixture_model;
  DELETE FROM service_catalog.repair_times WHERE id=fixture_time;
  DELETE FROM service_catalog.models WHERE id=fixture_model;
  DELETE FROM service_catalog.services WHERE id=fixture_service;
  DELETE FROM service_catalog.bases WHERE id=fixture_base;
  DELETE FROM service_catalog.families WHERE id=fixture_family;
  DELETE FROM service_catalog.classifications WHERE id=fixture_classification;
  DELETE FROM service_catalog.brands WHERE id=fixture_brand;
  UPDATE service_catalog.releases SET status='retired' WHERE version='homologacao-sintetica' AND source_sha256='synthetic';
END
$function$;

REVOKE ALL ON FUNCTION service_catalog.prepare_catalog_import_for_cat008() FROM PUBLIC,hp_platform_admin_app;
GRANT EXECUTE ON FUNCTION service_catalog.prepare_catalog_import_for_cat008() TO hp_catalog_importer;
COMMENT ON ROLE hp_catalog_importer IS 'No-login role for the explicitly confirmed, source-hash-validated CAT-008 loader; no access to workshop records.';
COMMENT ON FUNCTION service_catalog.prepare_catalog_import_for_cat008() IS 'Removes only the exact, unreferenced synthetic catalog fixture; refuses any other destination state.';
