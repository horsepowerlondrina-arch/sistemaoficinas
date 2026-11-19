ALTER TABLE horse_power.appointments ADD COLUMN professional_id text;
CREATE INDEX appointments_professional_time ON horse_power.appointments(tenant_id,professional_id,starts_at);
