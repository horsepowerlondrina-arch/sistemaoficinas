-- Four commercial billing categories; the catalog's 14 technical classes remain intact.
CREATE TABLE horse_power.labor_categories (
  id text PRIMARY KEY CHECK (id IN ('compacto','medio','premium','pesado')),
  name text NOT NULL UNIQUE,
  sort_order integer NOT NULL UNIQUE
);
INSERT INTO horse_power.labor_categories(id,name,sort_order) VALUES
 ('compacto','Compacto',1),('medio','Médio',2),('premium','Premium',3),('pesado','Pesado',4);
ALTER TABLE horse_power.labor_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE horse_power.labor_categories FORCE ROW LEVEL SECURITY;
GRANT SELECT ON horse_power.labor_categories TO horse_power_app;
CREATE POLICY backend_read ON horse_power.labor_categories FOR SELECT TO horse_power_app USING(true);

CREATE TABLE horse_power.labor_commercial_rates (
  tenant_id text NOT NULL REFERENCES horse_power.tenants(id),
  category_id text NOT NULL REFERENCES horse_power.labor_categories(id),
  hourly_rate bigint NOT NULL CHECK(hourly_rate > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,category_id)
);
ALTER TABLE horse_power.labor_commercial_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE horse_power.labor_commercial_rates FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE,DELETE ON horse_power.labor_commercial_rates TO horse_power_app;
CREATE POLICY tenant_rates ON horse_power.labor_commercial_rates FOR ALL TO horse_power_app
 USING(tenant_id=nullif(current_setting('app.tenant_id',true),''))
 WITH CHECK(tenant_id=nullif(current_setting('app.tenant_id',true),''));

ALTER TABLE horse_power.workshop_services
 ADD COLUMN commercial_category_id text REFERENCES horse_power.labor_categories(id);
UPDATE horse_power.workshop_services s SET commercial_category_id = CASE p.name
 WHEN 'Básico Elétrico' THEN 'compacto'
 WHEN 'SUV Compacto' THEN 'compacto'
 WHEN 'SUV Médio' THEN 'medio'
 WHEN 'SUV e Sedan Elétrico' THEN 'medio'
 WHEN 'Utilitário Compacto' THEN 'compacto'
 WHEN 'Utilitário Médio' THEN 'medio'
 WHEN 'Utilitário Médio Diesel' THEN 'medio'
 WHEN 'SUV Premium' THEN 'premium'
 WHEN 'SUV Premium Diesel' THEN 'premium'
 WHEN 'Utilitário Premium' THEN 'premium'
 WHEN 'Veículo Compacto' THEN 'compacto'
 WHEN 'Veículo Médio' THEN 'medio'
 WHEN 'Veículo Premium' THEN 'premium'
 WHEN 'Veículo de Luxo' THEN 'premium'
 END
 FROM horse_power.labor_portes p WHERE p.id=s.porte_id;

DROP POLICY backend_access ON horse_power.labor_rates;
CREATE POLICY tenant_rates ON horse_power.labor_rates FOR ALL TO horse_power_app
 USING(tenant_id=nullif(current_setting('app.tenant_id',true),''))
 WITH CHECK(tenant_id=nullif(current_setting('app.tenant_id',true),''));
DROP POLICY backend_access ON horse_power.workshop_services;
CREATE POLICY tenant_services ON horse_power.workshop_services FOR ALL TO horse_power_app
 USING(tenant_id=nullif(current_setting('app.tenant_id',true),''))
 WITH CHECK(tenant_id=nullif(current_setting('app.tenant_id',true),''));

CREATE TABLE service_catalog.model_labor_categories (
  model_id uuid PRIMARY KEY REFERENCES service_catalog.models(id),
  technical_classification_id uuid REFERENCES service_catalog.classifications(id),
  category_id text NOT NULL REFERENCES horse_power.labor_categories(id),
  assignment_source text NOT NULL DEFAULT 'automatic'
    CHECK(assignment_source IN ('automatic','reviewed','manual')),
  review_status text NOT NULL DEFAULT 'confirmed'
    CHECK(review_status IN ('pending','confirmed')),
  change_reason text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO service_catalog.model_labor_categories
  (model_id,technical_classification_id,category_id,assignment_source,review_status,change_reason)
SELECT m.id,m.classification_id,
  CASE c.name
    WHEN 'Básico Elétrico' THEN 'compacto'
    WHEN 'SUV Compacto' THEN 'compacto'
    WHEN 'SUV Médio' THEN 'medio'
    WHEN 'SUV e Sedan Elétrico' THEN 'medio'
    WHEN 'Utilitário Compacto' THEN 'compacto'
    WHEN 'Utilitário Médio' THEN 'medio'
    WHEN 'Utilitário Médio Diesel' THEN 'medio'
    WHEN 'SUV Premium' THEN 'premium'
    WHEN 'SUV Premium Diesel' THEN 'premium'
    WHEN 'Utilitário Premium' THEN 'premium'
    WHEN 'Veículo Compacto' THEN 'compacto'
    WHEN 'Veículo Médio' THEN 'medio'
    WHEN 'Veículo Premium' THEN 'premium'
    WHEN 'Veículo de Luxo' THEN 'premium'
  END,
  'automatic','confirmed','Classificação comercial operacional v1 derivada do porte técnico; não representa validação técnica externa.'
FROM service_catalog.models m
JOIN service_catalog.classifications c ON c.id=m.classification_id;
COMMENT ON COLUMN service_catalog.model_labor_categories.review_status IS
  'Disponibilidade operacional da categoria comercial; confirmed permite precificação e não declara validação técnica externa.';
DO $$ BEGIN
  IF (SELECT count(*) FROM service_catalog.model_labor_categories) <>
     (SELECT count(*) FROM service_catalog.models) THEN
    RAISE EXCEPTION 'Há modelo sem categoria comercial mapeada';
  END IF;
END $$;
CREATE INDEX model_labor_categories_category ON service_catalog.model_labor_categories(category_id);
ALTER TABLE service_catalog.model_labor_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_catalog.model_labor_categories FORCE ROW LEVEL SECURITY;
GRANT SELECT ON service_catalog.model_labor_categories TO horse_power_app;
CREATE POLICY entitled_catalog_read ON service_catalog.model_labor_categories FOR SELECT TO horse_power_app USING(
 (SELECT EXISTS(SELECT 1 FROM service_catalog.releases WHERE status='active')) AND
 (SELECT EXISTS(SELECT 1 FROM service_catalog.tenant_access WHERE tenant_id=nullif((SELECT current_setting('app.tenant_id',true)),'') AND enabled AND (valid_until IS NULL OR valid_until>now())))
);

CREATE TABLE service_catalog.model_labor_category_history (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  model_id uuid NOT NULL REFERENCES service_catalog.models(id),
  previous_category_id text REFERENCES horse_power.labor_categories(id),
  next_category_id text NOT NULL REFERENCES horse_power.labor_categories(id),
  assignment_source text NOT NULL,
  review_status text NOT NULL,
  change_reason text NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE service_catalog.model_labor_category_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_catalog.model_labor_category_history FORCE ROW LEVEL SECURITY;
GRANT SELECT ON service_catalog.model_labor_category_history TO horse_power_app;
CREATE POLICY entitled_catalog_read ON service_catalog.model_labor_category_history FOR SELECT TO horse_power_app USING(
 (SELECT EXISTS(SELECT 1 FROM service_catalog.releases WHERE status='active')) AND
 (SELECT EXISTS(SELECT 1 FROM service_catalog.tenant_access WHERE tenant_id=nullif((SELECT current_setting('app.tenant_id',true)),'') AND enabled AND (valid_until IS NULL OR valid_until>now())))
);
CREATE FUNCTION service_catalog.record_model_labor_category_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,service_catalog AS $$
BEGIN
  IF OLD.category_id IS DISTINCT FROM NEW.category_id OR
     OLD.assignment_source IS DISTINCT FROM NEW.assignment_source OR
     OLD.review_status IS DISTINCT FROM NEW.review_status OR
     OLD.change_reason IS DISTINCT FROM NEW.change_reason THEN
    INSERT INTO service_catalog.model_labor_category_history
      (model_id,previous_category_id,next_category_id,assignment_source,review_status,change_reason)
    VALUES(NEW.model_id,OLD.category_id,NEW.category_id,NEW.assignment_source,NEW.review_status,NEW.change_reason);
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION service_catalog.record_model_labor_category_change() FROM PUBLIC,horse_power_app;
CREATE TRIGGER model_labor_category_history_trigger
AFTER UPDATE ON service_catalog.model_labor_categories
FOR EACH ROW EXECUTE FUNCTION service_catalog.record_model_labor_category_change();

-- CAT-007: the approved commercial overrides from the operational catalog.
-- A synthetic local fixture may contain none of these models; a partial catalog is rejected.
DO $$
DECLARE
  approved_model_ids uuid[] := ARRAY[
    'ab7b2905-17d3-4664-8743-62ef07085599'::uuid,
    '0c445a60-d252-4403-ae5a-f47ef609dbcb'::uuid,
    '49fc9e3b-d8ab-456c-a972-362923acdd80'::uuid,
    '10ce3299-d6b3-40ff-988a-2363ceac33a1'::uuid,
    '88abf55a-bf24-4814-8b7a-3a208e5ce667'::uuid,
    'b71a3b5f-3fa5-4f70-a7ba-eb4dcf729deb'::uuid,
    'b7909870-7971-4ca1-8a36-2a742d749d41'::uuid,
    '539034ba-6027-47f7-9167-c1b71e3b6f4a'::uuid,
    '25215eb0-7183-440c-a4d2-7f1490f70801'::uuid,
    '4fb9c6ec-839a-4329-8d0f-24f06c180d44'::uuid,
    'baf88976-ab91-48a5-85d8-576c4814ee6d'::uuid,
    '8049eee0-9d10-4615-b189-3dd16c22e720'::uuid,
    '9f857754-eb61-4f8e-ba1a-38a5119fae29'::uuid,
    '06ad18c0-b6c0-4abb-88c5-91f42626ce63'::uuid,
    'fffe1ff6-ffc9-4528-8e10-2d17a0764a0b'::uuid,
    'd9254f32-9abe-433c-9e4d-1f4b9950b39a'::uuid,
    '75f6c077-b30c-4705-b95d-9a7fcad9ec23'::uuid,
    '3871d513-f1eb-49c5-a793-80bdf09617eb'::uuid,
    '56b969a5-8ad5-4874-9ef9-7b08c90d3d74'::uuid,
    '0f0288de-8fdc-44a0-bda1-ea9c8e0add1e'::uuid,
    'f3923377-56bf-475d-9d8f-804fa17bcfb9'::uuid,
    'b0e28225-f5ae-4cf0-a40a-5f1529346254'::uuid,
    'a7c479bc-9ced-4bae-8533-7149ca3acc3f'::uuid,
    'ec1c65c3-4f66-4651-acef-93722a2bbac1'::uuid,
    '8a9b7275-c1ad-4671-971e-7bf6ce2a1b12'::uuid,
    '4aeb87e4-e3f7-41e5-99d1-0cf3b94c88f8'::uuid,
    '5c132c78-396a-475d-a3f3-7f0f947dace4'::uuid,
    '95548ab4-cf88-4167-805a-41705afcad7e'::uuid,
    '0b0bb77b-0eaa-4bc9-a0e2-f1204af2b863'::uuid,
    '480808d9-4df6-4ecf-afb0-0da7013dac87'::uuid,
    'bcd7ac7a-b411-4828-ac24-48975dffe402'::uuid,
    '56eb80e2-b28f-416f-b345-b8003103f66a'::uuid,
    '86ec12f3-035d-4243-b39c-554f095875f9'::uuid,
    'd9e1eead-e7b6-4c60-843a-58f7799d6823'::uuid,
    '5a5f1177-cba4-462a-b08a-a4a81bdfcf7a'::uuid,
    'd697e39f-f4aa-4e3b-babd-f8d9b322a77d'::uuid,
    '83b3ad36-93e8-4fc9-9fb1-49ca1a73fae4'::uuid,
    'b118e6e5-4226-47bb-8f37-480b04528dbd'::uuid,
    'd7daf58a-c44c-4882-b9e5-44394c2081a8'::uuid,
    'e9a4186d-811f-438e-bd33-3784090276a9'::uuid,
    '779b6a14-432a-492b-9d84-01b2bf809e62'::uuid,
    '8bf7146f-af20-4c9b-8aa2-14d016a96dd6'::uuid,
    '8849a658-e98c-40e1-8761-f96a16bb1748'::uuid,
    '662ff32f-a6f9-4a3c-ba74-68323957339a'::uuid,
    '5c2dd0ae-3dd9-4566-ae47-8437b3a42011'::uuid,
    '2ab5ba66-65ac-46af-9349-7f16b13377c7'::uuid,
    '02fe5cea-41c4-4b8d-ad27-e8f0f065a938'::uuid,
    'acb03525-ccd7-4c77-b3b9-791b815d0810'::uuid,
    '30babcd7-e457-483d-9aec-a768e38602a9'::uuid,
    '5fab600c-4f87-45a3-82cf-822e35a52dcc'::uuid,
    'bb603317-7898-43de-9c76-0b7e93dddc01'::uuid
  ];
  matched_count integer;
BEGIN
  SELECT count(*) INTO matched_count
  FROM service_catalog.model_labor_categories
  WHERE model_id = ANY(approved_model_ids);
  IF matched_count NOT IN (0, cardinality(approved_model_ids)) THEN
    RAISE EXCEPTION 'CAT-007: catálogo contém apenas % das 51 exceções aprovadas', matched_count;
  END IF;
  IF matched_count = cardinality(approved_model_ids) THEN
    UPDATE service_catalog.model_labor_categories
    SET category_id='premium', assignment_source='reviewed', review_status='confirmed',
        change_reason='CAT-007: exceção comercial aprovada; classificação operacional, sem validação técnica externa.',
        updated_at=now()
    WHERE model_id = ANY(approved_model_ids)
      AND category_id IS DISTINCT FROM 'premium';
  END IF;
END $$;
