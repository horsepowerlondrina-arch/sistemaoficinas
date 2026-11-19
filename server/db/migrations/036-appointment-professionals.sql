ALTER TABLE appointments ADD COLUMN professional_id text;
CREATE INDEX appointments_professional_time ON appointments(tenant_id,professional_id,starts_at);
INSERT INTO migrations(version) VALUES(36);
