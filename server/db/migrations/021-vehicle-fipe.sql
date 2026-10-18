ALTER TABLE vehicles ADD COLUMN fipe_code TEXT NOT NULL DEFAULT '';
ALTER TABLE vehicles ADD COLUMN fipe_model TEXT NOT NULL DEFAULT '';
ALTER TABLE vehicles ADD COLUMN fipe_year_id TEXT NOT NULL DEFAULT '';
CREATE TABLE vehicle_lookup_cache (
 tenant_id TEXT NOT NULL REFERENCES tenants(id), plate TEXT NOT NULL,
 result_json TEXT NOT NULL, expires_at BIGINT NOT NULL,
 PRIMARY KEY(tenant_id,plate)
);
CREATE INDEX idx_vehicle_lookup_cache_expiry ON vehicle_lookup_cache(expires_at);
INSERT INTO migrations(version) VALUES(21);
