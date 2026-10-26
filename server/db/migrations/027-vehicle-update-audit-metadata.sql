ALTER TABLE audit_events ADD COLUMN metadata TEXT NOT NULL DEFAULT '{}';
INSERT INTO migrations(version) VALUES(27);
