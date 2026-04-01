-- Prevents two concurrent callers from using the same Twilio number.
-- Each row is a short-lived lease (2 min) that gets upserted when a
-- caller requests a token. Expired rows are ignored by the query.
create table if not exists number_locks (
  number   text primary key,
  caller_name text not null,
  expires_at timestamptz not null default now() + interval '2 minutes'
);

-- Allow the app to read/write
alter table number_locks enable row level security;

create policy "Allow all for authenticated and anon"
  on number_locks for all
  using (true)
  with check (true);
