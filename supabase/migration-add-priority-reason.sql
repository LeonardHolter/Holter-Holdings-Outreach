-- Add priority_reason to store why a lead is not currently high priority
ALTER TABLE companies ADD COLUMN IF NOT EXISTS priority_reason text;
