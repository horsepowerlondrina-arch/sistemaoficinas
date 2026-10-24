CREATE TABLE data_transfer_records (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  source_application TEXT NOT NULL,
  source_tenant_id TEXT NOT NULL,
  table_name TEXT NOT NULL,
  source_record_id TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  target_record_id TEXT NOT NULL,
  target_hash TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, source_application, source_tenant_id, table_name, source_record_id)
);
CREATE INDEX data_transfer_records_target ON data_transfer_records(tenant_id, table_name, target_record_id);

CREATE TABLE data_transfer_backups (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  created_by TEXT NOT NULL REFERENCES users(id),
  package_sha256 TEXT NOT NULL CHECK(length(package_sha256)=64),
  package BLOB NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX data_transfer_backups_tenant_created ON data_transfer_backups(tenant_id, created_at DESC);
INSERT INTO migrations(version) VALUES(25);
