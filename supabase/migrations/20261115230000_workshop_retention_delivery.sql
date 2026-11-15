-- A provider accepting a message is not evidence that the recipient's mail
-- server accepted it. The final 24-hour gate starts only after confirmation.
ALTER TABLE platform_admin.workshop_retention_notices
  ADD COLUMN provider_email_id text,
  ADD COLUMN provider_delivered_at timestamptz;

ALTER TABLE platform_admin.workshop_retention_notices
  DROP CONSTRAINT workshop_retention_notices_status_check;
ALTER TABLE platform_admin.workshop_retention_notices
  ADD CONSTRAINT workshop_retention_notices_status_check
  CHECK (status IN ('reserved','accepted','sent','failed'));

-- Existing notices have no provider ID and remain unconfirmed. NOT VALID
-- permits those historic rows but checks every new or changed row.
ALTER TABLE platform_admin.workshop_retention_notices
  ADD CONSTRAINT workshop_retention_notices_delivery_check
  CHECK (status<>'sent' OR (provider_email_id IS NOT NULL AND provider_delivered_at IS NOT NULL)) NOT VALID;

DO $guard$
DECLARE definition text;
  old_guard text:='AND n.status=''sent'' AND n.sent_at<=now()-interval ''24 hours''';
BEGIN
  SELECT pg_get_functiondef('platform_admin.retention_delete_workshop(text,date)'::regprocedure) INTO definition;
  IF definition IS NULL OR position(old_guard IN definition)=0 THEN
    RAISE EXCEPTION 'A função de exclusão mudou; revise a confirmação do aviso antes de migrar.';
  END IF;
  definition:=replace(definition,old_guard,
    'AND n.status=''sent'' AND n.provider_delivered_at IS NOT NULL AND n.sent_at<=now()-interval ''24 hours''');
  EXECUTE definition;
END $guard$;
