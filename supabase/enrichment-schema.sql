-- ============================================================
-- Enrichment schema additions — new columns on companies table
-- Run this in the Supabase SQL Editor
-- ============================================================

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS estimated_revenue_low    INTEGER,
  ADD COLUMN IF NOT EXISTS estimated_revenue_high   INTEGER,
  ADD COLUMN IF NOT EXISTS revenue_confidence       TEXT,
  ADD COLUMN IF NOT EXISTS technician_count_estimate INTEGER,
  ADD COLUMN IF NOT EXISTS enrichment_reasoning     TEXT,
  ADD COLUMN IF NOT EXISTS enrichment_signals       TEXT[],
  ADD COLUMN IF NOT EXISTS enriched_at              TIMESTAMPTZ;
