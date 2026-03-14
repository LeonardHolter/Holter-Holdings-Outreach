-- Run this in the Supabase SQL editor

-- Daily dial count per number
CREATE TABLE IF NOT EXISTS number_daily_usage (
  number      text NOT NULL,
  date        date NOT NULL DEFAULT CURRENT_DATE,
  dial_count  integer NOT NULL DEFAULT 0,
  PRIMARY KEY (number, date)
);

-- Atomic upsert-increment so concurrent calls don't race
CREATE OR REPLACE FUNCTION increment_number_usage(p_number text, p_date date)
RETURNS integer AS $$
  INSERT INTO number_daily_usage (number, date, dial_count)
  VALUES (p_number, p_date, 1)
  ON CONFLICT (number, date)
  DO UPDATE SET dial_count = number_daily_usage.dial_count + 1
  RETURNING dial_count;
$$ LANGUAGE sql;
