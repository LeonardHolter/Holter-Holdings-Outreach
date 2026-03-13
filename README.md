# Holter Holdings — Outreach CRM

A Next.js 16 + Supabase CRM for tracking garage door company acquisition outreach. Spreadsheet-style interface with inline editing.

---

## Stack

- **Next.js 16** (App Router, TypeScript)
- **Supabase** (Postgres + Auth)
- **TanStack Table v8** (spreadsheet grid)
- **Tailwind CSS v4**
- **Sonner** (toast notifications)
- **date-fns** (date formatting)

---

## Setup

### 1. Supabase project

1. Create a new project at [supabase.com](https://supabase.com).
2. In the SQL Editor, run `supabase/schema.sql` to create all tables, RLS policies, indexes and seed data.
3. In **Authentication → Users**, manually create accounts for the team.

### 2. Environment variables

Copy `.env.local` and fill in your real values:

```
NEXT_PUBLIC_SUPABASE_URL=https://yourproject.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
```

### 3. Install & run

```bash
npm install
npm run dev
```

### 4. Migrate CSV data

After the schema is set up and env vars are configured:

```bash
npm run migrate
```

This reads `Garage Door Outreach - Database.csv`, cleans the data, and upserts all rows into Supabase. Safe to re-run (inserts, not upserts — clear the table first if re-running).

---

## Deploy to Vercel

1. Push this repo to GitHub.
2. Import the repo in Vercel.
3. Add the three env vars in Vercel → Project Settings → Environment Variables.
4. Deploy. Auto-deploys on every push to `main`.

---

## Features

- **Inline editing** — click any cell to edit in place. Auto-saves on blur/Enter with optimistic updates.
- **Sorting** — click any column header. Default: Google Reviews ↓
- **Filtering** — State, Response, Who Called, date range, full-text search, quick toggles (Not Called / Intro Meetings). Filters sync to URL so views are shareable.
- **Stats panel** — collapsible summary bar showing totals, intro rate, and per-caller breakdown. Updates live with filters.
- **Color coding** — rows tinted green (intro meeting), red (not interested/acquired), yellow (message/callback), gray (not called).
- **Overdue highlighting** — Next Reach Out dates that are today or past turn orange.
- **Click-to-call** — phone numbers are `tel:` links.
- **Add company** — inline new row at top of table, no modals.
- **Delete** — per-row delete with confirmation.
- **Auth** — email/password login via Supabase. All routes protected except `/login`.

---

## File Structure

```
app/
  page.tsx              ← main spreadsheet view (Server Component)
  layout.tsx
  globals.css
  login/page.tsx        ← auth page
  api/
    companies/route.ts          ← GET (list), POST (create)
    companies/[id]/route.ts     ← PATCH, DELETE
    auth/signout/route.ts
components/
  CompanyTable.tsx      ← TanStack Table grid with inline editing
  EditableCell.tsx      ← per-cell editor (text/number/select/date)
  FilterBar.tsx         ← filter controls
  StatsPanel.tsx        ← stats summary
  ResponseBadge.tsx     ← status badge + row color helpers
lib/
  supabase/client.ts    ← browser Supabase client
  supabase/server.ts    ← server Supabase client
  data.ts               ← server-side data functions
types/index.ts          ← Company, TeamMember, ResponseStatus interfaces
supabase/schema.sql     ← full DB schema (run once in Supabase)
scripts/migrate.mjs     ← one-time CSV import script
proxy.ts                ← auth middleware (protects all routes)
```
