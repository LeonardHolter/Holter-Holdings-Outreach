-- Add emailed_at column to track when a company was last emailed
-- Checkbox resets automatically after 2 weeks (handled in UI)
ALTER TABLE companies ADD COLUMN IF NOT EXISTS emailed_at timestamptz;
