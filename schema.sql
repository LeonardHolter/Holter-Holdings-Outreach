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
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

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
  duration_seconds INTEGER,
  called_by TEXT,
  caller_name TEXT,
  caller_number TEXT,
  called_at TIMESTAMPTZ DEFAULT NOW()
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
