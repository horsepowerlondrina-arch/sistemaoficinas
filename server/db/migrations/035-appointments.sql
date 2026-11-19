CREATE TABLE appointments (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 starts_at TEXT NOT NULL, ends_at TEXT NOT NULL,
 plate TEXT NOT NULL, customer_id TEXT, customer_name TEXT NOT NULL, phone TEXT NOT NULL,
 planned_services TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'scheduled'
   CHECK(status IN ('scheduled','arrived','cancelled')),
 checklist_id TEXT, created_by TEXT NOT NULL REFERENCES users(id),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(tenant_id,id),
 CHECK(ends_at>starts_at)
);
CREATE INDEX appointments_tenant_day ON appointments(tenant_id,starts_at,status);
CREATE INDEX appointments_tenant_plate ON appointments(tenant_id,plate,starts_at);
INSERT INTO migrations(version) VALUES(35);
