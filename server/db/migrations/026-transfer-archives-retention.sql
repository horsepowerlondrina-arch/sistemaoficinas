ALTER TABLE data_transfer_backups ADD COLUMN expires_at TEXT NOT NULL DEFAULT '';
UPDATE data_transfer_backups SET expires_at=datetime(created_at,'+30 days') WHERE expires_at='';
CREATE UNIQUE INDEX document_revisions_tenant_id_unique ON document_revisions(tenant_id,id);
CREATE TABLE data_transfer_archived_documents (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  revision_id TEXT NOT NULL,
  backup_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('order','checklist')),
  entity_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision>0),
  archived_at TEXT NOT NULL,
  PRIMARY KEY(tenant_id,revision_id),
  FOREIGN KEY(tenant_id,revision_id) REFERENCES document_revisions(tenant_id,id)
);
CREATE INDEX data_transfer_archived_documents_tenant ON data_transfer_archived_documents(tenant_id,archived_at DESC);
INSERT INTO migrations(version) VALUES(26);
