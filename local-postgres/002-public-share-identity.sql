-- Local parity with the reusable public-link feature already present in the backend.
-- Additive: existing links and records are preserved.
ALTER TABLE horse_power.public_shares ADD COLUMN IF NOT EXISTS token_value TEXT;
