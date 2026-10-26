-- CAT-013.1: retain before/after values for explicitly confirmed vehicle updates.
ALTER TABLE horse_power.audit_events
  ADD COLUMN IF NOT EXISTS metadata text NOT NULL DEFAULT '{}';
