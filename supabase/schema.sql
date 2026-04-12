-- ============================================================
-- Holter Holdings Outreach CRM — Supabase Schema
-- Run this in the Supabase SQL Editor
-- ============================================================

-- ── companies ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS companies (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name        text NOT NULL,
  google_reviews      integer,
  state               text,
  phone_number        text,
  reach_out_response  text,
  last_reach_out      date,
  next_reach_out      date,
  owners_name         text,
  amount_of_calls     integer DEFAULT 0,
  who_called          text,
  email               text,
  notes               text,
  calls_leonard       integer DEFAULT 0,
  calls_tommaso       integer DEFAULT 0,
  calls_john          integer DEFAULT 0,
  calls_sunzim        integer DEFAULT 0,
  calls_henry         integer DEFAULT 0,
  total_dialed        integer DEFAULT 0,
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now()
);

-- updated_at trigger
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS companies_updated_at ON companies;
CREATE TRIGGER companies_updated_at
  BEFORE UPDATE ON companies
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Indexes for filter performance
CREATE INDEX IF NOT EXISTS idx_companies_state ON companies(state);
CREATE INDEX IF NOT EXISTS idx_companies_response ON companies(reach_out_response);
CREATE INDEX IF NOT EXISTS idx_companies_who_called ON companies(who_called);
CREATE INDEX IF NOT EXISTS idx_companies_next_reach_out ON companies(next_reach_out);
CREATE INDEX IF NOT EXISTS idx_companies_google_reviews ON companies(google_reviews DESC NULLS LAST);

-- ── Row Level Security ──────────────────────────────────────

ALTER TABLE companies ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read and write
CREATE POLICY "Authenticated users can select companies"
  ON companies FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert companies"
  ON companies FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update companies"
  ON companies FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete companies"
  ON companies FOR DELETE
  TO authenticated
  USING (true);

-- ── team_members ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS team_members (
  id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name  text NOT NULL UNIQUE
);

ALTER TABLE team_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read team_members"
  ON team_members FOR SELECT
  TO authenticated
  USING (true);

INSERT INTO team_members (name) VALUES
  ('Leonard'),
  ('Tommaso'),
  ('John'),
  ('Sunzim'),
  ('Henry')
ON CONFLICT (name) DO NOTHING;

-- ── response_statuses ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS response_statuses (
  id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL UNIQUE
);

ALTER TABLE response_statuses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read response_statuses"
  ON response_statuses FOR SELECT
  TO authenticated
  USING (true);

INSERT INTO response_statuses (label) VALUES
  ('Did not pick up'),
  ('Did not reach the Owner'),
  ('Left a message to the owner'),
  ('Intro-meeting wanted'),
  ('Owner is not interested'),
  ('Already acquired'),
  ('Not a garage door service company'),
  ('Not called'),
  ('Number does not exist'),
  ('Call back on Monday')
ON CONFLICT (label) DO NOTHING;
