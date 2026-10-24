BEGIN;
SET LOCAL search_path = horse_power, pg_catalog;

-- Keep transfer schema aligned with the additive local migration 010.
-- Existing rows receive safe defaults; tenant policies and grants are unchanged.
ALTER TABLE capture_sessions
  ADD COLUMN IF NOT EXISTS batch_id TEXT,
  ADD COLUMN IF NOT EXISTS freight_total INTEGER NOT NULL DEFAULT 0;

ALTER TABLE external_captures
  ADD COLUMN IF NOT EXISTS batch_id TEXT,
  ADD COLUMN IF NOT EXISTS source_quantity INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS freight_total INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_external_captures_batch
  ON external_captures(tenant_id, batch_id, source);

COMMIT;
