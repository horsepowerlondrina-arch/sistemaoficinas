SET LOCAL search_path=horse_power,pg_catalog;
CREATE TABLE IF NOT EXISTS workshop_service_categories(
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL REFERENCES tenants(id),
 name TEXT NOT NULL,
 name_key TEXT NOT NULL,
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id),
 UNIQUE(tenant_id,name_key)
);
ALTER TABLE workshop_services ADD COLUMN IF NOT EXISTS reference TEXT NOT NULL DEFAULT '';
ALTER TABLE workshop_services ADD COLUMN IF NOT EXISTS category_id TEXT;
WITH numbered AS (
 SELECT id,row_number() OVER(PARTITION BY tenant_id ORDER BY id) sequence
 FROM workshop_services
)
UPDATE workshop_services s SET reference='SRV-'||lpad(numbered.sequence::text,6,'0')
FROM numbered WHERE numbered.id=s.id AND s.reference='';
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='workshop_services_category_tenant_fk' AND conrelid='horse_power.workshop_services'::regclass) THEN
  ALTER TABLE workshop_services ADD CONSTRAINT workshop_services_category_tenant_fk
   FOREIGN KEY(tenant_id,category_id) REFERENCES workshop_service_categories(tenant_id,id);
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='workshop_services_reference_not_empty' AND conrelid='horse_power.workshop_services'::regclass) THEN
  ALTER TABLE workshop_services ADD CONSTRAINT workshop_services_reference_not_empty CHECK(length(trim(reference))>0);
 END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS idx_workshop_services_reference
 ON workshop_services(tenant_id,upper(trim(reference)));
CREATE INDEX IF NOT EXISTS idx_workshop_services_private_category
 ON workshop_services(tenant_id,category_id,active,name);
CREATE INDEX IF NOT EXISTS idx_workshop_service_categories_tenant_active
 ON workshop_service_categories(tenant_id,active,name);
ALTER TABLE workshop_service_categories ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON workshop_service_categories FROM PUBLIC,anon,authenticated,service_role,horse_power_app;
GRANT SELECT,INSERT,UPDATE,DELETE ON workshop_service_categories TO horse_power_app;
DROP POLICY IF EXISTS backend_access ON workshop_service_categories;
CREATE POLICY backend_access ON workshop_service_categories FOR ALL TO horse_power_app USING(true) WITH CHECK(true);
