ALTER TABLE tenants ADD COLUMN profile_data TEXT NOT NULL DEFAULT '{}';
ALTER TABLE orders ADD COLUMN identity_legacy INTEGER NOT NULL DEFAULT 0;
ALTER TABLE checklists ADD COLUMN identity_legacy INTEGER NOT NULL DEFAULT 0;
UPDATE orders SET identity_legacy=1;
UPDATE checklists SET identity_legacy=1;
ALTER TABLE public_shares ADD COLUMN document_revision INTEGER;
CREATE TABLE document_revisions (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id),
 kind TEXT NOT NULL CHECK(kind IN ('order','checklist')), entity_id TEXT NOT NULL,
 revision INTEGER NOT NULL CHECK(revision>0), issued_at TEXT NOT NULL,
 issued_by TEXT NOT NULL REFERENCES users(id), payload TEXT NOT NULL, digest TEXT NOT NULL,
 UNIQUE(tenant_id,kind,entity_id,revision)
);
CREATE INDEX document_revision_entity ON document_revisions(tenant_id,kind,entity_id,revision);
CREATE TRIGGER document_revision_no_update BEFORE UPDATE ON document_revisions BEGIN SELECT RAISE(ABORT,'Documento emitido é imutável'); END;
CREATE TRIGGER document_revision_no_delete BEFORE DELETE ON document_revisions BEGIN SELECT RAISE(ABORT,'Documento emitido é imutável'); END;
INSERT INTO migrations(version) VALUES(23);
