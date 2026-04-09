-- Add added_by column to track who added a company via Quick Add
-- All existing rows are attributed to Leonard

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS added_by text;

UPDATE companies
SET added_by = 'Leonard'
WHERE added_by IS NULL;
