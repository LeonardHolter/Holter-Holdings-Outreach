-- Add calls columns for new team members
ALTER TABLE companies ADD COLUMN IF NOT EXISTS calls_ranjeev  integer DEFAULT 0;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS calls_juan     integer DEFAULT 0;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS calls_matthew  integer DEFAULT 0;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS calls_andreas  integer DEFAULT 0;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS calls_theo     integer DEFAULT 0;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS calls_adam     integer DEFAULT 0;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS calls_charlene integer DEFAULT 0;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS calls_tia      integer DEFAULT 0;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS calls_ishank   integer DEFAULT 0;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS calls_maanas   integer DEFAULT 0;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS calls_shaty    integer DEFAULT 0;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS calls_william  integer DEFAULT 0;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS calls_zaid     integer DEFAULT 0;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS calls_massi    integer DEFAULT 0;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS calls_shorya   integer DEFAULT 0;

-- Add new team members
INSERT INTO team_members (name) VALUES
  ('Ranjeev'),
  ('Juan'),
  ('Matthew'),
  ('Andreas'),
  ('Theo'),
  ('Adam'),
  ('Charlene'),
  ('Tia'),
  ('Ishank'),
  ('Maanas'),
  ('Shaty'),
  ('William'),
  ('Zaid'),
  ('Massi'),
  ('Shorya')
ON CONFLICT (name) DO NOTHING;
