-- Additive compatibility layer for workshop documents in the hosted test database.
ALTER TABLE horse_power.tenants
  ADD COLUMN IF NOT EXISTS profile_data text NOT NULL DEFAULT '{}';
ALTER TABLE horse_power.orders
  ADD COLUMN IF NOT EXISTS identity_legacy integer NOT NULL DEFAULT 0;
ALTER TABLE horse_power.public_shares
  ADD COLUMN IF NOT EXISTS token_value text,
  ADD COLUMN IF NOT EXISTS document_revision integer;

CREATE TABLE IF NOT EXISTS horse_power.checklists (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES horse_power.tenants(id),
  order_id text,
  customer_id text,
  vehicle_id text,
  customer_name text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  plate text NOT NULL,
  vehicle_label text NOT NULL DEFAULT '',
  km integer NOT NULL DEFAULT 0 CHECK (km >= 0),
  fuel_level integer NOT NULL DEFAULT 0 CHECK (fuel_level BETWEEN 0 AND 100),
  inspector text NOT NULL DEFAULT '',
  complaint text NOT NULL DEFAULT '',
  conditions_json text NOT NULL DEFAULT '{}',
  accessories_notes text NOT NULL DEFAULT '',
  panel_json text NOT NULL DEFAULT '{}',
  panel_notes text NOT NULL DEFAULT '',
  objects_left text NOT NULL DEFAULT '',
  functioning_notes text NOT NULL DEFAULT '',
  damages_json text NOT NULL DEFAULT '[]',
  damage_notes text NOT NULL DEFAULT '',
  signature_data text NOT NULL DEFAULT '',
  signature_absent_reason text NOT NULL DEFAULT '',
  customer_confirmed integer NOT NULL DEFAULT 0 CHECK (customer_confirmed IN (0,1)),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','completed')),
  created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at text,
  lookup_source text NOT NULL DEFAULT '',
  vehicle_data_json text NOT NULL DEFAULT '{}',
  identity_legacy integer NOT NULL DEFAULT 0,
  UNIQUE (tenant_id,id),
  FOREIGN KEY (tenant_id,order_id) REFERENCES horse_power.orders(tenant_id,id),
  FOREIGN KEY (tenant_id,customer_id) REFERENCES horse_power.customers(tenant_id,id),
  FOREIGN KEY (tenant_id,vehicle_id) REFERENCES horse_power.vehicles(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS checklists_tenant_plate_created
  ON horse_power.checklists(tenant_id,plate,created_at);
CREATE INDEX IF NOT EXISTS checklists_tenant_order_created
  ON horse_power.checklists(tenant_id,order_id,created_at);

CREATE TABLE IF NOT EXISTS horse_power.checklist_photos (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  checklist_id text NOT NULL,
  kind text NOT NULL,
  mime text NOT NULL,
  image_data text NOT NULL,
  created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id,id),
  FOREIGN KEY (tenant_id,checklist_id)
    REFERENCES horse_power.checklists(tenant_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS checklist_photos_tenant_checklist_created
  ON horse_power.checklist_photos(tenant_id,checklist_id,created_at);

CREATE TABLE IF NOT EXISTS horse_power.document_revisions (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES horse_power.tenants(id),
  kind text NOT NULL CHECK (kind IN ('order','checklist')),
  entity_id text NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  issued_at text NOT NULL,
  issued_by text NOT NULL REFERENCES horse_power.users(id),
  payload text NOT NULL,
  digest text NOT NULL,
  UNIQUE (tenant_id,kind,entity_id,revision)
);
CREATE INDEX IF NOT EXISTS document_revision_entity
  ON horse_power.document_revisions(tenant_id,kind,entity_id,revision);

CREATE OR REPLACE FUNCTION horse_power.reject_document_revision_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  RAISE EXCEPTION 'Documento emitido é imutável';
END;
$$;
DROP TRIGGER IF EXISTS document_revision_no_update ON horse_power.document_revisions;
CREATE TRIGGER document_revision_no_update
  BEFORE UPDATE ON horse_power.document_revisions
  FOR EACH ROW EXECUTE FUNCTION horse_power.reject_document_revision_mutation();
DROP TRIGGER IF EXISTS document_revision_no_delete ON horse_power.document_revisions;
CREATE TRIGGER document_revision_no_delete
  BEFORE DELETE ON horse_power.document_revisions
  FOR EACH ROW EXECUTE FUNCTION horse_power.reject_document_revision_mutation();

-- Existing documents predate snapshots. Mark them as legacy rather than inventing
-- historic workshop details; new documents receive immutable snapshots.
UPDATE horse_power.orders SET identity_legacy=1 WHERE identity_legacy=0;

GRANT SELECT,INSERT,UPDATE,DELETE ON horse_power.checklists,
  horse_power.checklist_photos TO horse_power_app;
GRANT SELECT,INSERT ON horse_power.document_revisions TO horse_power_app;
GRANT EXECUTE ON FUNCTION horse_power.reject_document_revision_mutation() TO horse_power_app;

ALTER TABLE horse_power.checklists ENABLE ROW LEVEL SECURITY;
ALTER TABLE horse_power.checklist_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE horse_power.document_revisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON horse_power.checklists FOR ALL TO horse_power_app
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), ''));
CREATE POLICY tenant_scope ON horse_power.checklist_photos FOR ALL TO horse_power_app
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), ''));
CREATE POLICY tenant_scope ON horse_power.document_revisions FOR ALL TO horse_power_app
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), ''));
