CREATE TABLE workshop_service_categories (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  name_key TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tenant_id,id),
  UNIQUE(tenant_id,name_key)
);
CREATE INDEX idx_workshop_service_categories_tenant_active
  ON workshop_service_categories(tenant_id,active,name);

ALTER TABLE workshop_services ADD COLUMN reference TEXT NOT NULL DEFAULT '';
ALTER TABLE workshop_services ADD COLUMN category_id TEXT REFERENCES workshop_service_categories(id);
WITH numbered AS (
  SELECT id, row_number() OVER(PARTITION BY tenant_id ORDER BY id) AS sequence
  FROM workshop_services
)
UPDATE workshop_services
SET reference='SRV-' || printf('%06d',(SELECT sequence FROM numbered WHERE numbered.id=workshop_services.id));

CREATE UNIQUE INDEX idx_workshop_services_reference
  ON workshop_services(tenant_id,upper(trim(reference)));
CREATE INDEX idx_workshop_services_private_category
  ON workshop_services(tenant_id,category_id,active,name);
CREATE TRIGGER trg_workshop_services_category_tenant_insert
BEFORE INSERT ON workshop_services
WHEN NEW.category_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM workshop_service_categories c
  WHERE c.id=NEW.category_id AND c.tenant_id=NEW.tenant_id
)
BEGIN SELECT RAISE(ABORT,'Categoria de serviço não pertence a esta oficina.'); END;
CREATE TRIGGER trg_workshop_services_category_tenant_update
BEFORE UPDATE OF tenant_id,category_id ON workshop_services
WHEN NEW.category_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM workshop_service_categories c
  WHERE c.id=NEW.category_id AND c.tenant_id=NEW.tenant_id
)
BEGIN SELECT RAISE(ABORT,'Categoria de serviço não pertence a esta oficina.'); END;
CREATE TRIGGER trg_workshop_services_reference_not_empty_insert
BEFORE INSERT ON workshop_services WHEN length(trim(NEW.reference))=0
BEGIN SELECT RAISE(ABORT,'Informe uma referência para o serviço.'); END;
CREATE TRIGGER trg_workshop_services_reference_not_empty_update
BEFORE UPDATE OF reference ON workshop_services WHEN length(trim(NEW.reference))=0
BEGIN SELECT RAISE(ABORT,'Informe uma referência para o serviço.'); END;
INSERT INTO migrations(version) VALUES(29);
