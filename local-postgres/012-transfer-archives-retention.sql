ALTER TABLE horse_power.data_transfer_backups
  ADD COLUMN expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 days');
ALTER TABLE horse_power.document_revisions
  ADD CONSTRAINT document_revisions_tenant_id_unique UNIQUE(tenant_id,id);

CREATE TABLE horse_power.data_transfer_archived_documents (
  tenant_id text NOT NULL REFERENCES horse_power.tenants(id),
  revision_id text NOT NULL,
  backup_id text NOT NULL,
  kind text NOT NULL CHECK(kind IN ('order','checklist')),
  entity_id text NOT NULL,
  revision integer NOT NULL CHECK(revision>0),
  archived_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,revision_id),
  FOREIGN KEY(tenant_id,revision_id) REFERENCES horse_power.document_revisions(tenant_id,id)
);
CREATE INDEX data_transfer_archived_documents_tenant
  ON horse_power.data_transfer_archived_documents(tenant_id,archived_at DESC);

ALTER TABLE horse_power.data_transfer_archived_documents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON horse_power.data_transfer_archived_documents FROM PUBLIC;
GRANT SELECT,INSERT,DELETE ON horse_power.data_transfer_archived_documents TO hp_local_app;
CREATE POLICY data_transfer_archived_documents_tenant ON horse_power.data_transfer_archived_documents
  FOR ALL TO hp_local_app
  USING(tenant_id=nullif(current_setting('app.tenant_id',true),''))
  WITH CHECK(tenant_id=nullif(current_setting('app.tenant_id',true),''));

GRANT DELETE ON horse_power.data_transfer_backups TO hp_local_app;
CREATE POLICY data_transfer_backups_delete ON horse_power.data_transfer_backups
  FOR DELETE TO hp_local_app
  USING(tenant_id=nullif(current_setting('app.tenant_id',true),''));
