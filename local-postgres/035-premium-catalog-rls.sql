-- Acesso ao catálogo técnico segue exclusivamente o Premium efetivo, inclusive o teste grátis.
-- A função valida o usuário, a oficina e suas permissões antes de consultar os recursos.
DO $policies$
DECLARE catalog_table text;
BEGIN
  FOREACH catalog_table IN ARRAY ARRAY[
    'bases','brands','classifications','families','model_labor_categories',
    'model_labor_category_history','models','repair_times','services'
  ] LOOP
    EXECUTE format(
      'ALTER POLICY entitled_catalog_read ON service_catalog.%I USING (
         (SELECT EXISTS (SELECT 1 FROM service_catalog.releases WHERE status = ''active''))
         AND (SELECT CASE
           WHEN nullif(current_setting(''app.tenant_id'', true), '''') IS NOT NULL
             AND nullif(current_setting(''app.user_id'', true), '''') IS NOT NULL
           THEN horse_power.local_tenant_catalog_included(
             nullif(current_setting(''app.tenant_id'', true), ''''))
           ELSE false END)
       )', catalog_table);
  END LOOP;
END
$policies$;
