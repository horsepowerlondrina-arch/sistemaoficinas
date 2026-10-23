CREATE TABLE labor_categories(
 id TEXT PRIMARY KEY CHECK(id IN ('compacto','medio','premium','pesado')),
 name TEXT NOT NULL UNIQUE,
 sort_order INTEGER NOT NULL UNIQUE
);
INSERT INTO labor_categories(id,name,sort_order) VALUES
 ('compacto','Compacto',1),('medio','Médio',2),('premium','Premium',3),('pesado','Pesado',4);
CREATE TABLE labor_commercial_rates(
 tenant_id TEXT NOT NULL REFERENCES tenants(id),
 category_id TEXT NOT NULL REFERENCES labor_categories(id),
 hourly_rate INTEGER NOT NULL CHECK(hourly_rate>0),
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(tenant_id,category_id)
);
ALTER TABLE workshop_services ADD COLUMN commercial_category_id TEXT REFERENCES labor_categories(id);
UPDATE workshop_services SET commercial_category_id=CASE
 WHEN porte_id IN (SELECT id FROM labor_portes WHERE name IN ('Básico Elétrico','SUV Compacto','Utilitário Compacto','Veículo Compacto')) THEN 'compacto'
 WHEN porte_id IN (SELECT id FROM labor_portes WHERE name IN ('SUV Médio','SUV e Sedan Elétrico','Utilitário Médio','Utilitário Médio Diesel','Veículo Médio')) THEN 'medio'
 WHEN porte_id IN (SELECT id FROM labor_portes WHERE name IN ('SUV Premium','SUV Premium Diesel','Utilitário Premium','Veículo Premium','Veículo de Luxo')) THEN 'premium'
 END;
CREATE INDEX idx_labor_commercial_rates_tenant ON labor_commercial_rates(tenant_id,category_id);
CREATE INDEX idx_workshop_services_category ON workshop_services(tenant_id,commercial_category_id,active,name);
INSERT INTO migrations(version) VALUES(24);
