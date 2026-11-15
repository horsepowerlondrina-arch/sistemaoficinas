-- No financial values or payment dates are rewritten. Retain the source month for idempotency.
ALTER TABLE horse_power.payables ALTER COLUMN amount DROP NOT NULL;
ALTER TABLE horse_power.payables ADD COLUMN generation_month text;
UPDATE horse_power.payables SET generation_month=substr(due_on,1,7) WHERE template_id IS NOT NULL;
ALTER TABLE horse_power.payables ADD CONSTRAINT payable_paid_value CHECK(status<>'paid' OR amount IS NOT NULL);
ALTER TABLE horse_power.payables DROP CONSTRAINT payables_tenant_id_template_id_due_on_key;
DROP INDEX horse_power.idx_payable_template_month;
CREATE UNIQUE INDEX payable_generation_month ON horse_power.payables(tenant_id,template_id,generation_month);
CREATE FUNCTION horse_power.preserve_payable_generation_month() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='UPDATE' AND OLD.generation_month IS DISTINCT FROM NEW.generation_month THEN
   RAISE EXCEPTION 'Mês de geração não pode ser alterado.';
 END IF;
 IF TG_OP='INSERT' AND NEW.template_id IS NOT NULL AND NEW.generation_month IS NULL THEN
   NEW.generation_month:=substr(NEW.due_on,1,7);
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION horse_power.preserve_payable_generation_month() FROM PUBLIC;
CREATE TRIGGER payable_generation_month_immutable BEFORE INSERT OR UPDATE ON horse_power.payables
FOR EACH ROW EXECUTE FUNCTION horse_power.preserve_payable_generation_month();

-- Invoker-only worker. Only the database scheduler/owner may invoke it; no new application grant.
-- Daily retry creates the current month only and never edits a generated account or confirms payment.
CREATE FUNCTION horse_power.generate_current_expenses() RETURNS integer
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE v_month text:=to_char(timezone('America/Sao_Paulo',statement_timestamp()),'YYYY-MM');
 v_tenant text; v_actor text; v_template record; v_diff integer; v_due text; v_id text; v_count integer:=0;
BEGIN
 FOR v_tenant IN SELECT DISTINCT t.tenant_id FROM horse_power.expense_templates t
 WHERE t.active=1 AND t.deleted_at IS NULL
   AND coalesce((platform_admin.effective_workshop_entitlements(t.tenant_id)->'modules'->>'finance')::boolean,false)
   AND horse_power.local_tenant_access_state(t.tenant_id) IN ('legacy','trial','active','grace_period')
 ORDER BY t.tenant_id LOOP
  PERFORM pg_advisory_xact_lock(hashtextextended(v_tenant,2089));
  SELECT m.user_id INTO v_actor FROM horse_power.memberships m WHERE m.tenant_id=v_tenant AND m.role='owner' ORDER BY m.user_id LIMIT 1;
  IF v_actor IS NULL THEN CONTINUE; END IF;
  FOR v_template IN SELECT * FROM horse_power.expense_templates WHERE tenant_id=v_tenant AND active=1 AND deleted_at IS NULL LOOP
   IF v_template.start_month IS NULL THEN
    UPDATE horse_power.expense_templates SET start_month=v_month WHERE tenant_id=v_tenant AND id=v_template.id;
    v_template.start_month:=v_month;
   END IF;
   v_diff:=(substr(v_month,1,4)::integer-substr(v_template.start_month,1,4)::integer)*12+substr(v_month,6,2)::integer-substr(v_template.start_month,6,2)::integer;
   IF v_diff<0 OR (v_template.remaining_months IS NOT NULL AND v_diff>=v_template.remaining_months) THEN CONTINUE; END IF;
   v_due:=v_month||'-'||lpad(least(v_template.due_day,extract(day FROM (to_date(v_month||'-01','YYYY-MM-DD')+interval '1 month - 1 day'))::integer)::text,2,'0');
   v_id:=md5(clock_timestamp()::text||random()::text||v_template.id);
   INSERT INTO horse_power.payables(id,tenant_id,template_id,description,category,amount,due_on,notes,supplier,generation_month)
   VALUES(v_id,v_tenant,v_template.id,v_template.description||CASE WHEN v_template.remaining_months IS NOT NULL THEN ' · parcela '||(v_diff+1)||'/'||v_template.remaining_months ELSE '' END,
     v_template.category,nullif(v_template.amount,0),v_due,v_template.source,v_template.supplier,v_month)
   ON CONFLICT DO NOTHING;
   IF FOUND THEN
    v_count:=v_count+1;
    INSERT INTO horse_power.audit_events(id,tenant_id,user_id,action,entity_id)
    VALUES(md5(v_id||'audit'),v_tenant,v_actor,'expense.generated.automatic',v_id);
   END IF;
  END LOOP;
 END LOOP;
 RETURN v_count;
END $$;
REVOKE ALL ON FUNCTION horse_power.generate_current_expenses() FROM PUBLIC,horse_power_app,hp_platform_admin_app;
