CREATE TABLE horse_power.data_transfer_records (
  tenant_id text NOT NULL REFERENCES horse_power.tenants(id),
  source_application text NOT NULL,
  source_tenant_id text NOT NULL,
  table_name text NOT NULL,
  source_record_id text NOT NULL,
  source_hash text NOT NULL CHECK(source_hash ~ '^[a-f0-9]{64}$'),
  target_record_id text NOT NULL,
  target_hash text NOT NULL CHECK(target_hash ~ '^[a-f0-9]{64}$'),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,source_application,source_tenant_id,table_name,source_record_id)
);
ALTER TABLE horse_power.data_transfer_records ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON horse_power.data_transfer_records FROM PUBLIC, anon, authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON horse_power.data_transfer_records TO horse_power_app;
CREATE POLICY data_transfer_records_tenant ON horse_power.data_transfer_records FOR ALL TO horse_power_app
  USING(tenant_id=nullif(current_setting('app.tenant_id',true),''))
  WITH CHECK(tenant_id=nullif(current_setting('app.tenant_id',true),''));
CREATE INDEX data_transfer_records_target ON horse_power.data_transfer_records(tenant_id,table_name,target_record_id);

CREATE TABLE horse_power.data_transfer_backups (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES horse_power.tenants(id),
  created_by text NOT NULL REFERENCES horse_power.users(id),
  package_sha256 text NOT NULL CHECK(package_sha256 ~ '^[a-f0-9]{64}$'),
  package bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE horse_power.data_transfer_backups ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON horse_power.data_transfer_backups FROM PUBLIC, anon, authenticated;
GRANT SELECT,INSERT ON horse_power.data_transfer_backups TO horse_power_app;
CREATE POLICY data_transfer_backups_tenant ON horse_power.data_transfer_backups FOR SELECT TO horse_power_app
  USING(tenant_id=nullif(current_setting('app.tenant_id',true),''));
CREATE POLICY data_transfer_backups_insert ON horse_power.data_transfer_backups FOR INSERT TO horse_power_app
  WITH CHECK(tenant_id=nullif(current_setting('app.tenant_id',true),'') AND created_by=nullif(current_setting('app.user_id',true),''));
