-- Controlled, tenant-scoped operational retirement. Called only after a verified
-- external encrypted backup and the final notice. Financial and platform audit
-- history remain attached to a redacted tenant tombstone.
ALTER TABLE platform_admin.workshop_retention_cases
  ADD COLUMN photo_object_keys jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(photo_object_keys)='array'),
  ADD COLUMN photo_objects_purged_at timestamptz,
  ADD COLUMN processing_until timestamptz;

-- Server-only recovery supplement for operational relations added after the
-- .hptx transfer format. It excludes passwords, tokens, sessions and links.
CREATE FUNCTION platform_admin.retention_recovery_supplement(p_tenant text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $supplement$
DECLARE
  result jsonb:='{}'::jsonb;
  rows jsonb;
  table_name text;
  table_schema text;
BEGIN
  IF NOT (pg_has_role(session_user,'hp_platform_admin_app','MEMBER') OR current_setting('role',true)='hp_platform_admin_app')
    OR NOT EXISTS(SELECT 1 FROM platform_admin.workshops WHERE tenant_id=p_tenant) THEN
    RAISE EXCEPTION 'Operação não autorizada.' USING ERRCODE='42501';
  END IF;
  FOREACH table_name IN ARRAY ARRAY['workshop_user_access','staff_accounts','order_assignments',
    'discount_requests','support_tickets','support_messages'] LOOP
    table_schema:=CASE WHEN table_name LIKE 'support_%' THEN 'platform_support' ELSE 'horse_power' END;
    EXECUTE format('SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text),''[]''::jsonb)
      FROM %I.%I x WHERE tenant_id=$1',table_schema,table_name) INTO rows USING p_tenant;
    result:=result||jsonb_build_object(table_name,rows);
  END LOOP;
  SELECT coalesce(jsonb_agg(jsonb_build_object('user_id',m.user_id,'tenant_id',m.tenant_id,'role',m.role)
      ORDER BY m.user_id),'[]'::jsonb) INTO rows FROM horse_power.memberships m WHERE m.tenant_id=p_tenant;
  result:=result||jsonb_build_object('memberships',rows);
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',u.id,'name',u.name,'email',u.email)
      ORDER BY u.id),'[]'::jsonb) INTO rows
    FROM horse_power.users u JOIN horse_power.memberships m ON m.user_id=u.id WHERE m.tenant_id=p_tenant;
  RETURN result||jsonb_build_object('users',rows);
END $supplement$;
REVOKE ALL ON FUNCTION platform_admin.retention_recovery_supplement(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform_admin.retention_recovery_supplement(text) TO hp_platform_admin_app;

-- The two historic guards remain strict for every ordinary request. Only the
-- restricted administrator invoking retention_delete_workshop may delete the
-- selected tenant's revisions and final Master in one transaction.
CREATE OR REPLACE FUNCTION horse_power.reject_document_revision_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $function$
BEGIN
  IF TG_OP='DELETE' AND OLD.tenant_id=nullif(current_setting('app.retention_delete_tenant',true),'')
    AND (pg_has_role(session_user,'hp_platform_admin_app','MEMBER') OR current_setting('role',true)='hp_platform_admin_app')
    AND current_user='postgres' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Documento emitido é imutável';
END $function$;

DO $patch_guard$
DECLARE definition text;
BEGIN
  SELECT pg_get_functiondef('horse_power.guard_workshop_membership()'::regprocedure) INTO definition;
  IF definition IS NULL OR position(' t:=CASE WHEN TG_OP=''DELETE'' THEN OLD.tenant_id ELSE NEW.tenant_id END;' IN definition)=0 THEN
    RAISE EXCEPTION 'A proteção de Master mudou; revise a migração de retenção.';
  END IF;
  definition:=replace(definition,
    ' t:=CASE WHEN TG_OP=''DELETE'' THEN OLD.tenant_id ELSE NEW.tenant_id END;',
    ' IF TG_OP=''DELETE'' AND OLD.tenant_id=nullif(current_setting(''app.retention_delete_tenant'',true),'''') AND (pg_has_role(session_user,''hp_platform_admin_app'',''MEMBER'') OR current_setting(''role'',true)=''hp_platform_admin_app'') THEN RETURN OLD; END IF;
 t:=CASE WHEN TG_OP=''DELETE'' THEN OLD.tenant_id ELSE NEW.tenant_id END;');
  EXECUTE definition;
END $patch_guard$;

CREATE OR REPLACE FUNCTION platform_admin.retention_delete_workshop(p_tenant text,p_coverage date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $function$
DECLARE
  v_case platform_admin.workshop_retention_cases%ROWTYPE;
  v_workshop platform_admin.workshops%ROWTYPE;
  v_paid date;
  v_due date;
  v_trial date;
  v_managed boolean;
  v_subscription text;
  v_subscription_status text;
  v_current_end date;
  v_today date:=(now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_users text[];
  v_keys jsonb;
  v_order text[]:=ARRAY[
    'horse_power.audit_events','horse_power.capture_sessions','horse_power.card_machine_rates',
    'horse_power.card_rates','horse_power.cash_entries','horse_power.cash_movements',
    'horse_power.checklist_photos','horse_power.data_transfer_archived_documents',
    'horse_power.data_transfer_backups','horse_power.data_transfer_records',
    'horse_power.discount_requests','horse_power.external_captures',
    'horse_power.external_catalog_links','horse_power.labor_commercial_rates',
    'horse_power.labor_rates','horse_power.order_assignments','horse_power.order_items',
    'horse_power.payables','horse_power.payment_settings','horse_power.product_categories',
    'horse_power.public_shares','horse_power.service_aliases','horse_power.service_merge_history',
    'horse_power.service_times','horse_power.sessions','horse_power.staff_accounts',
    'horse_power.stock_invoice_products','horse_power.stock_invoices','horse_power.stock_movements',
    'horse_power.vehicle_lookup_cache','horse_power.workshop_services',
    'horse_power.workshop_user_access','horse_power.workshop_user_invites',
    'platform_support.support_messages','horse_power.cash_accounts','horse_power.catalog',
    'horse_power.checklists','horse_power.document_revisions','horse_power.expense_templates',
    'horse_power.memberships','horse_power.payment_installments','horse_power.professionals',
    'horse_power.suppliers','horse_power.workshop_service_categories',
    'platform_support.support_tickets','horse_power.card_machines','horse_power.receivables',
    'horse_power.orders','horse_power.vehicles','horse_power.customers'
  ];
  v_table text;
  v_count bigint;
  v_removed bigint:=0;
BEGIN
  IF NOT (pg_has_role(session_user,'hp_platform_admin_app','MEMBER') OR current_setting('role',true)='hp_platform_admin_app') OR
    p_tenant !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'Operação não autorizada.' USING ERRCODE='42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_tenant,104730));
  SELECT * INTO v_workshop FROM platform_admin.workshops WHERE tenant_id=p_tenant FOR UPDATE;
  SELECT * INTO v_case FROM platform_admin.workshop_retention_cases
    WHERE tenant_id=p_tenant AND coverage_end=p_coverage FOR UPDATE;
  IF NOT FOUND OR v_case.status<>'backup_verified' OR v_case.backup_verified_at IS NULL OR
    v_case.backup_manifest->>'tenantId' IS DISTINCT FROM p_tenant OR
    coalesce(v_case.backup_manifest->>'sha256','') !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Backup verificado ausente; exclusão bloqueada.' USING ERRCODE='23514';
  END IF;
  IF v_workshop.tenant_id IS NULL OR v_workshop.source NOT IN ('admin','self_service') OR
    v_workshop.status NOT IN ('active','trial','read_only') OR v_workshop.email_verified_at IS NULL THEN
    RAISE EXCEPTION 'Oficina não elegível.' USING ERRCODE='23514';
  END IF;
  IF v_today<p_coverage+90 OR NOT EXISTS (
    SELECT 1 FROM platform_admin.workshop_retention_notices n
    WHERE n.tenant_id=p_tenant AND n.coverage_end=p_coverage AND n.days_late=89
      AND n.status='sent' AND n.sent_at<=now()-interval '24 hours'
  ) THEN RAISE EXCEPTION 'Prazo ou aviso final pendente.' USING ERRCODE='23514'; END IF;
  SELECT coalesce(managed,false),paid_until,due_on,subscription_id,subscription_status
    INTO v_managed,v_paid,v_due,v_subscription,v_subscription_status
    FROM platform_admin.stripe_accounts WHERE tenant_id=p_tenant FOR UPDATE;
  v_managed:=coalesce(v_managed,false);
  v_trial:=(v_workshop.trial_ends_at AT TIME ZONE 'America/Sao_Paulo')::date;
  IF v_managed THEN
    v_current_end:=nullif(greatest(coalesce(v_paid,'-infinity'::date),coalesce(v_due,'-infinity'::date),coalesce(v_trial,'-infinity'::date)),'-infinity'::date);
  ELSIF v_workshop.status IN ('trial','read_only') THEN
    v_current_end:=v_trial;
  END IF;
  IF v_current_end IS DISTINCT FROM p_coverage OR
    (v_subscription IS NOT NULL AND coalesce(v_subscription_status,'') NOT IN ('canceled','incomplete_expired')) OR
    EXISTS(SELECT 1 FROM platform_admin.stripe_checkouts WHERE tenant_id=p_tenant AND status IN ('open','pending')) THEN
    RAISE EXCEPTION 'Cobertura ou cobrança mudou; exclusão bloqueada.' USING ERRCODE='23514';
  END IF;
  -- Fail closed if a later migration added tenant data without updating this list.
  IF EXISTS(SELECT 1 FROM information_schema.columns c JOIN information_schema.tables t
      ON t.table_schema=c.table_schema AND t.table_name=c.table_name
      WHERE c.column_name='tenant_id' AND c.table_schema IN ('horse_power','platform_support')
        AND t.table_type='BASE TABLE' AND (c.table_schema||'.'||c.table_name)<>ALL(v_order)) THEN
    RAISE EXCEPTION 'Novas tabelas da oficina exigem revisão da exclusão.' USING ERRCODE='23514';
  END IF;
  SELECT coalesce(array_agg(user_id),'{}'::text[]) INTO v_users
    FROM horse_power.memberships WHERE tenant_id=p_tenant;
  SELECT coalesce(jsonb_agg(substring(image_data FROM length('private-checklist:v1:')+1)::jsonb->>'key'),'[]'::jsonb)
    INTO v_keys FROM horse_power.checklist_photos
    WHERE tenant_id=p_tenant AND image_data LIKE 'private-checklist:v1:%';
  IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(v_keys) AS item(key)
    WHERE key IS NULL OR key !~ ('^'||p_tenant||'/[0-9a-f-]{36}$')) THEN
    RAISE EXCEPTION 'Referência de foto inválida; exclusão bloqueada.' USING ERRCODE='23514';
  END IF;
  PERFORM set_config('app.retention_delete_tenant',p_tenant,true);
  FOREACH v_table IN ARRAY v_order LOOP
    EXECUTE format('DELETE FROM %s WHERE tenant_id=$1',v_table) USING p_tenant;
    GET DIAGNOSTICS v_count=ROW_COUNT;
    v_removed:=v_removed+v_count;
  END LOOP;
  DELETE FROM horse_power.password_reset_tokens x WHERE x.user_id=ANY(v_users)
    AND NOT EXISTS(SELECT 1 FROM horse_power.memberships m WHERE m.user_id=x.user_id);
  DELETE FROM horse_power.admin_setup x WHERE x.user_id=ANY(v_users)
    AND NOT EXISTS(SELECT 1 FROM horse_power.memberships m WHERE m.user_id=x.user_id);
  DELETE FROM horse_power.users x WHERE x.id=ANY(v_users)
    AND NOT EXISTS(SELECT 1 FROM horse_power.memberships m WHERE m.user_id=x.id);
  DELETE FROM platform_admin.workshop_activation_invites WHERE tenant_id=p_tenant;
  DELETE FROM platform_admin.workshop_entitlements WHERE tenant_id=p_tenant;
  UPDATE platform_admin.stripe_accounts SET managed=false,cancel_at_period_end=true,
    invoice_payment_url=NULL WHERE tenant_id=p_tenant;
  UPDATE platform_admin.workshops SET status='archived',name='Oficina encerrada',
    responsible_name='Encerrado',responsible_email='removed+'||p_tenant||'@invalid.local',
    phone='',document='',status_reason='Encerrada após prazo de retenção.',updated_at=now()
    WHERE tenant_id=p_tenant;
  UPDATE horse_power.tenants SET name='Oficina encerrada',document='',phone='',address='',
    legal_name='',email='',city='',state='',document_logo='',profile_data='{}'
    WHERE id=p_tenant;
  UPDATE platform_admin.workshop_retention_cases SET status='deleted',deleted_at=now(),
    recovery_expires_at=now()+interval '15 days',photo_object_keys=v_keys,
    photo_objects_purged_at=CASE WHEN jsonb_array_length(v_keys)=0 THEN now() ELSE NULL END,
    processing_until=NULL,updated_at=now()
    WHERE tenant_id=p_tenant AND coverage_end=p_coverage;
  INSERT INTO platform_admin.audit_events(id,actor_email,subject_tenant_id,action,result,technical_context)
    VALUES(gen_random_uuid()::text,'retention',p_tenant,'retention.workshop_deleted','success',
      jsonb_build_object('coverage_end',p_coverage,'rows_removed',v_removed));
  RETURN jsonb_build_object('rows_removed',v_removed,'photos_to_purge',jsonb_array_length(v_keys));
END $function$;
REVOKE ALL ON FUNCTION platform_admin.retention_delete_workshop(text,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform_admin.retention_delete_workshop(text,date) TO hp_platform_admin_app;
