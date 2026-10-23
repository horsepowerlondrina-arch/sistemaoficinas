-- Preserve approved CAT-007 overrides independently of catalog import timing.
CREATE TABLE service_catalog.model_labor_category_overrides (
  model_id uuid PRIMARY KEY,
  category_id text NOT NULL REFERENCES horse_power.labor_categories(id),
  change_reason text NOT NULL
);
ALTER TABLE service_catalog.model_labor_category_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_catalog.model_labor_category_overrides FORCE ROW LEVEL SECURITY;
REVOKE ALL ON service_catalog.model_labor_category_overrides FROM PUBLIC,horse_power_app;
INSERT INTO service_catalog.model_labor_category_overrides(model_id,category_id,change_reason) VALUES
  ('ab7b2905-17d3-4664-8743-62ef07085599'::uuid,'premium','CAT-007: exceção comercial aprovada; validação técnica externa não realizada.'),
  ('0c445a60-d252-4403-ae5a-f47ef609dbcb'::uuid,'premium','CAT-007: exceção comercial aprovada; validação técnica externa não realizada.'),
  ('49fc9e3b-d8ab-456c-a972-362923acdd80'::uuid,'premium','CAT-007: exceção comercial aprovada; validação técnica externa não realizada.'),
  ('10ce3299-d6b3-40ff-988a-2363ceac33a1'::uuid,'premium','CAT-007: exceção comercial aprovada; validação técnica externa não realizada.'),
  ('88abf55a-bf24-4814-8b7a-3a208e5ce667'::uuid,'premium','CAT-007: exceção comercial aprovada; validação técnica externa não realizada.'),
  ('b71a3b5f-3fa5-4f70-a7ba-eb4dcf729deb'::uuid,'premium','CAT-007: exceção comercial aprovada; validação técnica externa não realizada.'),
  ('b7909870-7971-4ca1-8a36-2a742d749d41'::uuid,'premium','CAT-007: exceção comercial aprovada; validação técnica externa não realizada.'),
  ('539034ba-6027-47f7-9167-c1b71e3b6f4a'::uuid,'premium','CAT-007: exceção comercial aprovada; validação técnica externa não realizada.'),
  ('25215eb0-7183-440c-a4d2-7f1490f70801'::uuid,'premium','CAT-007: exceção comercial aprovada; validação técnica externa não realizada.'),
  ('4fb9c6ec-839a-4329-8d0f-24f06c180d44'::uuid,'premium','CAT-007: exceção comercial aprovada; validação técnica externa não realizada.'),
  ('baf88976-ab91-48a5-85d8-576c4814ee6d'::uuid,'premium','CAT-007: exceção comercial aprovada; validação técnica externa não realizada.'),
  ('8049eee0-9d10-4615-b189-3dd16c22e720'::uuid,'premium','CAT-007: exceção comercial aprovada; validação técnica externa não realizada.'),
  ('9f857754-eb61-4f8e-ba1a-38a5119fae29'::uuid,'premium','CAT-007: exceção comercial aprovada; validação técnica externa não realizada.'),
  ('06ad18c0-b6c0-4abb-88c5-91f42626ce63'::uuid,'premium','CAT-007: exceção comercial aprovada; validação técnica externa não realizada.'),
  ('fffe1ff6-ffc9-4528-8e10-2d17a0764a0b'::uuid,'premium','CAT-007: exceção comercial aprovada; validação técnica externa não realizada.'),
  ('d9254f32-9abe-433c-9e4d-1f4b9950b39a'::uuid,'premium','CAT-007: exceção comercial aprovada; validação técnica externa não realizada.'),
  ('75f6c077-b30c-4705-b95d-9a7fcad9ec23'::uuid,'premium','CAT-007: exceção comercial aprovada; validação técnica externa não realizada.'),
  ('3871d513-f1eb-49c5-a793-80bdf09617eb'::uuid,'premium','CAT-007: exceção comercial aprovada; validação técnica externa não realizada.'),
  ('56b969a5-8ad5-4874-9ef9-7b08c90d3d74'::uuid,'premium','CAT-007: exceção comercial aprovada; validação técnica externa não realizada.'),
  ('0f0288de-8fdc-44a0-bda1-ea9c8e0add1e'::uuid,'premium','CAT-007: exceção comercial aprovada; validação técnica externa não realizada.'),
  ('f3923377-56bf-475d-9d8f-804fa17bcfb9'::uuid,'premium','CAT-007: exceção comercial aprovada; validação técnica externa não realizada.'),
  ('b0e28225-f5ae-4cf0-a40a-5f1529346254'::uuid,'premium','CAT-007: exceção comercial aprovada; validação técnica externa não realizada.'),
  ('a7c479bc-9ced-4bae-8533-7149ca3acc3f'::uuid,'premium','CAT-007: exceção comercial aprovada; validação técnica externa não realizada.'),
  ('ec1c65c3-4f66-4651-acef-93722a2bbac1'::uuid,'premium','CAT-007: exceção comercial aprovada; validação técnica externa não realizada.'),
  ('8a9b7275-c1ad-4671-971e-7bf6ce2a1b12'::uuid,'premium','CAT-007: exceção comercial aprovada; validação técnica externa não realizada.'),
  ('4aeb87e4-e3f7-41e5-99d1-0cf3b94c88f8'::uuid,'premium','CAT-007: exceção comercial aprovada; validação técnica externa não realizada.'),
  ('5c2dd0ae-3dd9-4566-ae47-8437b3a42011'::uuid,'premium','CAT-007: exceção comercial aprovada; validação técnica externa não realizada.'),
  ('95548ab4-cf88-4167-805a-41705afcad7e'::uuid,'premium','CAT-007: exceção comercial aprovada; validação técnica externa não realizada.'),
  ('0b0bb77b-0eaa-4bc9-a0e2-f1204af2b863'::uuid,'premium','CAT-007: exceção comercial aprovada; validação técnica externa não realizada.'),
  ('480808d9-4df6-4ecf-afb0-0da7013dac87'::uuid,'premium','CAT-007: exceção comercial aprovada; validação técnica externa não realizada.'),
  ('bcd7ac7a-b411-4828-ac24-48975dffe402'::uuid,'premium','CAT-007: exceção comercial aprovada; validação técnica externa não realizada.'),
  ('56eb80e2-b28f-416f-b345-b8003103f66a'::uuid,'premium','CAT-007: exceção comercial aprovada; validação técnica externa não realizada.'),
  ('86ec12f3-035d-4243-b39c-554f095875f9'::uuid,'premium','CAT-007: exceção comercial aprovada; validação técnica externa não realizada.'),
  ('d9e1eead-e7b6-4c60-843a-58f7799d6823'::uuid,'premium','CAT-007: exceção comercial aprovada; validação técnica externa não realizada.'),
  ('5a5f1177-cba4-462a-b08a-a4a81bdfcf7a'::uuid,'premium','CAT-007: exceção comercial aprovada; validação técnica externa não realizada.'),
  ('d697e39f-f4aa-4e3b-babd-f8d9b322a77d'::uuid,'premium','CAT-007: exceção comercial aprovada; validação técnica externa não realizada.'),
  ('83b3ad36-93e8-4fc9-9fb1-49ca1a73fae4'::uuid,'premium','CAT-007: exceção comercial aprovada; validação técnica externa não realizada.'),
  ('b118e6e5-4226-47bb-8f37-480b04528dbd'::uuid,'premium','CAT-007: exceção comercial aprovada; validação técnica externa não realizada.'),
  ('d7daf58a-c44c-4882-b9e5-44394c2081a8'::uuid,'premium','CAT-007: exceção comercial aprovada; validação técnica externa não realizada.'),
  ('e9a4186d-811f-438e-bd33-3784090276a9'::uuid,'premium','CAT-007: exceção comercial aprovada; validação técnica externa não realizada.'),
  ('779b6a14-432a-492b-9d84-01b2bf809e62'::uuid,'premium','CAT-007: exceção comercial aprovada; validação técnica externa não realizada.'),
  ('8bf7146f-af20-4c9b-8aa2-14d016a96dd6'::uuid,'premium','CAT-007: exceção comercial aprovada; validação técnica externa não realizada.'),
  ('8849a658-e98c-40e1-8761-f96a16bb1748'::uuid,'premium','CAT-007: exceção comercial aprovada; validação técnica externa não realizada.'),
  ('662ff32f-a6f9-4a3c-ba74-68323957339a'::uuid,'premium','CAT-007: exceção comercial aprovada; validação técnica externa não realizada.'),
  ('5c132c78-396a-475d-a3f3-7f0f947dace4'::uuid,'premium','CAT-007: exceção comercial aprovada; validação técnica externa não realizada.'),
  ('2ab5ba66-65ac-46af-9349-7f16b13377c7'::uuid,'premium','CAT-007: exceção comercial aprovada; validação técnica externa não realizada.'),
  ('02fe5cea-41c4-4b8d-ad27-e8f0f065a938'::uuid,'premium','CAT-007: exceção comercial aprovada; validação técnica externa não realizada.'),
  ('acb03525-ccd7-4c77-b3b9-791b815d0810'::uuid,'premium','CAT-007: exceção comercial aprovada; validação técnica externa não realizada.'),
  ('30babcd7-e457-483d-9aec-a768e38602a9'::uuid,'premium','CAT-007: exceção comercial aprovada; validação técnica externa não realizada.'),
  ('5fab600c-4f87-45a3-82cf-822e35a52dcc'::uuid,'premium','CAT-007: exceção comercial aprovada; validação técnica externa não realizada.'),
  ('bb603317-7898-43de-9c76-0b7e93dddc01'::uuid,'premium','CAT-007: exceção comercial aprovada; validação técnica externa não realizada.');

CREATE FUNCTION service_catalog.assign_model_labor_category()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,service_catalog,horse_power AS $$
DECLARE
  target_category text;
  technical_name text;
  assignment text;
  reason text;
BEGIN
  SELECT category_id,change_reason INTO target_category,reason
  FROM service_catalog.model_labor_category_overrides WHERE model_id=NEW.id;
  IF FOUND THEN
    assignment := 'reviewed';
  ELSE
    SELECT name INTO technical_name FROM service_catalog.classifications WHERE id=NEW.classification_id;
    target_category := CASE technical_name
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
    END;
    assignment := 'automatic';
    reason := 'Classificação comercial operacional v1 derivada do porte técnico; não representa validação técnica externa.';
  END IF;
  IF target_category IS NULL THEN
    RAISE EXCEPTION 'CAT-007: porte técnico sem categoria comercial para modelo %',NEW.id;
  END IF;
  INSERT INTO service_catalog.model_labor_categories
    (model_id,technical_classification_id,category_id,assignment_source,review_status,change_reason)
  VALUES(NEW.id,NEW.classification_id,target_category,assignment,'confirmed',reason)
  ON CONFLICT(model_id) DO UPDATE SET
    technical_classification_id=EXCLUDED.technical_classification_id,
    category_id=EXCLUDED.category_id,
    assignment_source=EXCLUDED.assignment_source,
    review_status='confirmed',
    change_reason=EXCLUDED.change_reason,
    updated_at=now()
  WHERE service_catalog.model_labor_categories.assignment_source IN ('automatic','reviewed');
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION service_catalog.assign_model_labor_category() FROM PUBLIC,horse_power_app;
CREATE TRIGGER assign_model_labor_category_after_catalog_import
AFTER INSERT OR UPDATE OF classification_id ON service_catalog.models
FOR EACH ROW EXECUTE FUNCTION service_catalog.assign_model_labor_category();

-- Backfill gaps and apply the persistent overrides to models already present.
INSERT INTO service_catalog.model_labor_categories
  (model_id,technical_classification_id,category_id,assignment_source,review_status,change_reason)
SELECT m.id,m.classification_id,
  COALESCE(o.category_id,CASE c.name
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
  END),
  CASE WHEN o.model_id IS NULL THEN 'automatic' ELSE 'reviewed' END,
  'confirmed',COALESCE(o.change_reason,'Classificação comercial operacional v1 derivada do porte técnico; não representa validação técnica externa.')
FROM service_catalog.models m
LEFT JOIN service_catalog.classifications c ON c.id=m.classification_id
LEFT JOIN service_catalog.model_labor_category_overrides o ON o.model_id=m.id
WHERE NOT EXISTS (SELECT 1 FROM service_catalog.model_labor_categories current_map WHERE current_map.model_id=m.id)
ON CONFLICT(model_id) DO NOTHING;
UPDATE service_catalog.model_labor_categories target
SET technical_classification_id=model.classification_id,
    category_id=approved.category_id,
    assignment_source='reviewed',review_status='confirmed',
    change_reason=approved.change_reason,updated_at=now()
FROM service_catalog.models model
JOIN service_catalog.model_labor_category_overrides approved ON approved.model_id=model.id
WHERE target.model_id=model.id
  AND (target.category_id IS DISTINCT FROM approved.category_id
    OR target.assignment_source IS DISTINCT FROM 'reviewed'
    OR target.change_reason IS DISTINCT FROM approved.change_reason);
DO $$ BEGIN
  IF (SELECT count(*) FROM service_catalog.model_labor_categories)<>
     (SELECT count(*) FROM service_catalog.models) THEN
    RAISE EXCEPTION 'CAT-007: há modelos sem categoria comercial após importação';
  END IF;
END $$;