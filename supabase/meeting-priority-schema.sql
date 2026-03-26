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
