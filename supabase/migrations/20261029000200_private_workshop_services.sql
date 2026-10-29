SET LOCAL search_path=horse_power,pg_catalog;
ALTER TABLE workshop_services ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';
ALTER TABLE workshop_services ADD COLUMN IF NOT EXISTS cost_known INTEGER NOT NULL DEFAULT 1 CHECK(cost_known IN (0,1));
