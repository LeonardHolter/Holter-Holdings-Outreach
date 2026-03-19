-- ── Incoming SMS messages ──────────────────────────────────────────────────
create table if not exists incoming_messages (
  id            uuid primary key default gen_random_uuid(),
  twilio_sid    text unique,
  from_number   text not null,
  to_number     text not null,       -- which of our Twilio numbers received it
  body          text,
  direction     text not null default 'inbound',  -- 'inbound' | 'outbound'
  status        text not null default 'received', -- 'received' | 'sent' | 'failed'
  created_at    timestamptz not null default now()
);

create index if not exists incoming_messages_to_number_idx   on incoming_messages (to_number);
create index if not exists incoming_messages_from_number_idx on incoming_messages (from_number);
create index if not exists incoming_messages_created_at_idx  on incoming_messages (created_at desc);

-- Enable realtime so the UI gets live updates
alter publication supabase_realtime add table incoming_messages;

-- ── Incoming call log ──────────────────────────────────────────────────────
create table if not exists incoming_calls (
  id               uuid primary key default gen_random_uuid(),
  twilio_sid       text unique,
  from_number      text not null,
  to_number        text not null,    -- which of our Twilio numbers was called
  status           text,             -- 'ringing' | 'in-progress' | 'completed' | 'no-answer' | 'busy' | 'failed'
  duration_seconds integer,
  called_at        timestamptz not null default now()
);

create index if not exists incoming_calls_to_number_idx  on incoming_calls (to_number);
create index if not exists incoming_calls_called_at_idx  on incoming_calls (called_at desc);

-- Enable realtime
alter publication supabase_realtime add table incoming_calls;
