-- CAT-009: classifications is the only operational vehicle porte.
-- No catalog, financial record, snapshot or historical mapping is rewritten.
DROP TRIGGER IF EXISTS assign_model_labor_category_after_catalog_import ON service_catalog.models;
REVOKE EXECUTE ON FUNCTION service_catalog.prepare_catalog_import_for_cat008() FROM hp_catalog_importer;

ALTER TABLE service_catalog.classifications ADD CONSTRAINT catalog_four_portes
  CHECK (name IN ('Compacto','Médio','Premium','Pesado')) NOT VALID;
ALTER TABLE service_catalog.models ADD CONSTRAINT catalog_model_has_porte
  CHECK (classification_id IS NOT NULL) NOT VALID;
COMMENT ON TABLE service_catalog.model_labor_categories IS
  'Historical CAT-007 mapping. Operational classification is models.classification_id; do not backfill.';
COMMENT ON TABLE service_catalog.model_labor_category_overrides IS
  'Historical CAT-007 approvals, already incorporated in the converted catalog. Not applied on insertion.';

DROP POLICY catalog_importer_insert ON service_catalog.releases;
DROP POLICY catalog_importer_update ON service_catalog.releases;
CREATE POLICY catalog_importer_insert ON service_catalog.releases
  FOR INSERT TO hp_catalog_importer WITH CHECK (
    version='2.0-quatro-portes' AND status='loading'
    AND source_sha256 ~ '^[0-9a-f]{64}$'
    AND model_count=7534 AND time_count=836093 AND application_count=7292579
  );
CREATE POLICY catalog_importer_update ON service_catalog.releases
  FOR UPDATE TO hp_catalog_importer
  USING (version='2.0-quatro-portes' AND status='loading')
  WITH CHECK (
    version='2.0-quatro-portes' AND status IN ('loading','active')
    AND source_sha256 ~ '^[0-9a-f]{64}$'
    AND model_count=7534 AND time_count=836093 AND application_count=7292579
  );

