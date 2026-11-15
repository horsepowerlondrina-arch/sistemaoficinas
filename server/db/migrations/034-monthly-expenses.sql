CREATE TABLE payables_next (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), template_id TEXT, description TEXT NOT NULL,
 supplier TEXT NOT NULL DEFAULT '', category TEXT NOT NULL, amount INTEGER CHECK(amount>0), due_on TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','paid','cancelled')), paid_on TEXT, method TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', generation_month TEXT,
 CHECK(status<>'paid' OR amount IS NOT NULL),
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,template_id,generation_month), FOREIGN KEY(tenant_id,template_id) REFERENCES expense_templates(tenant_id,id)
);
INSERT INTO payables_next SELECT id,tenant_id,template_id,description,supplier,category,amount,due_on,status,paid_on,method,notes,CASE WHEN template_id IS NOT NULL THEN substr(due_on,1,7) END FROM payables;
DROP TABLE payables;
ALTER TABLE payables_next RENAME TO payables;
CREATE INDEX idx_payables_tenant_due ON payables(tenant_id,status,due_on);
CREATE TRIGGER payable_generation_month_immutable BEFORE UPDATE OF generation_month ON payables WHEN OLD.generation_month IS NOT NULL AND NEW.generation_month IS NOT OLD.generation_month BEGIN SELECT RAISE(ABORT,'Mês de geração não pode ser alterado.'); END;
CREATE TRIGGER payable_generation_month_default AFTER INSERT ON payables WHEN NEW.template_id IS NOT NULL AND NEW.generation_month IS NULL BEGIN UPDATE payables SET generation_month=substr(NEW.due_on,1,7) WHERE tenant_id=NEW.tenant_id AND id=NEW.id; END;
INSERT INTO migrations(version) VALUES(34);
