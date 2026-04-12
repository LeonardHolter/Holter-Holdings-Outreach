# Holter Holdings Outreach CRM — Developer Build Guide

> **Project Summary:** A Next.js + TypeScript web app that replicates and replaces our Google Sheet outreach tracker. The app displays and manages a list of garage door companies we are cold-calling for acquisition. Data lives in Supabase. The interface should feel like a fast, editable spreadsheet — not a traditional form-based CRM.

---

## Tech Stack

- **Framework:** Next.js 14+ (App Router)
- **Language:** TypeScript (strict mode)
- **Database:** Supabase (Postgres)
- **Styling:** Tailwind CSS
- **Table/Grid UI:** TanStack Table v8
- **State Management:** React state + SWR or React Query for data fetching
- **Auth:** Supabase Auth (email/password — just for Leonard and the team)

---

## Phase 1 — Project Setup & Environment

1. Initialize a new Next.js 14 project with TypeScript and Tailwind CSS using the App Router.

2. Install the following dependencies:
   - `@supabase/supabase-js` and `@supabase/ssr` for Supabase client + server integration
   - `@tanstack/react-table` for the spreadsheet-style data grid
   - `swr` or `@tanstack/react-query` for data fetching and cache invalidation
   - `date-fns` for date formatting and manipulation
   - `react-hot-toast` or `sonner` for toast notifications on save/error

3. Set up environment variables in `.env.local`:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` (for server-side admin operations)

4. Configure the Supabase client:
   - Create a browser client helper (for client components)
   - Create a server client helper (for Server Components and Route Handlers)

5. Set up Supabase Auth middleware to protect all routes except `/login`.

---

## Phase 2 — Database Schema (Supabase)

### Table: `companies`

Create this table in Supabase with the following columns. Map directly from the Google Sheet structure:

| Column Name | Type | Notes |
|---|---|---|
| `id` | `uuid` (PK, default `gen_random_uuid()`) | Primary key |
| `company_name` | `text` NOT NULL | |
| `google_reviews` | `integer` | Nullable |
| `state` | `text` | e.g. MI, MN, PA, OH, WI |
| `phone_number` | `text` | Store as text to preserve formatting |
| `reach_out_response` | `text` | e.g. "Did not pick up", "Intro-meeting wanted", etc. |
| `last_reach_out` | `date` | Nullable |
| `next_reach_out` | `date` | Nullable |
| `owners_name` | `text` | Nullable |
| `amount_of_calls` | `integer` | Default 0 |
| `who_called` | `text` | Name of intern/team member who called |
| `email` | `text` | Nullable |
| `notes` | `text` | Catch-all notes field from the sheet |
| `calls_leonard` | `integer` | Default 0 |
| `calls_tommaso` | `integer` | Default 0 |
| `calls_john` | `integer` | Default 0 |
| `calls_sunzim` | `integer` | Default 0 |
| `calls_henry` | `integer` | Default 0 |
| `total_dialed` | `integer` | Default 0 — can be computed or stored |
| `created_at` | `timestamptz` | Default `now()` |
| `updated_at` | `timestamptz` | Default `now()` — update via trigger |

**Additional setup:**
- Add a Postgres trigger that automatically updates `updated_at` on every row update.
- Add a `total_dialed` computed column or keep it as a stored integer updated on save.
- Enable Row Level Security (RLS) on the `companies` table. Write a policy that only allows authenticated users to read and write.
- Create an index on `state` and `reach_out_response` for filter performance.

### Reference Table: `team_members`

Create a small lookup table to manage the list of callers dynamically:

| Column | Type |
|---|---|
| `id` | `uuid` PK |
| `name` | `text` |

Seed it with: Leonard, Tommaso, John, Sunzim, Henry.

### Reference Table: `response_statuses`

Create a lookup table for the dropdown values of `reach_out_response`:

Seed with: "Did not pick up", "Did not reach the Owner", "Left a message to the owner", "Intro-meeting wanted", "Owner is not interested", "Already acquired", "Not a garage door service company", "Not called", "Number does not exist", "Call back on Monday"

---

## Phase 3 — Data Migration (Google Sheet → Supabase)

1. Export the Google Sheet as a CSV.

2. Write a one-time Node.js migration script (not part of the app) that:
   - Reads the CSV
   - Cleans and normalizes the data (phone numbers, date formats, review counts)
   - Upserts each row into the `companies` table via the Supabase client using the service role key
   - Logs any rows that fail validation

3. Run the migration script and verify row count and spot-check data in Supabase dashboard.

---

## Phase 4 — Core Data Layer (Next.js)

1. Define a TypeScript interface `Company` that mirrors the `companies` table exactly. Export it from a shared `types/` directory.

2. Define a TypeScript interface `TeamMember` and `ResponseStatus` for the lookup tables.

3. Create a set of server-side data fetching functions (in `/lib/data.ts` or similar):
   - `getCompanies(filters?)` — fetch all companies with optional filter params
   - `getCompanyById(id)` — fetch a single company
   - `updateCompany(id, payload)` — patch a company row
   - `createCompany(payload)` — insert a new company
   - `getTeamMembers()` — fetch the lookup table
   - `getResponseStatuses()` — fetch the dropdown options

4. Create Next.js Route Handlers (`/app/api/companies/route.ts` etc.) that wrap these functions and expose them as API endpoints for client components to call.

---

## Phase 5 — Main Spreadsheet View

This is the primary screen. It must feel like working inside Google Sheets.

### Layout

- Full-width table that fills the browser window
- Sticky header row (column names)
- Sticky first column (`company_name`) so it stays visible when scrolling horizontally
- Alternating row background colors for readability
- Row count and active filter summary displayed above the table

### Columns to Display

Display the following columns in this order (matching the Google Sheet):

1. Company Name
2. Google Reviews
3. State
4. Phone Number
5. Reach Out Response
6. Last Reach Out
7. Next Reach Out
8. Owner's Name
9. Amount of Calls
10. Who Called
11. Email
12. Notes
13. Calls: Leonard
14. Calls: Tommaso
15. Calls: John
16. Calls: Sunzim
17. Calls: Henry
18. Total Dialed

### Inline Editing

Every cell (except `id` and timestamps) must be **directly editable inline** — no modal popups. Implement as follows:

- **Text fields** (`company_name`, `owners_name`, `phone_number`, `email`, `notes`): Click the cell → turns into an `<input>` or `<textarea>`. On blur or Enter key, save to Supabase and show a success toast.
- **Dropdowns** (`state`, `reach_out_response`, `who_called`): Click the cell → renders a `<select>` or a custom dropdown with predefined options. Auto-saves on selection.
- **Date fields** (`last_reach_out`, `next_reach_out`): Click → renders a date picker input. Auto-saves on change.
- **Number fields** (`google_reviews`, `amount_of_calls`, call counts): Click → renders a number input. Auto-saves on blur.
- **Optimistic updates:** Update local state immediately on save attempt, revert on API error.
- Show a subtle "saving..." indicator per row while a save is in flight.

### Sorting

- Every column header should be clickable to sort ascending/descending.
- Default sort: `google_reviews` descending (matches original sheet).
- Show a sort direction indicator on the active column.

### Filtering

Build a filter bar above the table with the following controls:

- **State** — multi-select dropdown (MI, MN, PA, OH, WI, WA)
- **Reach Out Response** — multi-select dropdown
- **Who Called** — multi-select dropdown
- **Next Reach Out** — date range picker (from / to)
- **Search** — full-text search across `company_name`, `owners_name`, `email`, `notes`
- **"Not yet called"** — a quick-filter toggle button that filters to rows where `reach_out_response = 'Not called'`
- **"Intro meetings"** — a quick-filter toggle that filters to rows where `reach_out_response = 'Intro-meeting wanted'`

Filters should update the URL query params so the filtered view is shareable/bookmarkable.

---

## Phase 6 — Add New Company

1. Add a "+ Add Company" button fixed at the top right of the screen.

2. Clicking it appends a new blank row at the top of the table (not a modal) with all cells in edit mode.

3. At minimum, `company_name` must be filled before saving. Show inline validation if left blank.

4. On save, insert the row into Supabase and reload the table data.

5. Optionally, allow the user to paste a raw phone number and have the app auto-format it.

---

## Phase 7 — Dashboard / Stats Panel

Add a collapsible stats bar above the table with the following metrics computed from the current filtered dataset:

- Total companies in view
- Total calls made
- Intro meetings scheduled (count of `Intro-meeting wanted` rows)
- Not yet called (count of `Not called` rows)
- Calls by team member (small breakdown: Leonard: 101, Tommaso: 10, etc.)
- Introduction meeting rate (shown as a percentage — already tracked in the sheet)

The stats bar should update live as filters change.

---

## Phase 8 — Authentication

1. Use Supabase Auth with email/password only. No self-signup — accounts are created manually in the Supabase dashboard.

2. Build a simple `/login` page with email + password fields and a "Sign In" button.

3. On successful login, redirect to the main `/` route (the spreadsheet view).

4. The Supabase middleware (set up in Phase 1) should redirect unauthenticated users to `/login` on every protected route.

5. Add a "Sign Out" button in the top nav.

6. No role-based access control needed at this stage — all authenticated users have full read/write access.

---

## Phase 9 — UX Polish

1. **Loading state:** Show a skeleton loader (matching the table structure) while data is being fetched on initial load.

2. **Empty state:** If filters return zero results, show a clear empty state message with a "Clear filters" button.

3. **Color coding for Reach Out Response:** Apply subtle row or cell background colors based on response status:
   - Green tint → "Intro-meeting wanted"
   - Red tint → "Owner is not interested" or "Already acquired"
   - Yellow tint → "Left a message to the owner" or "Call back on Monday"
   - Gray → "Not called"

4. **Next Reach Out highlighting:** If `next_reach_out` is today or in the past and the status is still pending, highlight that date cell in orange/red as a call-to-action.

5. **Phone number click-to-call:** Wrap phone numbers in a `tel:` link so clicking on mobile triggers a call.

6. **Responsive behavior:** The table should scroll horizontally on smaller screens. The first column (`company_name`) and the action column stay sticky.

7. **Keyboard navigation:** Tab through cells in edit mode, Enter to save, Escape to cancel an edit without saving.

---

## Phase 10 — Deployment

1. Deploy the Next.js app to Vercel. Connect the GitHub repo for automatic deployments on push to `main`.

2. Add the Supabase environment variables to the Vercel project settings.

3. Set up a custom domain if available.

4. Verify that Supabase RLS policies are active and the service role key is never exposed to the client.

5. Test the full flow: login → view table → edit a cell → add a new company → filter → log out.

---

## Stretch Goals (Post-MVP)

These are not required for launch but should be architecturally planned for:

- **Activity log / audit trail:** Log every cell edit (who changed what, when) to a separate `activity_log` table.
- **CSV export:** Allow exporting the current filtered view as a CSV download.
- **Bulk edit:** Select multiple rows and update a field (e.g., set `who_called` for a batch of rows).
- **Ohio expansion:** The schema already supports it — just ensure OH is included in the state dropdown.
- **Email column action:** One-click "Copy email" button on the email cell.
- **Notes history:** Track previous notes values over time, not just the latest.

---

## Key Design Decisions to Confirm with Leonard Before Building

1. Should the `total_dialed` column be auto-computed from the sum of all individual caller columns, or stored separately?
2. Should "Next Reach Out" dates auto-populate as +14 days from `last_reach_out` when a call is logged?
3. Are there any columns in the sheet that are no longer needed and can be dropped?
4. Should duplicate company names (visible in the sheet) be allowed, or enforce uniqueness?
5. Does the team need to see each other's edits in real-time (would require Supabase Realtime subscriptions)?