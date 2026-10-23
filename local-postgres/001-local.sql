-- Local-only baseline derived from the existing PostgreSQL migrations.
-- Never run against Supabase; credentials and grants use a separate local role.

-- Source: 20261003220749_horse_power_cloud.sql
-- Schema isolated from the Supabase Data API. Runtime access uses a dedicated backend role.
CREATE SCHEMA IF NOT EXISTS horse_power;
SET search_path=horse_power;
REVOKE ALL ON SCHEMA horse_power FROM PUBLIC;
CREATE TABLE IF NOT EXISTS migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (to_char(timezone('UTC', now()), 'YYYY-MM-DD HH24:MI:SS')));
ALTER TABLE "migrations" ENABLE ROW LEVEL SECURITY;
CREATE TABLE IF NOT EXISTS tenants (id TEXT PRIMARY KEY, name TEXT NOT NULL, document TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '', address TEXT NOT NULL DEFAULT '');
ALTER TABLE "tenants" ENABLE ROW LEVEL SECURITY;
CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL);
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
CREATE TABLE IF NOT EXISTS import_batches (id TEXT PRIMARY KEY, created_at TEXT NOT NULL DEFAULT (to_char(timezone('UTC', now()), 'YYYY-MM-DD HH24:MI:SS')), summary TEXT NOT NULL);
ALTER TABLE "import_batches" ENABLE ROW LEVEL SECURITY;
CREATE TABLE IF NOT EXISTS memberships (user_id TEXT NOT NULL REFERENCES users(id), tenant_id TEXT NOT NULL REFERENCES tenants(id), role TEXT NOT NULL CHECK(role IN ('owner','operator')), PRIMARY KEY(user_id,tenant_id));
ALTER TABLE "memberships" ENABLE ROW LEVEL SECURITY;
CREATE TABLE IF NOT EXISTS customers (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), name TEXT NOT NULL, phone TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '', document TEXT NOT NULL DEFAULT '', birthday TEXT NOT NULL DEFAULT '', address TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (to_char(timezone('UTC', now()), 'YYYY-MM-DD HH24:MI:SS')), UNIQUE(tenant_id,id));
ALTER TABLE "customers" ENABLE ROW LEVEL SECURITY;
CREATE TABLE IF NOT EXISTS professionals (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), name TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'Mecânico', phone TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1, UNIQUE(tenant_id,id));
ALTER TABLE "professionals" ENABLE ROW LEVEL SECURITY;
CREATE TABLE IF NOT EXISTS catalog (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), kind TEXT NOT NULL CHECK(kind IN ('product','service')), name TEXT NOT NULL, sku TEXT NOT NULL, category TEXT NOT NULL DEFAULT '', cost INTEGER NOT NULL CHECK(cost>=0), price INTEGER NOT NULL CHECK(price>=0), stock INTEGER NOT NULL DEFAULT 0 CHECK(stock>=0), minimum_stock INTEGER NOT NULL DEFAULT 0 CHECK(minimum_stock>=0), active INTEGER NOT NULL DEFAULT 1, cost_known INTEGER NOT NULL DEFAULT 1, stock_verified INTEGER NOT NULL DEFAULT 1, merged_into TEXT, UNIQUE(tenant_id,id), UNIQUE(tenant_id,sku));
ALTER TABLE "catalog" ENABLE ROW LEVEL SECURITY;
CREATE TABLE IF NOT EXISTS audit_events (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), user_id TEXT NOT NULL REFERENCES users(id), action TEXT NOT NULL, entity_id TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (to_char(timezone('UTC', now()), 'YYYY-MM-DD HH24:MI:SS')));
ALTER TABLE "audit_events" ENABLE ROW LEVEL SECURITY;
CREATE TABLE IF NOT EXISTS payment_settings (
 tenant_id TEXT PRIMARY KEY REFERENCES tenants(id), debit_fee_bps INTEGER NOT NULL DEFAULT 0 CHECK(debit_fee_bps BETWEEN 0 AND 10000),
 credit_fee_bps INTEGER NOT NULL DEFAULT 0 CHECK(credit_fee_bps BETWEEN 0 AND 10000),
 interest_bps INTEGER NOT NULL DEFAULT 0 CHECK(interest_bps BETWEEN 0 AND 10000)
);
ALTER TABLE "payment_settings" ENABLE ROW LEVEL SECURITY;
CREATE TABLE IF NOT EXISTS expense_templates (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), description TEXT NOT NULL,
 category TEXT NOT NULL, amount INTEGER CHECK(amount>=0), due_day INTEGER NOT NULL CHECK(due_day BETWEEN 1 AND 31),
 remaining_months INTEGER CHECK(remaining_months>0), start_month TEXT, source TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1,
 UNIQUE(tenant_id,id)
);
ALTER TABLE "expense_templates" ENABLE ROW LEVEL SECURITY;
CREATE TABLE IF NOT EXISTS card_rates (tenant_id TEXT NOT NULL REFERENCES tenants(id), method TEXT NOT NULL, installments INTEGER NOT NULL, fee_bps INTEGER NOT NULL CHECK(fee_bps BETWEEN 0 AND 9999), factor_bps INTEGER NOT NULL, PRIMARY KEY(tenant_id,method,installments));
ALTER TABLE "card_rates" ENABLE ROW LEVEL SECURITY;
CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), tenant_id TEXT NOT NULL, expires_at BIGINT NOT NULL, FOREIGN KEY(user_id,tenant_id) REFERENCES memberships(user_id,tenant_id));
ALTER TABLE "sessions" ENABLE ROW LEVEL SECURITY;
CREATE TABLE IF NOT EXISTS vehicles (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), customer_id TEXT NOT NULL, plate TEXT NOT NULL, brand TEXT NOT NULL, model TEXT NOT NULL, year INTEGER NOT NULL, color TEXT NOT NULL DEFAULT '', km INTEGER NOT NULL DEFAULT 0 CHECK(km>=0), chassis TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1, UNIQUE(tenant_id,id), UNIQUE(tenant_id,plate), FOREIGN KEY(tenant_id,customer_id) REFERENCES customers(tenant_id,id));
ALTER TABLE "vehicles" ENABLE ROW LEVEL SECURITY;
CREATE TABLE IF NOT EXISTS payables (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), template_id TEXT, description TEXT NOT NULL,
 supplier TEXT NOT NULL DEFAULT '', category TEXT NOT NULL, amount INTEGER NOT NULL CHECK(amount>0), due_on TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','paid','cancelled')), paid_on TEXT, method TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '',
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,template_id,due_on), FOREIGN KEY(tenant_id,template_id) REFERENCES expense_templates(tenant_id,id)
);
ALTER TABLE "payables" ENABLE ROW LEVEL SECURITY;
CREATE TABLE IF NOT EXISTS service_aliases (
 tenant_id TEXT NOT NULL, alias_key TEXT NOT NULL, alias TEXT NOT NULL, catalog_id TEXT NOT NULL,
 PRIMARY KEY(tenant_id,alias_key), FOREIGN KEY(tenant_id,catalog_id) REFERENCES catalog(tenant_id,id)
);
ALTER TABLE "service_aliases" ENABLE ROW LEVEL SECURITY;
CREATE TABLE IF NOT EXISTS service_merge_history (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), canonical_id TEXT NOT NULL,
 previous_records TEXT NOT NULL, merged_at TEXT NOT NULL DEFAULT (to_char(timezone('UTC', now()), 'YYYY-MM-DD HH24:MI:SS')),
 FOREIGN KEY(tenant_id,canonical_id) REFERENCES catalog(tenant_id,id)
);
ALTER TABLE "service_merge_history" ENABLE ROW LEVEL SECURITY;
CREATE TABLE IF NOT EXISTS "orders" (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), number INTEGER NOT NULL,
 kind TEXT NOT NULL DEFAULT 'order' CHECK(kind IN ('quote','order')),
 customer_id TEXT, vehicle_id TEXT, guest_name TEXT NOT NULL DEFAULT '', guest_plate TEXT NOT NULL DEFAULT '', guest_vehicle TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL CHECK(status IN ('quote','open','working','ready','completed','cancelled')),
 entered_on TEXT NOT NULL, due_on TEXT NOT NULL, completed_on TEXT, km INTEGER NOT NULL CHECK(km>=0),
 problem TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', discount INTEGER NOT NULL DEFAULT 0 CHECK(discount>=0), total INTEGER NOT NULL DEFAULT 0 CHECK(total>=0), created_at TEXT NOT NULL DEFAULT (to_char(timezone('UTC', now()), 'YYYY-MM-DD HH24:MI:SS')), source TEXT NOT NULL DEFAULT '', historical_payment TEXT NOT NULL DEFAULT '', product_cost_total INTEGER, service_cost_total INTEGER, historical_fee INTEGER,
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,number),
 FOREIGN KEY(tenant_id,customer_id) REFERENCES customers(tenant_id,id), FOREIGN KEY(tenant_id,vehicle_id) REFERENCES vehicles(tenant_id,id),
 CHECK(kind='quote' OR (customer_id IS NOT NULL AND vehicle_id IS NOT NULL))
);
ALTER TABLE "orders" ENABLE ROW LEVEL SECURITY;
CREATE TABLE IF NOT EXISTS order_items (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, order_id TEXT NOT NULL, catalog_id TEXT NOT NULL, professional_id TEXT, kind TEXT NOT NULL, name TEXT NOT NULL, quantity INTEGER NOT NULL CHECK(quantity>0), price INTEGER NOT NULL CHECK(price>=0), cost INTEGER NOT NULL CHECK(cost>=0), FOREIGN KEY(tenant_id,order_id) REFERENCES orders(tenant_id,id), FOREIGN KEY(tenant_id,catalog_id) REFERENCES catalog(tenant_id,id), FOREIGN KEY(tenant_id,professional_id) REFERENCES professionals(tenant_id,id));
ALTER TABLE "order_items" ENABLE ROW LEVEL SECURITY;
CREATE TABLE IF NOT EXISTS stock_movements (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, catalog_id TEXT NOT NULL, order_id TEXT, quantity INTEGER NOT NULL, reason TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL DEFAULT (to_char(timezone('UTC', now()), 'YYYY-MM-DD HH24:MI:SS')), FOREIGN KEY(tenant_id,catalog_id) REFERENCES catalog(tenant_id,id), FOREIGN KEY(tenant_id,order_id) REFERENCES orders(tenant_id,id));
ALTER TABLE "stock_movements" ENABLE ROW LEVEL SECURITY;
CREATE TABLE IF NOT EXISTS receivables (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, order_id TEXT NOT NULL, customer_id TEXT NOT NULL, description TEXT NOT NULL, amount INTEGER NOT NULL CHECK(amount>=0), due_on TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','paid')), method TEXT, paid_at TEXT, plan_configured INTEGER NOT NULL DEFAULT 0, installment_count INTEGER NOT NULL DEFAULT 1, card_fee_bps INTEGER NOT NULL DEFAULT 0, interest_bps INTEGER NOT NULL DEFAULT 0, gross_total INTEGER NOT NULL DEFAULT 0, fee_total INTEGER NOT NULL DEFAULT 0, net_total INTEGER NOT NULL DEFAULT 0, UNIQUE(tenant_id,id), UNIQUE(tenant_id,order_id), FOREIGN KEY(tenant_id,order_id) REFERENCES orders(tenant_id,id), FOREIGN KEY(tenant_id,customer_id) REFERENCES customers(tenant_id,id));
ALTER TABLE "receivables" ENABLE ROW LEVEL SECURITY;
CREATE TABLE IF NOT EXISTS public_shares (token_hash TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, order_id TEXT NOT NULL, expires_at BIGINT NOT NULL, revoked INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (to_char(timezone('UTC', now()), 'YYYY-MM-DD HH24:MI:SS')), FOREIGN KEY(tenant_id,order_id) REFERENCES orders(tenant_id,id));
ALTER TABLE "public_shares" ENABLE ROW LEVEL SECURITY;
CREATE TABLE IF NOT EXISTS payment_installments (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, receivable_id TEXT NOT NULL, sequence INTEGER NOT NULL,
 due_on TEXT NOT NULL, principal INTEGER NOT NULL CHECK(principal>=0), interest INTEGER NOT NULL CHECK(interest>=0),
 gross INTEGER NOT NULL CHECK(gross>=0), fee INTEGER NOT NULL CHECK(fee>=0), net INTEGER NOT NULL CHECK(net>=0),
 status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','paid')), paid_at TEXT, method TEXT NOT NULL,
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,receivable_id,sequence),
 FOREIGN KEY(tenant_id,receivable_id) REFERENCES receivables(tenant_id,id)
);
ALTER TABLE "payment_installments" ENABLE ROW LEVEL SECURITY;
CREATE TABLE IF NOT EXISTS "cash_entries" (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, receivable_id TEXT NOT NULL, installment_id TEXT NOT NULL,
 amount INTEGER NOT NULL, gross_amount INTEGER NOT NULL, fee_amount INTEGER NOT NULL DEFAULT 0, method TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT (to_char(timezone('UTC', now()), 'YYYY-MM-DD HH24:MI:SS')),
 UNIQUE(tenant_id,installment_id),
 FOREIGN KEY(tenant_id,receivable_id) REFERENCES receivables(tenant_id,id),
 FOREIGN KEY(tenant_id,installment_id) REFERENCES payment_installments(tenant_id,id)
);
ALTER TABLE "cash_entries" ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_customers_tenant ON customers(tenant_id,name);
CREATE INDEX IF NOT EXISTS idx_items_order ON order_items(tenant_id,order_id);
CREATE INDEX IF NOT EXISTS idx_receivables_tenant ON receivables(tenant_id,status,due_on);
CREATE INDEX IF NOT EXISTS idx_vehicles_tenant ON vehicles(tenant_id,customer_id);
CREATE INDEX IF NOT EXISTS idx_stock_tenant ON stock_movements(tenant_id,created_at);
CREATE INDEX IF NOT EXISTS idx_orders_tenant ON orders(tenant_id,kind,status,due_on);
CREATE INDEX IF NOT EXISTS idx_installments_tenant ON payment_installments(tenant_id,receivable_id,status);
CREATE INDEX IF NOT EXISTS idx_cash_tenant ON cash_entries(tenant_id,created_at);
CREATE INDEX IF NOT EXISTS idx_payables_tenant_due ON payables(tenant_id,status,due_on);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payable_template_month ON payables(tenant_id,template_id,substr(due_on,1,7));
CREATE TABLE IF NOT EXISTS admin_setup (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires_at BIGINT NOT NULL, used_at TEXT);
ALTER TABLE admin_setup ENABLE ROW LEVEL SECURITY;
CREATE TABLE IF NOT EXISTS login_attempts (key TEXT PRIMARY KEY, count INTEGER NOT NULL, until_at BIGINT NOT NULL);
ALTER TABLE login_attempts ENABLE ROW LEVEL SECURITY;


-- Source: 20261004000120_extension_capture.sql
BEGIN;
SET LOCAL search_path = horse_power, pg_catalog;
CREATE TABLE capture_sessions (
 token_hash TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), user_id TEXT NOT NULL REFERENCES users(id),
 session_hash TEXT NOT NULL, order_id TEXT NOT NULL, expires_at BIGINT NOT NULL,
 FOREIGN KEY(tenant_id,order_id) REFERENCES orders(tenant_id,id)
);
CREATE INDEX idx_capture_sessions_order ON capture_sessions(tenant_id,order_id);
CREATE TABLE external_catalog_links (
 tenant_id TEXT NOT NULL, source TEXT NOT NULL, external_key TEXT NOT NULL, catalog_id TEXT NOT NULL,
 PRIMARY KEY(tenant_id,source,external_key), FOREIGN KEY(tenant_id,catalog_id) REFERENCES catalog(tenant_id,id)
);
CREATE TABLE external_captures (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, capture_id TEXT NOT NULL, order_id TEXT NOT NULL, item_id TEXT NOT NULL,
 catalog_id TEXT NOT NULL, source TEXT NOT NULL, external_key TEXT NOT NULL, payload_hash TEXT NOT NULL,
 duration_seconds INTEGER, source_cost INTEGER NOT NULL, source_price INTEGER NOT NULL, vehicle_label TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(tenant_id,capture_id), FOREIGN KEY(tenant_id,order_id) REFERENCES orders(tenant_id,id),
 FOREIGN KEY(tenant_id,catalog_id) REFERENCES catalog(tenant_id,id)
);
CREATE INDEX idx_external_captures_order ON external_captures(tenant_id,order_id,item_id);
CREATE TABLE service_times (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, catalog_id TEXT NOT NULL, capture_id TEXT NOT NULL,
 source TEXT NOT NULL, service_name TEXT NOT NULL, make TEXT NOT NULL DEFAULT '', model TEXT NOT NULL DEFAULT '',
 vehicle_year TEXT NOT NULL DEFAULT '', engine TEXT NOT NULL DEFAULT '', duration_seconds INTEGER NOT NULL CHECK(duration_seconds>0),
 source_price INTEGER NOT NULL CHECK(source_price>=0), captured_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(tenant_id,capture_id), FOREIGN KEY(tenant_id,catalog_id) REFERENCES catalog(tenant_id,id)
);
CREATE INDEX idx_service_times_catalog ON service_times(tenant_id,catalog_id);
INSERT INTO migrations(version) VALUES(7);
ALTER TABLE capture_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON capture_sessions FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE,DELETE ON capture_sessions TO hp_local_app;
CREATE POLICY backend_access ON capture_sessions FOR ALL TO hp_local_app USING (true) WITH CHECK (true);
ALTER TABLE external_catalog_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON external_catalog_links FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE,DELETE ON external_catalog_links TO hp_local_app;
CREATE POLICY backend_access ON external_catalog_links FOR ALL TO hp_local_app USING (true) WITH CHECK (true);
ALTER TABLE external_captures ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON external_captures FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE,DELETE ON external_captures TO hp_local_app;
CREATE POLICY backend_access ON external_captures FOR ALL TO hp_local_app USING (true) WITH CHECK (true);
ALTER TABLE service_times ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON service_times FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE,DELETE ON service_times TO hp_local_app;
CREATE POLICY backend_access ON service_times FOR ALL TO hp_local_app USING (true) WITH CHECK (true);
COMMIT;


-- Source: 20261004011348_extension_only_catalog.sql
BEGIN;
ALTER TABLE horse_power.tenants ADD COLUMN catalog_mode TEXT NOT NULL DEFAULT 'standard' CHECK(catalog_mode IN ('standard','extension'));
ALTER TABLE horse_power.catalog ADD COLUMN archived_at TEXT;
INSERT INTO horse_power.migrations(version) VALUES(8);
COMMIT;


-- Source: 20261004013943_catalog_stock_pricing.sql
BEGIN;
ALTER TABLE horse_power.capture_sessions ALTER COLUMN order_id DROP NOT NULL;
ALTER TABLE horse_power.capture_sessions ADD COLUMN catalog_target TEXT;
ALTER TABLE horse_power.external_captures ALTER COLUMN order_id DROP NOT NULL;
ALTER TABLE horse_power.external_captures ALTER COLUMN item_id DROP NOT NULL;
ALTER TABLE horse_power.external_captures ADD COLUMN catalog_target TEXT;
CREATE INDEX idx_external_captures_catalog_target ON horse_power.external_captures(tenant_id,catalog_target);
ALTER TABLE horse_power.tenants ADD COLUMN parts_pricing_mode TEXT NOT NULL DEFAULT 'legacy' CHECK(parts_pricing_mode IN ('legacy','markup','margin'));
ALTER TABLE horse_power.tenants ADD COLUMN parts_pricing_bps INTEGER NOT NULL DEFAULT 4000 CHECK(parts_pricing_bps>=0 AND parts_pricing_bps<=100000);
INSERT INTO horse_power.migrations(version) VALUES(9);
ALTER TABLE horse_power.stock_movements ADD COLUMN unit_cost INTEGER;
ALTER TABLE horse_power.stock_movements ADD COLUMN unit_price INTEGER;
ALTER TABLE horse_power.tenants ADD COLUMN parts_pricing_rules TEXT;
ALTER TABLE horse_power.capture_sessions ADD COLUMN freight_unit INTEGER NOT NULL DEFAULT 0;
ALTER TABLE horse_power.catalog ADD COLUMN freight_unit INTEGER NOT NULL DEFAULT 0;
ALTER TABLE horse_power.stock_movements ADD COLUMN freight_unit INTEGER;
COMMIT;


-- Source: 20261008030628_cash_control_recurring_expenses.sql
SET search_path=horse_power;
ALTER TABLE expense_templates ADD COLUMN supplier TEXT NOT NULL DEFAULT '';
ALTER TABLE expense_templates ADD COLUMN deleted_at TEXT;
CREATE TABLE cash_accounts (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), name TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('bank','cash')), opening_balance INTEGER NOT NULL CHECK(opening_balance BETWEEN -100000000 AND 100000000),
 opening_on TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(tenant_id,id)
);
CREATE TABLE cash_movements (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), account_id TEXT NOT NULL,
 day TEXT NOT NULL, amount BIGINT NOT NULL, gross_amount BIGINT NOT NULL DEFAULT 0, fee_amount BIGINT NOT NULL DEFAULT 0,
 description TEXT NOT NULL, method TEXT NOT NULL DEFAULT '',
 origin TEXT NOT NULL CHECK(origin IN ('receipt','expense','adjustment')), source_id TEXT NOT NULL,
 source_payload TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(tenant_id,origin,source_id), FOREIGN KEY(tenant_id,account_id) REFERENCES cash_accounts(tenant_id,id)
);
CREATE INDEX idx_cash_movement_account_day ON cash_movements(tenant_id,account_id,day);
INSERT INTO migrations(version) VALUES(14) ON CONFLICT DO NOTHING;

ALTER TABLE cash_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_movements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON cash_accounts,cash_movements FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE,DELETE ON cash_accounts,cash_movements TO hp_local_app;
CREATE POLICY backend_access ON cash_accounts FOR ALL TO hp_local_app USING (true) WITH CHECK (true);
CREATE POLICY backend_access ON cash_movements FOR ALL TO hp_local_app USING (true) WITH CHECK (true);


-- Source: 20261009014847_product_categories.sql
SET search_path=horse_power;
CREATE TABLE product_categories (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), name TEXT NOT NULL,
 name_key TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(tenant_id,name_key)
);
CREATE INDEX idx_product_categories_active ON product_categories(tenant_id,active,name);
INSERT INTO product_categories(id,tenant_id,name,name_key)
SELECT gen_random_uuid()::text,tenant_id,min(trim(category)),lower(trim(category)) FROM catalog
WHERE kind='product' AND trim(category)<>'' AND lower(trim(category)) NOT IN ('sky peças','skypeças','skypecas','accioly','scherer','histórico importado','importado do histórico','importação os em andamento')
GROUP BY tenant_id,lower(trim(category)) ON CONFLICT (tenant_id,name_key) DO NOTHING;
INSERT INTO product_categories(id,tenant_id,name,name_key) SELECT gen_random_uuid()::text,id,'ACESSORIO','acessorio' FROM tenants ON CONFLICT (tenant_id,name_key) DO NOTHING;
INSERT INTO product_categories(id,tenant_id,name,name_key) SELECT gen_random_uuid()::text,id,'ADM','adm' FROM tenants ON CONFLICT (tenant_id,name_key) DO NOTHING;
INSERT INTO product_categories(id,tenant_id,name,name_key) SELECT gen_random_uuid()::text,id,'ALTERNADOR','alternador' FROM tenants ON CONFLICT (tenant_id,name_key) DO NOTHING;
INSERT INTO product_categories(id,tenant_id,name,name_key) SELECT gen_random_uuid()::text,id,'ARREFECIMENTO','arrefecimento' FROM tenants ON CONFLICT (tenant_id,name_key) DO NOTHING;
INSERT INTO product_categories(id,tenant_id,name,name_key) SELECT gen_random_uuid()::text,id,'CABO','cabo' FROM tenants ON CONFLICT (tenant_id,name_key) DO NOTHING;
INSERT INTO product_categories(id,tenant_id,name,name_key) SELECT gen_random_uuid()::text,id,'CAMBIO','cambio' FROM tenants ON CONFLICT (tenant_id,name_key) DO NOTHING;
INSERT INTO migrations(version) VALUES(15) ON CONFLICT DO NOTHING;
ALTER TABLE product_categories ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON product_categories FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE,DELETE ON product_categories TO hp_local_app;
CREATE POLICY backend_access ON product_categories FOR ALL TO hp_local_app USING (true) WITH CHECK (true);


-- Source: 20261009021633_product_identity.sql
SET search_path=horse_power;
ALTER TABLE catalog ADD COLUMN brand TEXT NOT NULL DEFAULT '';
ALTER TABLE catalog ADD COLUMN manufacturer_code TEXT NOT NULL DEFAULT '';
ALTER TABLE catalog ADD COLUMN application TEXT NOT NULL DEFAULT '';
ALTER TABLE catalog ADD COLUMN usage_vehicles TEXT NOT NULL DEFAULT '';
ALTER TABLE catalog ADD COLUMN category_confirmed INTEGER NOT NULL DEFAULT 0 CHECK(category_confirmed IN (0,1));
UPDATE catalog SET
 manufacturer_code=COALESCE((SELECT split_part(l.external_key,'|',1) FROM external_catalog_links l WHERE l.tenant_id=catalog.tenant_id AND l.catalog_id=catalog.id AND l.source='sky'), ''),
 brand=COALESCE((SELECT split_part(l.external_key,'|',2) FROM external_catalog_links l WHERE l.tenant_id=catalog.tenant_id AND l.catalog_id=catalog.id AND l.source='sky'), '')
 WHERE kind='product' AND (SELECT count(*) FROM external_catalog_links l WHERE l.tenant_id=catalog.tenant_id AND l.catalog_id=catalog.id AND l.source='sky')=1;
UPDATE catalog SET category_confirmed=1 WHERE kind='product' AND EXISTS(SELECT 1 FROM product_categories c WHERE c.tenant_id=catalog.tenant_id AND c.name=catalog.category AND c.active=1);
UPDATE catalog SET usage_vehicles=COALESCE((SELECT string_agg(DISTINCT (v.brand || ' · ' || v.model || ' · ' || v.year::text),', ') FROM order_items i JOIN orders o ON o.id=i.order_id AND o.tenant_id=i.tenant_id JOIN vehicles v ON v.id=o.vehicle_id AND v.tenant_id=o.tenant_id WHERE i.tenant_id=catalog.tenant_id AND i.catalog_id=catalog.id),'') WHERE kind='product';
INSERT INTO migrations(version) VALUES(16) ON CONFLICT DO NOTHING;


-- Source: 20261009041516_credit_card_settlement.sql
SET search_path=horse_power;
ALTER TABLE receivables ADD COLUMN card_sale_on TEXT NOT NULL DEFAULT '';
INSERT INTO migrations(version) VALUES(17) ON CONFLICT DO NOTHING;


-- Source: 20261011171803_stock_invoice_import.sql
CREATE TABLE horse_power.stock_invoices (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES horse_power.tenants(id),
 invoice_key TEXT NOT NULL, supplier_document TEXT NOT NULL, supplier_name TEXT NOT NULL,
 invoice_number TEXT NOT NULL, issued_on TEXT NOT NULL, xml_hash TEXT NOT NULL,
 summary TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES horse_power.users(id),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(tenant_id,invoice_key)
);
CREATE TABLE horse_power.stock_invoice_products (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES horse_power.tenants(id),
 supplier_document TEXT NOT NULL, supplier_code TEXT NOT NULL, unit TEXT NOT NULL,
 gtin TEXT NOT NULL DEFAULT '', catalog_id TEXT NOT NULL,
 quantity_factor REAL NOT NULL DEFAULT 1 CHECK(quantity_factor>0),
 UNIQUE(tenant_id,supplier_document,supplier_code,unit),
 FOREIGN KEY(tenant_id,catalog_id) REFERENCES horse_power.catalog(tenant_id,id)
);
CREATE INDEX idx_stock_invoices_tenant ON horse_power.stock_invoices(tenant_id,created_at);
CREATE INDEX idx_stock_invoice_gtin ON horse_power.stock_invoice_products(tenant_id,gtin);
INSERT INTO horse_power.migrations(version) VALUES(18);

ALTER TABLE horse_power.stock_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE horse_power.stock_invoice_products ENABLE ROW LEVEL SECURITY;
CREATE POLICY backend_access ON horse_power.stock_invoices FOR ALL TO hp_local_app USING(true) WITH CHECK(true);
CREATE POLICY backend_access ON horse_power.stock_invoice_products FOR ALL TO hp_local_app USING(true) WITH CHECK(true);
REVOKE ALL ON horse_power.stock_invoices,horse_power.stock_invoice_products FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE,DELETE ON horse_power.stock_invoices,horse_power.stock_invoice_products TO hp_local_app;


-- Source: 20261012003749_supplier_registry.sql
CREATE TABLE horse_power.suppliers (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES horse_power.tenants(id),
 name TEXT NOT NULL, trade_name TEXT NOT NULL DEFAULT '', document TEXT,
 phone TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '',
 address TEXT NOT NULL DEFAULT '', number TEXT NOT NULL DEFAULT '', complement TEXT NOT NULL DEFAULT '',
 district TEXT NOT NULL DEFAULT '', city TEXT NOT NULL DEFAULT '', state TEXT NOT NULL DEFAULT '',
 postal_code TEXT NOT NULL DEFAULT '', seller TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '',
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN(0,1)),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,document)
);
CREATE INDEX idx_suppliers_tenant_name ON horse_power.suppliers(tenant_id,name);
ALTER TABLE horse_power.stock_invoices ADD COLUMN supplier_id TEXT;
ALTER TABLE horse_power.stock_invoice_products ADD COLUMN supplier_id TEXT;
ALTER TABLE horse_power.stock_invoice_products ADD COLUMN last_cost INTEGER CHECK(last_cost>=0);
ALTER TABLE horse_power.stock_invoice_products ADD COLUMN last_purchase_on TEXT NOT NULL DEFAULT '';
INSERT INTO horse_power.suppliers(id,tenant_id,name,document)
SELECT gen_random_uuid()::text,tenant_id,max(supplier_name),supplier_document
FROM horse_power.stock_invoices GROUP BY tenant_id,supplier_document;
UPDATE horse_power.stock_invoices i SET supplier_id=s.id FROM horse_power.suppliers s WHERE s.tenant_id=i.tenant_id AND s.document=i.supplier_document;
UPDATE horse_power.stock_invoice_products p SET supplier_id=s.id FROM horse_power.suppliers s WHERE s.tenant_id=p.tenant_id AND s.document=p.supplier_document;
ALTER TABLE horse_power.stock_invoices ADD CONSTRAINT stock_invoice_supplier_fk FOREIGN KEY(tenant_id,supplier_id) REFERENCES horse_power.suppliers(tenant_id,id);
ALTER TABLE horse_power.stock_invoice_products ADD CONSTRAINT stock_product_supplier_fk FOREIGN KEY(tenant_id,supplier_id) REFERENCES horse_power.suppliers(tenant_id,id);
CREATE INDEX idx_stock_invoice_supplier ON horse_power.stock_invoices(tenant_id,supplier_id);
CREATE INDEX idx_stock_product_supplier ON horse_power.stock_invoice_products(tenant_id,supplier_id);
INSERT INTO horse_power.migrations(version) VALUES(19);
ALTER TABLE horse_power.suppliers ENABLE ROW LEVEL SECURITY;
CREATE POLICY backend_access ON horse_power.suppliers FOR ALL TO hp_local_app USING(true) WITH CHECK(true);
REVOKE ALL ON horse_power.suppliers FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE,DELETE ON horse_power.suppliers TO hp_local_app;


-- Source: 20261012014547_workshop_document_identity.sql
ALTER TABLE horse_power.tenants ADD COLUMN legal_name TEXT NOT NULL DEFAULT '';
ALTER TABLE horse_power.tenants ADD COLUMN email TEXT NOT NULL DEFAULT '';
ALTER TABLE horse_power.tenants ADD COLUMN city TEXT NOT NULL DEFAULT '';
ALTER TABLE horse_power.tenants ADD COLUMN state TEXT NOT NULL DEFAULT '';
ALTER TABLE horse_power.tenants ADD COLUMN document_logo TEXT NOT NULL DEFAULT '';
UPDATE horse_power.tenants SET email='horsepowerlondrina@gmail.com',city='Londrina',state='PR',document_logo='/brand/icon.jpg' WHERE id='hp-centro';
INSERT INTO horse_power.migrations(version) VALUES(20);


-- Source: 20261018193641_vehicle_fipe_candidates_cache.sql
SET search_path=horse_power;
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


ALTER TABLE horse_power.vehicle_lookup_cache ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON horse_power.vehicle_lookup_cache FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE,DELETE ON horse_power.vehicle_lookup_cache TO hp_local_app;
CREATE POLICY backend_access ON horse_power.vehicle_lookup_cache FOR ALL TO hp_local_app USING(true) WITH CHECK(true);


-- Source: 20261019215935_service_catalog_operational_structure.sql
CREATE SCHEMA service_catalog;
REVOKE ALL ON SCHEMA service_catalog FROM PUBLIC,hp_local_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA service_catalog REVOKE ALL ON TABLES FROM PUBLIC,hp_local_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA service_catalog REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC,hp_local_app;
SET LOCAL search_path=service_catalog,pg_catalog;
CREATE TABLE releases(version text PRIMARY KEY,status text NOT NULL CHECK(status IN ('loading','active','retired')), source_sha256 text NOT NULL, imported_at timestamptz NOT NULL DEFAULT now(),validated_at timestamptz,model_count integer NOT NULL,time_count integer NOT NULL,application_count bigint NOT NULL);
CREATE TABLE tenant_access(tenant_id text PRIMARY KEY REFERENCES horse_power.tenants(id),enabled boolean NOT NULL DEFAULT false,valid_until timestamptz,grant_reason text NOT NULL,updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE brands(id UUID PRIMARY KEY,name TEXT);
CREATE TABLE classifications(id UUID PRIMARY KEY,name TEXT NOT NULL UNIQUE);
CREATE TABLE families(id UUID PRIMARY KEY,brand_id UUID NOT NULL REFERENCES brands(id));
CREATE TABLE bases(id UUID PRIMARY KEY,family_id UUID NOT NULL REFERENCES families(id),service_count INTEGER NOT NULL);
CREATE TABLE services(id UUID PRIMARY KEY,name TEXT NOT NULL);
CREATE TABLE models(id UUID PRIMARY KEY,brand_id UUID NOT NULL REFERENCES brands(id),family_id UUID NOT NULL REFERENCES families(id),classification_id UUID REFERENCES classifications(id),name TEXT NOT NULL,fipe_code TEXT NOT NULL,complete INTEGER NOT NULL,service_count INTEGER NOT NULL,base_id UUID REFERENCES bases(id),excluded_service_ids TEXT NOT NULL);
CREATE TABLE repair_times(id UUID PRIMARY KEY,base_id UUID REFERENCES bases(id),model_id UUID REFERENCES models(id),service_id UUID NOT NULL REFERENCES services(id),service_name TEXT NOT NULL,minutes DOUBLE PRECISION NOT NULL CHECK(minutes>=0),time_identifier TEXT, CHECK((base_id IS NOT NULL AND model_id IS NULL) OR (base_id IS NULL AND model_id IS NOT NULL)));
REVOKE ALL ON ALL TABLES IN SCHEMA service_catalog FROM PUBLIC,hp_local_app;


-- Source: 20261019220654_activate_readonly_service_catalog.sql
SET LOCAL search_path=service_catalog,pg_catalog;

CREATE UNIQUE INDEX base_service ON repair_times(base_id,service_id) WHERE base_id IS NOT NULL;
CREATE UNIQUE INDEX model_service ON repair_times(model_id,service_id) WHERE model_id IS NOT NULL;
CREATE INDEX model_fipe ON models(fipe_code);
CREATE INDEX model_family ON models(family_id);
CREATE INDEX model_brand ON models(brand_id);
CREATE INDEX model_base ON models(base_id);
CREATE INDEX model_classification ON models(classification_id);
CREATE INDEX family_brand ON families(brand_id);
CREATE INDEX base_family ON bases(family_id);
CREATE INDEX time_service ON repair_times(service_id);
CREATE VIEW model_services WITH (security_invoker=true) AS
 SELECT m.id model_id,t.service_id,t.service_name,t.minutes,t.time_identifier,t.id repair_time_id
 FROM models m JOIN repair_times t ON t.base_id=m.base_id
 WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(m.excluded_service_ids::jsonb) e(value) WHERE e.value=t.service_id::text)
 AND NOT EXISTS(SELECT 1 FROM repair_times x WHERE x.model_id=m.id AND x.service_id=t.service_id)
 UNION ALL SELECT t.model_id,t.service_id,t.service_name,t.minutes,t.time_identifier,t.id FROM repair_times t WHERE t.model_id IS NOT NULL;
REVOKE ALL ON ALL TABLES IN SCHEMA service_catalog FROM PUBLIC,hp_local_app;
REVOKE ALL ON SCHEMA service_catalog FROM PUBLIC;

GRANT USAGE ON SCHEMA service_catalog TO hp_local_app;
GRANT SELECT ON ALL TABLES IN SCHEMA service_catalog TO hp_local_app;
ALTER TABLE tenant_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_access FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_read ON tenant_access FOR SELECT TO hp_local_app USING(tenant_id = nullif(current_setting('app.tenant_id',true),''));
ALTER TABLE releases ENABLE ROW LEVEL SECURITY;
ALTER TABLE releases FORCE ROW LEVEL SECURITY;
CREATE POLICY release_read ON releases FOR SELECT TO hp_local_app USING(status='active');
ALTER TABLE brands ENABLE ROW LEVEL SECURITY;
ALTER TABLE brands FORCE ROW LEVEL SECURITY;
CREATE POLICY entitled_catalog_read ON brands FOR SELECT TO hp_local_app USING(
 (SELECT EXISTS(SELECT 1 FROM service_catalog.releases WHERE status='active')) AND
 (SELECT EXISTS(SELECT 1 FROM service_catalog.tenant_access WHERE tenant_id=nullif(current_setting('app.tenant_id',true),'') AND enabled AND (valid_until IS NULL OR valid_until>now())))
);
ALTER TABLE classifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE classifications FORCE ROW LEVEL SECURITY;
CREATE POLICY entitled_catalog_read ON classifications FOR SELECT TO hp_local_app USING(
 (SELECT EXISTS(SELECT 1 FROM service_catalog.releases WHERE status='active')) AND
 (SELECT EXISTS(SELECT 1 FROM service_catalog.tenant_access WHERE tenant_id=nullif(current_setting('app.tenant_id',true),'') AND enabled AND (valid_until IS NULL OR valid_until>now())))
);
ALTER TABLE families ENABLE ROW LEVEL SECURITY;
ALTER TABLE families FORCE ROW LEVEL SECURITY;
CREATE POLICY entitled_catalog_read ON families FOR SELECT TO hp_local_app USING(
 (SELECT EXISTS(SELECT 1 FROM service_catalog.releases WHERE status='active')) AND
 (SELECT EXISTS(SELECT 1 FROM service_catalog.tenant_access WHERE tenant_id=nullif(current_setting('app.tenant_id',true),'') AND enabled AND (valid_until IS NULL OR valid_until>now())))
);
ALTER TABLE bases ENABLE ROW LEVEL SECURITY;
ALTER TABLE bases FORCE ROW LEVEL SECURITY;
CREATE POLICY entitled_catalog_read ON bases FOR SELECT TO hp_local_app USING(
 (SELECT EXISTS(SELECT 1 FROM service_catalog.releases WHERE status='active')) AND
 (SELECT EXISTS(SELECT 1 FROM service_catalog.tenant_access WHERE tenant_id=nullif(current_setting('app.tenant_id',true),'') AND enabled AND (valid_until IS NULL OR valid_until>now())))
);
ALTER TABLE services ENABLE ROW LEVEL SECURITY;
ALTER TABLE services FORCE ROW LEVEL SECURITY;
CREATE POLICY entitled_catalog_read ON services FOR SELECT TO hp_local_app USING(
 (SELECT EXISTS(SELECT 1 FROM service_catalog.releases WHERE status='active')) AND
 (SELECT EXISTS(SELECT 1 FROM service_catalog.tenant_access WHERE tenant_id=nullif(current_setting('app.tenant_id',true),'') AND enabled AND (valid_until IS NULL OR valid_until>now())))
);
ALTER TABLE models ENABLE ROW LEVEL SECURITY;
ALTER TABLE models FORCE ROW LEVEL SECURITY;
CREATE POLICY entitled_catalog_read ON models FOR SELECT TO hp_local_app USING(
 (SELECT EXISTS(SELECT 1 FROM service_catalog.releases WHERE status='active')) AND
 (SELECT EXISTS(SELECT 1 FROM service_catalog.tenant_access WHERE tenant_id=nullif(current_setting('app.tenant_id',true),'') AND enabled AND (valid_until IS NULL OR valid_until>now())))
);
ALTER TABLE repair_times ENABLE ROW LEVEL SECURITY;
ALTER TABLE repair_times FORCE ROW LEVEL SECURITY;
CREATE POLICY entitled_catalog_read ON repair_times FOR SELECT TO hp_local_app USING(
 (SELECT EXISTS(SELECT 1 FROM service_catalog.releases WHERE status='active')) AND
 (SELECT EXISTS(SELECT 1 FROM service_catalog.tenant_access WHERE tenant_id=nullif(current_setting('app.tenant_id',true),'') AND enabled AND (valid_until IS NULL OR valid_until>now())))
);



-- Source: 20261019220939_optimize_catalog_tenant_policy.sql
ALTER POLICY tenant_read ON service_catalog.tenant_access USING (tenant_id=nullif((SELECT current_setting('app.tenant_id',true)),''));
ALTER POLICY entitled_catalog_read ON service_catalog.brands USING ((SELECT EXISTS(SELECT 1 FROM service_catalog.releases WHERE status='active')) AND (SELECT EXISTS(SELECT 1 FROM service_catalog.tenant_access WHERE tenant_id=nullif((SELECT current_setting('app.tenant_id',true)),'') AND enabled AND (valid_until IS NULL OR valid_until>now()))));
ALTER POLICY entitled_catalog_read ON service_catalog.classifications USING ((SELECT EXISTS(SELECT 1 FROM service_catalog.releases WHERE status='active')) AND (SELECT EXISTS(SELECT 1 FROM service_catalog.tenant_access WHERE tenant_id=nullif((SELECT current_setting('app.tenant_id',true)),'') AND enabled AND (valid_until IS NULL OR valid_until>now()))));
ALTER POLICY entitled_catalog_read ON service_catalog.families USING ((SELECT EXISTS(SELECT 1 FROM service_catalog.releases WHERE status='active')) AND (SELECT EXISTS(SELECT 1 FROM service_catalog.tenant_access WHERE tenant_id=nullif((SELECT current_setting('app.tenant_id',true)),'') AND enabled AND (valid_until IS NULL OR valid_until>now()))));
ALTER POLICY entitled_catalog_read ON service_catalog.bases USING ((SELECT EXISTS(SELECT 1 FROM service_catalog.releases WHERE status='active')) AND (SELECT EXISTS(SELECT 1 FROM service_catalog.tenant_access WHERE tenant_id=nullif((SELECT current_setting('app.tenant_id',true)),'') AND enabled AND (valid_until IS NULL OR valid_until>now()))));
ALTER POLICY entitled_catalog_read ON service_catalog.services USING ((SELECT EXISTS(SELECT 1 FROM service_catalog.releases WHERE status='active')) AND (SELECT EXISTS(SELECT 1 FROM service_catalog.tenant_access WHERE tenant_id=nullif((SELECT current_setting('app.tenant_id',true)),'') AND enabled AND (valid_until IS NULL OR valid_until>now()))));
ALTER POLICY entitled_catalog_read ON service_catalog.models USING ((SELECT EXISTS(SELECT 1 FROM service_catalog.releases WHERE status='active')) AND (SELECT EXISTS(SELECT 1 FROM service_catalog.tenant_access WHERE tenant_id=nullif((SELECT current_setting('app.tenant_id',true)),'') AND enabled AND (valid_until IS NULL OR valid_until>now()))));
ALTER POLICY entitled_catalog_read ON service_catalog.repair_times USING ((SELECT EXISTS(SELECT 1 FROM service_catalog.releases WHERE status='active')) AND (SELECT EXISTS(SELECT 1 FROM service_catalog.tenant_access WHERE tenant_id=nullif((SELECT current_setting('app.tenant_id',true)),'') AND enabled AND (valid_until IS NULL OR valid_until>now()))));


-- Source: 20261019222329_integrate_repair_services_orders.sql
SET LOCAL search_path=horse_power,pg_catalog;
CREATE TABLE labor_portes(id TEXT PRIMARY KEY,name TEXT NOT NULL);
INSERT INTO labor_portes(id,name) VALUES('b68de389-f1d5-489f-a926-f3ac7a19e047','Básico Elétrico');
INSERT INTO labor_portes(id,name) VALUES('5583d95f-453a-4ade-a5d4-0036c578fca1','SUV Compacto');
INSERT INTO labor_portes(id,name) VALUES('69243e4c-e4c1-4768-80d8-867233a93a87','SUV Médio');
INSERT INTO labor_portes(id,name) VALUES('893eb456-35f1-4e13-b990-8bdd9c557c7f','SUV Premium');
INSERT INTO labor_portes(id,name) VALUES('7538cc45-4f90-4f67-a9fc-4768423248f0','SUV Premium Diesel');
INSERT INTO labor_portes(id,name) VALUES('1a77fb91-87fb-4f10-ac6b-2d842187c141','SUV e Sedan Elétrico');
INSERT INTO labor_portes(id,name) VALUES('de9ad5dc-5919-43a5-999b-cd6941131674','Utilitário Compacto');
INSERT INTO labor_portes(id,name) VALUES('94714fc4-31df-417a-b8dc-936efe3ae1fb','Utilitário Médio');
INSERT INTO labor_portes(id,name) VALUES('a902c66c-ec23-49fe-9fbf-c7c5cc4b63a9','Utilitário Médio Diesel');
INSERT INTO labor_portes(id,name) VALUES('87db8fc0-b951-4963-afb5-c2c26a7c66b0','Utilitário Premium');
INSERT INTO labor_portes(id,name) VALUES('8fb64572-8a7d-4ebd-a158-6ccbd7a98246','Veículo Compacto');
INSERT INTO labor_portes(id,name) VALUES('1cc7406a-d07a-4a26-b617-337cbb7093ab','Veículo Médio');
INSERT INTO labor_portes(id,name) VALUES('2fd8314d-c310-4567-81f8-e1806ffe7586','Veículo Premium');
INSERT INTO labor_portes(id,name) VALUES('00c89e6d-49b6-46e9-90e6-1a1a85d1bfa8','Veículo de Luxo');
CREATE TABLE labor_rates(tenant_id TEXT NOT NULL REFERENCES tenants(id),porte_id TEXT NOT NULL REFERENCES labor_portes(id),hourly_rate INTEGER NOT NULL CHECK(hourly_rate>0),PRIMARY KEY(tenant_id,porte_id));
CREATE TABLE workshop_services(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL REFERENCES tenants(id),name TEXT NOT NULL,execution TEXT NOT NULL CHECK(execution IN ('internal','outsourced')),porte_id TEXT REFERENCES labor_portes(id),minutes DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK(minutes>=0),price INTEGER NOT NULL DEFAULT 0 CHECK(price>=0),cost INTEGER NOT NULL DEFAULT 0 CHECK(cost>=0),pricing_mode TEXT NOT NULL DEFAULT 'time' CHECK(pricing_mode IN ('time','price')),active INTEGER NOT NULL DEFAULT 1,UNIQUE(tenant_id,id));
CREATE INDEX idx_workshop_services_tenant ON workshop_services(tenant_id,active,name);
ALTER TABLE vehicles ADD COLUMN service_model_id TEXT NOT NULL DEFAULT '';
ALTER TABLE vehicles ADD COLUMN service_porte_id TEXT NOT NULL DEFAULT '';

ALTER TABLE order_items ALTER COLUMN catalog_id DROP NOT NULL;
ALTER TABLE order_items ADD COLUMN service_snapshot TEXT NOT NULL DEFAULT '';
ALTER TABLE order_items ADD CONSTRAINT order_items_service_reference CHECK(catalog_id IS NOT NULL OR (kind='service' AND service_snapshot<>''));
CREATE INDEX idx_labor_rates_porte ON labor_rates(porte_id);
CREATE INDEX idx_workshop_services_porte ON workshop_services(porte_id);
INSERT INTO workshop_services(id,tenant_id,name,execution,porte_id,minutes,price,cost,pricing_mode,active) SELECT id,tenant_id,name,'outsourced',NULL,0,price,cost,'price',1 FROM catalog WHERE kind='service' AND active=1 AND archived_at IS NULL AND merged_into IS NULL AND cost>0;
UPDATE catalog SET active=0,archived_at=COALESCE(archived_at,CURRENT_TIMESTAMP::text) WHERE kind='service' AND archived_at IS NULL;
ALTER TABLE labor_portes ENABLE ROW LEVEL SECURITY;
ALTER TABLE labor_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE workshop_services ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON labor_portes,labor_rates,workshop_services FROM PUBLIC,hp_local_app;
GRANT SELECT ON labor_portes TO hp_local_app;
GRANT SELECT,INSERT,UPDATE,DELETE ON labor_rates,workshop_services TO hp_local_app;
CREATE POLICY backend_read ON labor_portes FOR SELECT TO hp_local_app USING(true);
CREATE POLICY backend_access ON labor_rates FOR ALL TO hp_local_app USING(true) WITH CHECK(true);
CREATE POLICY backend_access ON workshop_services FOR ALL TO hp_local_app USING(true) WITH CHECK(true);
INSERT INTO migrations(version) VALUES(22);


-- Original bootstrap grants were provisioned outside the tracked cloud SQL.
GRANT USAGE ON SCHEMA horse_power TO hp_local_app;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA horse_power TO hp_local_app;
DO $$
DECLARE t record;
BEGIN
 FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='horse_power' LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='horse_power' AND tablename=t.tablename) THEN
   EXECUTE format('CREATE POLICY backend_access ON horse_power.%I FOR ALL TO hp_local_app USING(true) WITH CHECK(true)',t.tablename);
  END IF;
 END LOOP;
END $$;
REVOKE INSERT,UPDATE,DELETE ON horse_power.labor_portes FROM hp_local_app;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON SCHEMA horse_power FROM PUBLIC;
REVOKE CREATE ON SCHEMA horse_power, service_catalog FROM hp_local_app;
