-- ============================================================
-- Scraper schema additions — new columns on companies table
-- Run this in the Supabase SQL Editor
-- ============================================================

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS google_place_id TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS address         TEXT,
  ADD COLUMN IF NOT EXISTS website         TEXT,
  ADD COLUMN IF NOT EXISTS latitude        DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS longitude       DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS google_rating   NUMERIC(2,1),
  ADD COLUMN IF NOT EXISTS county          TEXT;

CREATE INDEX IF NOT EXISTS idx_companies_google_place_id
  ON companies(google_place_id);

CREATE INDEX IF NOT EXISTS idx_companies_county
  ON companies(county);
