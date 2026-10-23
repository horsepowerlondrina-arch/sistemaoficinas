-- The local baseline did not include the existing checklist feature. Create missing tables only.
CREATE TABLE IF NOT EXISTS horse_power.checklists (
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL REFERENCES horse_power.tenants(id),
 order_id TEXT,
 customer_id TEXT,
 vehicle_id TEXT,
 customer_name TEXT NOT NULL DEFAULT '',
 phone TEXT NOT NULL DEFAULT '',
 plate TEXT NOT NULL,
 vehicle_label TEXT NOT NULL DEFAULT '',
 km INTEGER NOT NULL DEFAULT 0 CHECK(km>=0),
 fuel_level INTEGER NOT NULL DEFAULT 0 CHECK(fuel_level BETWEEN 0 AND 100),
 inspector TEXT NOT NULL DEFAULT '',
 complaint TEXT NOT NULL DEFAULT '',
 conditions_json TEXT NOT NULL DEFAULT '{}',
 accessories_notes TEXT NOT NULL DEFAULT '',
 panel_json TEXT NOT NULL DEFAULT '{}',
 panel_notes TEXT NOT NULL DEFAULT '',
 objects_left TEXT NOT NULL DEFAULT '',
 functioning_notes TEXT NOT NULL DEFAULT '',
 damages_json TEXT NOT NULL DEFAULT '[]',
 damage_notes TEXT NOT NULL DEFAULT '',
 signature_data TEXT NOT NULL DEFAULT '',
 signature_absent_reason TEXT NOT NULL DEFAULT '',
 customer_confirmed INTEGER NOT NULL DEFAULT 0 CHECK(customer_confirmed IN (0,1)),
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','completed')),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 completed_at TEXT,
 lookup_source TEXT NOT NULL DEFAULT '',
 vehicle_data_json TEXT NOT NULL DEFAULT '{}',
 UNIQUE(tenant_id,id),
 FOREIGN KEY(tenant_id,order_id) REFERENCES horse_power.orders(tenant_id,id),
 FOREIGN KEY(tenant_id,customer_id) REFERENCES horse_power.customers(tenant_id,id),
 FOREIGN KEY(tenant_id,vehicle_id) REFERENCES horse_power.vehicles(tenant_id,id)
);
GRANT SELECT,INSERT,UPDATE,DELETE ON horse_power.checklists TO hp_local_app;
ALTER TABLE horse_power.checklists ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='horse_power' AND tablename='checklists' AND policyname='backend_checklist_access') THEN CREATE POLICY backend_checklist_access ON horse_power.checklists FOR ALL TO hp_local_app USING(true) WITH CHECK(true); END IF; END $$;
CREATE TABLE IF NOT EXISTS horse_power.checklist_photos (
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL,
 checklist_id TEXT NOT NULL,
 kind TEXT NOT NULL,
 mime TEXT NOT NULL,
 image_data TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(tenant_id,id),
 FOREIGN KEY(tenant_id,checklist_id) REFERENCES horse_power.checklists(tenant_id,id) ON DELETE CASCADE
);
GRANT SELECT,INSERT,UPDATE,DELETE ON horse_power.checklist_photos TO hp_local_app;
ALTER TABLE horse_power.checklist_photos ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='horse_power' AND tablename='checklist_photos' AND policyname='backend_checklist_access') THEN CREATE POLICY backend_checklist_access ON horse_power.checklist_photos FOR ALL TO hp_local_app USING(true) WITH CHECK(true); END IF; END $$;
CREATE INDEX IF NOT EXISTS idx_checklists_tenant_plate ON horse_power.checklists(tenant_id,plate,created_at);
CREATE INDEX IF NOT EXISTS idx_checklist_photos_checklist ON horse_power.checklist_photos(tenant_id,checklist_id,created_at);
ALTER TABLE horse_power.tenants ADD COLUMN profile_data TEXT NOT NULL DEFAULT '{}';
ALTER TABLE horse_power.orders ADD COLUMN identity_legacy INTEGER NOT NULL DEFAULT 0;
ALTER TABLE horse_power.checklists ADD COLUMN identity_legacy INTEGER NOT NULL DEFAULT 0;
UPDATE horse_power.orders SET identity_legacy=1;
UPDATE horse_power.checklists SET identity_legacy=1;
ALTER TABLE horse_power.public_shares ADD COLUMN document_revision INTEGER;
CREATE TABLE horse_power.document_revisions (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES horse_power.tenants(id),
 kind TEXT NOT NULL CHECK(kind IN ('order','checklist')), entity_id TEXT NOT NULL,
 revision INTEGER NOT NULL CHECK(revision>0), issued_at TEXT NOT NULL,
 issued_by TEXT NOT NULL REFERENCES horse_power.users(id), payload TEXT NOT NULL, digest TEXT NOT NULL,
 UNIQUE(tenant_id,kind,entity_id,revision)
);
CREATE INDEX document_revision_entity ON horse_power.document_revisions(tenant_id,kind,entity_id,revision);

REVOKE ALL ON horse_power.document_revisions FROM PUBLIC,hp_local_app;
GRANT SELECT,INSERT ON horse_power.document_revisions TO hp_local_app;
ALTER TABLE horse_power.document_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE horse_power.document_revisions FORCE ROW LEVEL SECURITY;
CREATE POLICY backend_document_read ON horse_power.document_revisions FOR SELECT TO hp_local_app USING(true);
CREATE POLICY backend_document_insert ON horse_power.document_revisions FOR INSERT TO hp_local_app WITH CHECK(true);
CREATE FUNCTION horse_power.reject_document_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Documento emitido é imutável'; END $$;
CREATE TRIGGER document_revision_immutable BEFORE UPDATE OR DELETE ON horse_power.document_revisions FOR EACH ROW EXECUTE FUNCTION horse_power.reject_document_mutation();
INSERT INTO horse_power.migrations(version) VALUES(23);
