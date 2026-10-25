-- CAT-008: permit the no-login import role to load and verify only central catalog data.
-- Workshop policies and tenant_access remain unchanged.
DO $guard$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolname='hp_catalog_importer'
      AND NOT rolcanlogin AND NOT rolsuper AND NOT rolbypassrls
  ) THEN
    RAISE EXCEPTION 'CAT-008 importer role is missing or unsafe';
  END IF;
END
$guard$;

CREATE POLICY catalog_importer_read ON service_catalog.brands
  FOR SELECT TO hp_catalog_importer USING (true);
CREATE POLICY catalog_importer_insert ON service_catalog.brands
  FOR INSERT TO hp_catalog_importer WITH CHECK (true);

CREATE POLICY catalog_importer_read ON service_catalog.classifications
  FOR SELECT TO hp_catalog_importer USING (true);
CREATE POLICY catalog_importer_insert ON service_catalog.classifications
  FOR INSERT TO hp_catalog_importer WITH CHECK (true);

CREATE POLICY catalog_importer_read ON service_catalog.families
  FOR SELECT TO hp_catalog_importer USING (true);
CREATE POLICY catalog_importer_insert ON service_catalog.families
  FOR INSERT TO hp_catalog_importer WITH CHECK (true);

CREATE POLICY catalog_importer_read ON service_catalog.bases
  FOR SELECT TO hp_catalog_importer USING (true);
CREATE POLICY catalog_importer_insert ON service_catalog.bases
  FOR INSERT TO hp_catalog_importer WITH CHECK (true);

CREATE POLICY catalog_importer_read ON service_catalog.services
  FOR SELECT TO hp_catalog_importer USING (true);
CREATE POLICY catalog_importer_insert ON service_catalog.services
  FOR INSERT TO hp_catalog_importer WITH CHECK (true);

CREATE POLICY catalog_importer_read ON service_catalog.models
  FOR SELECT TO hp_catalog_importer USING (true);
CREATE POLICY catalog_importer_insert ON service_catalog.models
  FOR INSERT TO hp_catalog_importer WITH CHECK (true);

CREATE POLICY catalog_importer_read ON service_catalog.repair_times
  FOR SELECT TO hp_catalog_importer USING (true);
CREATE POLICY catalog_importer_insert ON service_catalog.repair_times
  FOR INSERT TO hp_catalog_importer WITH CHECK (true);

CREATE POLICY catalog_importer_read ON service_catalog.releases
  FOR SELECT TO hp_catalog_importer USING (true);
CREATE POLICY catalog_importer_insert ON service_catalog.releases
  FOR INSERT TO hp_catalog_importer WITH CHECK (
    version='1.2-operacional' AND status='loading'
    AND source_sha256='5557e09a16362452e1a5716164e9cc0e13d48a26140c1682ffdc5ae48b0eefaa'
    AND model_count=7534 AND time_count=836093 AND application_count=7292579
  );
CREATE POLICY catalog_importer_update ON service_catalog.releases
  FOR UPDATE TO hp_catalog_importer
  USING (version='1.2-operacional' AND status='loading')
  WITH CHECK (
    version='1.2-operacional' AND status IN ('loading','active')
    AND source_sha256='5557e09a16362452e1a5716164e9cc0e13d48a26140c1682ffdc5ae48b0eefaa'
    AND model_count=7534 AND time_count=836093 AND application_count=7292579
  );
