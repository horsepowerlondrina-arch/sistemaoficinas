CREATE TABLE card_machines (
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL REFERENCES tenants(id),
 name TEXT NOT NULL CHECK(length(trim(name))>0),
 name_key TEXT NOT NULL,
 operator TEXT NOT NULL CHECK(length(trim(operator))>0),
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
 is_default INTEGER NOT NULL DEFAULT 0 CHECK(is_default IN (0,1)),
 max_installments INTEGER NOT NULL DEFAULT 12 CHECK(max_installments BETWEEN 1 AND 24),
 CHECK(is_default=0 OR active=1),
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,name_key)
);
CREATE UNIQUE INDEX card_machine_one_default ON card_machines(tenant_id) WHERE is_default=1;
CREATE TABLE card_machine_rates (
 tenant_id TEXT NOT NULL,
 machine_id TEXT NOT NULL,
 method TEXT NOT NULL CHECK(method IN ('Cartão de débito','Cartão de crédito')),
 installments INTEGER NOT NULL CHECK(installments BETWEEN 1 AND 24),
 fee_bps INTEGER NOT NULL CHECK(fee_bps BETWEEN 0 AND 9999),
 CHECK(method<>'Cartão de débito' OR installments=1),
 PRIMARY KEY(tenant_id,machine_id,method,installments),
 FOREIGN KEY(tenant_id,machine_id) REFERENCES card_machines(tenant_id,id)
);
-- Only known settings are migrated. Zero is a registered rate; an absent row is not.
INSERT INTO card_machines(id,tenant_id,name,name_key,operator,active,is_default,max_installments)
SELECT 'legacy-card-'||t.id,t.id,'Máquina legada','máquina legada','Não informada',1,1,
 CASE WHEN COALESCE((SELECT MAX(installments) FROM card_rates WHERE tenant_id=t.id),1)>12
 THEN (SELECT MAX(installments) FROM card_rates WHERE tenant_id=t.id) ELSE 12 END
FROM tenants t WHERE EXISTS(SELECT 1 FROM payment_settings p WHERE p.tenant_id=t.id)
 OR EXISTS(SELECT 1 FROM card_rates c WHERE c.tenant_id=t.id);
INSERT INTO card_machine_rates(tenant_id,machine_id,method,installments,fee_bps)
SELECT c.tenant_id,'legacy-card-'||c.tenant_id,c.method,c.installments,c.fee_bps FROM card_rates c
WHERE c.method IN ('Cartão de débito','Cartão de crédito');
INSERT INTO card_machine_rates(tenant_id,machine_id,method,installments,fee_bps)
SELECT p.tenant_id,'legacy-card-'||p.tenant_id,'Cartão de débito',1,p.debit_fee_bps FROM payment_settings p
WHERE p.debit_fee_bps<10000 AND NOT EXISTS(SELECT 1 FROM card_rates c WHERE c.tenant_id=p.tenant_id AND c.method='Cartão de débito' AND c.installments=1);
INSERT INTO card_machine_rates(tenant_id,machine_id,method,installments,fee_bps)
SELECT p.tenant_id,'legacy-card-'||p.tenant_id,'Cartão de crédito',1,p.credit_fee_bps FROM payment_settings p
WHERE p.credit_fee_bps<10000 AND NOT EXISTS(SELECT 1 FROM card_rates c WHERE c.tenant_id=p.tenant_id AND c.method='Cartão de crédito' AND c.installments=1);
ALTER TABLE payment_installments ADD COLUMN machine_id TEXT;
ALTER TABLE payment_installments ADD COLUMN machine_name TEXT NOT NULL DEFAULT '';
ALTER TABLE payment_installments ADD COLUMN machine_operator TEXT NOT NULL DEFAULT '';
ALTER TABLE payment_installments ADD COLUMN card_fee_bps INTEGER;
ALTER TABLE payment_installments ADD COLUMN pass_card_fee INTEGER;
ALTER TABLE payment_installments ADD COLUMN interest_bps INTEGER;
ALTER TABLE payment_installments ADD COLUMN installment_count INTEGER;
-- Existing installment values and unknown historical machine/rate remain untouched.
INSERT INTO migrations(version) VALUES(31);
