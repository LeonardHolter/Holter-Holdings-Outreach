-- ============================================================
-- Scheduled emails table — run in Supabase SQL Editor
-- ============================================================

CREATE TABLE IF NOT EXISTS scheduled_emails (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  scheduled_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled',
  sent_at TIMESTAMPTZ,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scheduled_emails_pending
  ON scheduled_emails (scheduled_at)
  WHERE status = 'scheduled';
