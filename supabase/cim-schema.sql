-- CIM documents table: tracks uploaded PDFs per company
create table if not exists cim_documents (
  id          uuid primary key default gen_random_uuid(),
  company_id  text not null,
  file_name   text not null,
  file_path   text not null,
  file_size   integer not null default 0,
  uploaded_at timestamptz not null default now()
);

create index if not exists idx_cim_documents_company
  on cim_documents (company_id);

-- RLS
alter table cim_documents enable row level security;

create policy "Allow all for authenticated and anon"
  on cim_documents for all
  using (true)
  with check (true);

-- LOI tracking columns on companies
alter table if exists companies
  add column if not exists loi_sent boolean not null default false,
  add column if not exists loi_sent_date date;

-- Supabase Storage bucket (run via dashboard or supabase CLI):
-- insert into storage.buckets (id, name, public)
-- values ('cim-documents', 'cim-documents', true)
-- on conflict do nothing;
--
-- Storage policy (allow all uploads/downloads):
-- create policy "Allow public access" on storage.objects
--   for all using (bucket_id = 'cim-documents')
--   with check (bucket_id = 'cim-documents');
