-- Private retention state. No deletion or scheduled task is enabled by this migration.
CREATE TABLE platform_admin.workshop_retention_cases (
 tenant_id text NOT NULL,
 coverage_end date NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','notice_30','notice_60','notice_89','backup_verified','deleted','purged','blocked')),
 backup_id text,
 backup_manifest jsonb,
 backup_verified_at timestamptz,
 deleted_at timestamptz,
 recovery_expires_at timestamptz,
 last_error_code text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,coverage_end),
 CHECK ((backup_id IS NULL AND backup_manifest IS NULL AND backup_verified_at IS NULL) OR
        (backup_id IS NOT NULL AND backup_manifest IS NOT NULL AND backup_verified_at IS NOT NULL AND jsonb_typeof(backup_manifest)='object')),
 CHECK (status<>'deleted' OR (deleted_at IS NOT NULL AND recovery_expires_at=deleted_at+interval '15 days' AND backup_verified_at IS NOT NULL)),
 CHECK (status<>'purged' OR (deleted_at IS NOT NULL AND recovery_expires_at IS NOT NULL AND backup_manifest IS NULL))
);
CREATE INDEX workshop_retention_cases_due ON platform_admin.workshop_retention_cases(status,coverage_end);
CREATE TABLE platform_admin.workshop_retention_notices (
 tenant_id text NOT NULL,
 coverage_end date NOT NULL,
 days_late integer NOT NULL CHECK(days_late IN (30,60,89)),
 status text NOT NULL CHECK(status IN ('reserved','sent','failed')),
 reserved_at timestamptz NOT NULL DEFAULT now(),
 sent_at timestamptz,
 last_error_code text,
 PRIMARY KEY(tenant_id,coverage_end,days_late),
 FOREIGN KEY(tenant_id,coverage_end) REFERENCES platform_admin.workshop_retention_cases(tenant_id,coverage_end),
 CHECK ((status='sent')=(sent_at IS NOT NULL))
);
CREATE INDEX workshop_retention_notices_status ON platform_admin.workshop_retention_notices(status,reserved_at);
ALTER TABLE platform_admin.workshop_retention_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_admin.workshop_retention_notices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON platform_admin.workshop_retention_cases,platform_admin.workshop_retention_notices FROM PUBLIC;
CREATE POLICY workshop_retention_admin_cases ON platform_admin.workshop_retention_cases TO hp_platform_admin_app USING(true) WITH CHECK(true);
CREATE POLICY workshop_retention_admin_notices ON platform_admin.workshop_retention_notices TO hp_platform_admin_app USING(true) WITH CHECK(true);
GRANT SELECT,INSERT,UPDATE,DELETE ON platform_admin.workshop_retention_cases TO hp_platform_admin_app;
GRANT SELECT,INSERT,UPDATE ON platform_admin.workshop_retention_notices TO hp_platform_admin_app;
