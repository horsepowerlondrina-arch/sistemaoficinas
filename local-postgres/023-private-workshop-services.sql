SET search_path=horse_power,pg_catalog;
ALTER TABLE workshop_services ADD COLUMN description TEXT NOT NULL DEFAULT '';
ALTER TABLE workshop_services ADD COLUMN cost_known INTEGER NOT NULL DEFAULT 1 CHECK(cost_known IN (0,1));
ALTER TABLE workshop_services ADD COLUMN service_type TEXT NOT NULL DEFAULT 'legacy' CHECK(service_type IN ('legacy','private'));
ALTER TABLE workshop_services ADD COLUMN name_key TEXT NOT NULL DEFAULT '';
UPDATE workshop_services SET cost_known=0 WHERE execution='internal';
CREATE UNIQUE INDEX idx_workshop_services_private_name ON workshop_services(tenant_id,name_key) WHERE service_type='private';
