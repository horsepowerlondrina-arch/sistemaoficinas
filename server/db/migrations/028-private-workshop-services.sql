ALTER TABLE workshop_services ADD COLUMN description TEXT NOT NULL DEFAULT '';
ALTER TABLE workshop_services ADD COLUMN cost_known INTEGER NOT NULL DEFAULT 1 CHECK(cost_known IN (0,1));
