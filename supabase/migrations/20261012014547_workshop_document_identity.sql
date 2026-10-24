ALTER TABLE horse_power.tenants ADD COLUMN legal_name TEXT NOT NULL DEFAULT '';
ALTER TABLE horse_power.tenants ADD COLUMN email TEXT NOT NULL DEFAULT '';
ALTER TABLE horse_power.tenants ADD COLUMN city TEXT NOT NULL DEFAULT '';
ALTER TABLE horse_power.tenants ADD COLUMN state TEXT NOT NULL DEFAULT '';
ALTER TABLE horse_power.tenants ADD COLUMN document_logo TEXT NOT NULL DEFAULT '';
INSERT INTO horse_power.migrations(version) VALUES(20);
