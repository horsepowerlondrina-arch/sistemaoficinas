SET LOCAL search_path=horse_power,pg_catalog;
ALTER TABLE workshop_services ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';
ALTER TABLE workshop_services ADD COLUMN IF NOT EXISTS cost_known INTEGER NOT NULL DEFAULT 1 CHECK(cost_known IN (0,1));
ALTER TABLE workshop_services ADD COLUMN IF NOT EXISTS service_type TEXT NOT NULL DEFAULT 'legacy' CHECK(service_type IN ('legacy','private'));
UPDATE workshop_services SET cost_known=0 WHERE execution='internal';
ALTER TABLE workshop_services ADD COLUMN IF NOT EXISTS name_key TEXT NOT NULL DEFAULT '';
CREATE UNIQUE INDEX IF NOT EXISTS idx_workshop_services_private_name ON workshop_services(tenant_id,name_key) WHERE service_type='private';
