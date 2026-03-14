-- Run this in the Supabase SQL editor

-- Add last_call_sid to companies table
ALTER TABLE companies ADD COLUMN IF NOT EXISTS last_call_sid text;

-- Create call_recordings table
CREATE TABLE IF NOT EXISTS call_recordings (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid REFERENCES companies(id) ON DELETE CASCADE,
  call_sid    text NOT NULL,
  caller_name text,
  caller_number text,
  recording_url text,
  duration_seconds integer,
  called_at   timestamptz NOT NULL DEFAULT now(),
  called_by   text
);

CREATE INDEX IF NOT EXISTS call_recordings_company_id_idx ON call_recordings(company_id);
CREATE INDEX IF NOT EXISTS call_recordings_called_at_idx  ON call_recordings(called_at DESC);
