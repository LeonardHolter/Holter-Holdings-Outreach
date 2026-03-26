-- Add priority label for intro-meeting leads
alter table if exists companies
  add column if not exists meeting_priority text;

-- Optional safety check so only valid values are stored
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'companies_meeting_priority_check'
  ) then
    alter table companies
      add constraint companies_meeting_priority_check
      check (meeting_priority in ('high', 'low') or meeting_priority is null);
  end if;
end $$;

-- Follow-up tracking on intro leads
alter table if exists companies
  add column if not exists follow_up_calls integer not null default 0,
  add column if not exists follow_up_emails integer not null default 0;

-- Keep values sane and cap total follow-ups at 21
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'companies_follow_up_non_negative_check'
  ) then
    alter table companies
      add constraint companies_follow_up_non_negative_check
      check (follow_up_calls >= 0 and follow_up_emails >= 0);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'companies_follow_up_total_max_21_check'
  ) then
    alter table companies
      add constraint companies_follow_up_total_max_21_check
      check ((follow_up_calls + follow_up_emails) <= 21);
  end if;
end $$;
