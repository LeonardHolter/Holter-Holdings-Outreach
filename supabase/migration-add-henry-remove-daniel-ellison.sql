-- Add Henry, remove Daniel and Ellison from the team
-- Run this in the Supabase SQL Editor

-- 1. Add new column
ALTER TABLE companies ADD COLUMN IF NOT EXISTS calls_henry INTEGER DEFAULT 0;

-- 2. Drop old columns
ALTER TABLE companies DROP COLUMN IF EXISTS calls_daniel;
ALTER TABLE companies DROP COLUMN IF EXISTS calls_ellison;

-- 3. Update team_members lookup table
DELETE FROM team_members WHERE name IN ('Daniel', 'Ellison');
INSERT INTO team_members (name) VALUES ('Henry') ON CONFLICT (name) DO NOTHING;
