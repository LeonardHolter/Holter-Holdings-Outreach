-- AI Receptionist Sales CRM — Neon PostgreSQL schema
-- Run this in your Neon SQL editor to set up the database.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE companies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_name TEXT NOT NULL,
  phone_number TEXT,
  email TEXT,
  website TEXT,
  owners_name TEXT,
  state TEXT,
  notes TEXT,
  reach_out_response TEXT DEFAULT 'Not called',
  who_called TEXT,
  amount_of_calls INTEGER DEFAULT 0,
  calls_leonard INTEGER DEFAULT 0,
  calls_william INTEGER DEFAULT 0,
  last_reach_out DATE,
  next_reach_out DATE,
  callback_day TEXT,
  callback_time TEXT,
  last_call_sid TEXT,
  google_place_id TEXT,
  google_reviews INTEGER,
  google_rating NUMERIC(3,1),
  org_nr TEXT,            -- Norwegian org number (dedup key for scraped data)
  revenue BIGINT,         -- driftsinntekter in thousands NOK (from proff.no)
  employees TEXT,         -- employee count / range (from proff.no)
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- org_nr is the natural dedup key for scraped companies.
CREATE UNIQUE INDEX IF NOT EXISTS companies_org_nr_uniq ON companies(org_nr) WHERE org_nr IS NOT NULL;

CREATE TABLE company_notes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  note TEXT NOT NULL,
  caller_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE call_recordings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
  call_sid TEXT,
  recording_url TEXT,
  recording_data BYTEA,         -- raw audio captured from device mic (webm/opus)
  mime_type TEXT,               -- e.g. 'audio/webm;codecs=opus'
  company_name_snapshot TEXT,   -- denormalised name at time of recording
  duration_seconds INTEGER,
  called_by TEXT,
  caller_name TEXT,
  caller_number TEXT,
  called_at TIMESTAMPTZ DEFAULT NOW()
);

-- Live company locks so two callers never work the same lead.
-- Keyed by company_id (PRIMARY KEY) so Postgres serializes concurrent claims
-- on the same company — the loser is rejected by the ON CONFLICT WHERE clause.
-- A claim is "active" while claimed_at is within ~90s; the client heartbeats
-- every 12s, and a dropped tab's lock frees automatically once it goes stale.
CREATE TABLE IF NOT EXISTS company_claims (
  company_id   UUID PRIMARY KEY,
  caller_name  TEXT NOT NULL,
  company_name TEXT,
  claimed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE number_locks (
  number TEXT PRIMARY KEY,
  caller_name TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE number_daily_usage (
  number TEXT NOT NULL,
  date DATE NOT NULL,
  dial_count INTEGER DEFAULT 0,
  PRIMARY KEY (number, date)
);

CREATE TABLE incoming_calls (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  twilio_sid TEXT UNIQUE,
  from_number TEXT,
  to_number TEXT,
  status TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE incoming_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  twilio_sid TEXT UNIQUE,
  from_number TEXT,
  to_number TEXT,
  body TEXT,
  direction TEXT,
  status TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
