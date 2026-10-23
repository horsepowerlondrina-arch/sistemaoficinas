-- ADM-001.1: platform administration is isolated from workshop data.
CREATE SCHEMA platform_admin;

CREATE TABLE platform_admin.administrators (
  id text PRIMARY KEY,
  email text NOT NULL UNIQUE,
  display_name text NOT NULL,
  role text NOT NULL CHECK (role IN ('principal','finance','technical_support','commercial')),
  permissions jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(permissions)='array'),
  password_hash text NOT NULL DEFAULT '',
  totp_secret_ciphertext text NOT NULL DEFAULT '',
  active boolean NOT NULL DEFAULT false,
  enrolled boolean NOT NULL DEFAULT false,
  failed_attempts integer NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  locked_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz
);

CREATE TABLE platform_admin.sessions (
  token_hash text PRIMARY KEY,
  administrator_id text NOT NULL REFERENCES platform_admin.administrators(id),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX platform_admin_sessions_expiry ON platform_admin.sessions(expires_at);

CREATE TABLE platform_admin.login_attempts (
  attempt_key text PRIMARY KEY,
  count integer NOT NULL CHECK (count >= 0),
  window_started_at timestamptz NOT NULL,
  locked_until timestamptz
);

CREATE TABLE platform_admin.setup_tokens (
  token_hash text PRIMARY KEY,
  administrator_id text NOT NULL REFERENCES platform_admin.administrators(id),
  created_by text NOT NULL REFERENCES platform_admin.administrators(id),
  expires_at timestamptz NOT NULL,
  started_at timestamptz,
  used_at timestamptz,
  failed_attempts integer NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE platform_admin.audit_events (
  id text PRIMARY KEY,
  actor_administrator_id text REFERENCES platform_admin.administrators(id),
  subject_administrator_id text REFERENCES platform_admin.administrators(id),
  actor_email text NOT NULL DEFAULT '',
  action text NOT NULL,
  result text NOT NULL CHECK (result IN ('success','failure','blocked')),
  technical_context jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(technical_context)='object'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX platform_admin_audit_created ON platform_admin.audit_events(created_at DESC);
CREATE INDEX platform_admin_audit_actor ON platform_admin.audit_events(actor_administrator_id,created_at DESC);

CREATE TABLE platform_admin.critical_operation_requests (
  id text PRIMARY KEY,
  operation text NOT NULL,
  requested_by text NOT NULL REFERENCES platform_admin.administrators(id),
  approved_by text REFERENCES platform_admin.administrators(id),
  status text NOT NULL DEFAULT 'requested' CHECK(status IN ('requested','approved','rejected')),
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  CHECK (approved_by IS NULL OR approved_by <> requested_by),
  CHECK ((status='requested' AND approved_by IS NULL AND decided_at IS NULL) OR
         (status IN ('approved','rejected') AND approved_by IS NOT NULL AND decided_at IS NOT NULL))
);

CREATE TABLE platform_admin.settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL
);
INSERT INTO platform_admin.settings(key,value) VALUES ('audit_retention_days','365'::jsonb);

CREATE FUNCTION platform_admin.reject_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Eventos de auditoria são imutáveis'; END $$;
CREATE TRIGGER platform_admin_audit_immutable BEFORE UPDATE OR DELETE ON platform_admin.audit_events
FOR EACH ROW EXECUTE FUNCTION platform_admin.reject_audit_mutation();

REVOKE ALL ON SCHEMA platform_admin FROM PUBLIC, hp_local_app;
REVOKE ALL ON ALL TABLES IN SCHEMA platform_admin FROM PUBLIC, hp_local_app;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA platform_admin FROM PUBLIC, hp_local_app;
GRANT USAGE ON SCHEMA platform_admin TO hp_platform_admin_app;
GRANT SELECT,INSERT,UPDATE ON platform_admin.administrators TO hp_platform_admin_app;
GRANT SELECT,INSERT,UPDATE,DELETE ON platform_admin.sessions,platform_admin.login_attempts TO hp_platform_admin_app;
GRANT SELECT,INSERT,UPDATE ON platform_admin.setup_tokens TO hp_platform_admin_app;
GRANT SELECT,INSERT ON platform_admin.audit_events TO hp_platform_admin_app;
GRANT SELECT,INSERT ON platform_admin.critical_operation_requests TO hp_platform_admin_app;
GRANT SELECT ON platform_admin.settings TO hp_platform_admin_app;
REVOKE ALL ON SCHEMA horse_power, service_catalog FROM hp_platform_admin_app;
REVOKE ALL ON ALL TABLES IN SCHEMA horse_power, service_catalog FROM hp_platform_admin_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA platform_admin REVOKE ALL ON TABLES FROM PUBLIC, hp_local_app;
