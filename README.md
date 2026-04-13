# Holter Holdings — Outreach CRM

A full-stack acquisition outreach platform built to manage the end-to-end pipeline for identifying, contacting, and closing deals on small businesses. Features a browser-based VoIP dialer with real-time multi-user presence, an AI-powered geographic scraper, automated email cadences, and a CRM pipeline — all in a single Next.js 16 application.

Built for a team of 4 making hundreds of outbound calls per day across thousands of leads.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Next.js 16 (App Router)                      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐  │
│  │  Server       │  │  Client      │  │  API Routes              │  │
│  │  Components   │  │  Islands     │  │                          │  │
│  │              │  │              │  │  /api/twilio/*   (Voice)  │  │
│  │  /pipeline   │  │  CallingUI   │  │  /api/companies/* (CRUD) │  │
│  │  /stats      │  │  FollowUp    │  │  /api/scrape     (SSE)   │  │
│  │  /meetings   │  │  Filters     │  │  /api/email/*    (Gmail) │  │
│  │  /follow-up  │  │  EmailModal  │  │  /api/quick-add  (AI)    │  │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬───────────────┘  │
│         │                 │                      │                  │
└─────────┼─────────────────┼──────────────────────┼──────────────────┘
          │                 │                      │
          ▼                 ▼                      ▼
┌──────────────┐  ┌──────────────────┐  ┌──────────────────────────┐
│   Supabase   │  │  Twilio Voice    │  │  External APIs           │
│  ─────────── │  │  ──────────────  │  │  ────────────────────    │
│  Postgres    │  │  WebRTC SDK      │  │  Google Places (New)     │
│  Auth        │  │  TwiML webhooks  │  │  Anthropic Claude        │
│  Realtime    │  │  Call recording  │  │  Gmail OAuth2            │
│  Storage     │  │  SMS             │  │  SkipCalls (spam check)  │
└──────────────┘  └──────────────────┘  └──────────────────────────┘
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | **Next.js 16** (App Router, React 19, TypeScript) |
| Database | **Supabase** (Postgres, Row Level Security, Realtime, Storage) |
| Telephony | **Twilio** (Voice SDK, TwiML, SMS, Call Recording) |
| AI / NLP | **Anthropic Claude** (structured extraction, web research) |
| Email | **Google Gmail API** (OAuth2, scheduled sends) |
| Geospatial | **Google Places API (New)** with adaptive quadtree subdivision |
| UI | **Tailwind CSS v4**, **TanStack Table v8**, **Sonner** |
| Deployment | **Vercel** (edge functions, cron jobs) |

---

## Core Features

### 1. Browser-Based VoIP Dialer with Real-Time Presence

The calling interface (`/call`) is a full softphone running in the browser via **Twilio Voice SDK (WebRTC)**. Callers connect directly from the web app — no external phone needed.

**Multi-user presence** — Supabase Realtime channels broadcast which company each caller is viewing. If two callers land on the same lead, the system auto-advances the second caller and shows a toast notification. This prevents duplicate calls across the team.

**Smart queue ordering** — Companies are sorted into priority tiers:
1. Not-yet-called + callback window matches now (day-of-week + ±2hr time window)
2. Not-yet-called (sorted by Google review count descending)
3. Previously contacted + callback window active
4. Previously contacted (oldest contact date first)

**Caller ID rotation** — Each team member is assigned a different outbound number daily using `(callerIndex + dayOfYear) % numNumbers`. An 80-dial-per-number daily cap prevents carrier spam flagging. Usage is tracked in `number_daily_usage` with row-level locks (`number_locks`) ensuring concurrent callers never share a number.

**Auto-dialer mode** — A toggle that automatically saves the current call outcome and dials the next company after a 3-second countdown. Uses refs to avoid React stale closure issues in setTimeout chains.

**In-call controls** — Mute, DTMF keypad, hang up. Call duration timer, call SID tracking, and automatic recording via Twilio webhook.

**Spam health monitoring** — Integrates with SkipCalls API to check if outbound numbers have been flagged as spam, displayed inline with report counts.

### 2. Adaptive Quadtree Geographic Scraper

A geographic lead generation engine that scrapes Google Places API (New) across the entire United States, state by state.

**The problem**: Google's `searchText` endpoint caps results at 60 per query. A single query for "garage door company in Texas" misses most results.

**The solution**: Recursive quadtree subdivision of geographic bounding boxes. The algorithm:
1. Starts with the full state bounding box
2. Queries Google Places within that rectangle
3. If results hit the 60-result cap OR the cell is larger than ~2° — the cell is subdivided into 4 quadrants
4. Each quadrant is recursively searched
5. Results are deduplicated by `place_id` before upserting to the database

Progress streams to the UI via **Server-Sent Events (SSE)** with real-time cell count, result count, and dedup stats.

The CLI version (`scripts/scrape-google-maps.mjs`) supports checkpoint/resume for long-running full-US scrapes.

### 3. AI-Powered Lead Enrichment

Each company can be enriched via a two-stage AI pipeline:

1. **Google Place Details** — Fetches all reviews, ratings, and metadata
2. **Anthropic Claude (with web search tool)** — Analyzes reviews to extract technician names, estimates revenue range and headcount, identifies acquisition signals (owner retirement mentions, growth patterns, service quality indicators)

The enrichment result includes `estimated_revenue_min/max`, `revenue_confidence`, `technician_count_estimate`, `enrichment_reasoning`, and `enrichment_signals` — all persisted to the database.

### 4. CRM Pipeline with URL-Synced Filters

A spreadsheet-style pipeline view (`/pipeline`) built on **TanStack Table v8** with:
- Inline cell editing (text, number, select, date) with optimistic updates
- Multi-dimensional filtering: state, response status, caller, date range, full-text search
- Filter state synced to URL query params so views are shareable/bookmarkable
- Color-coded rows: green (intro meeting), red (not interested), yellow (callback), gray (uncalled)
- Overdue highlighting for past-due `next_reach_out` dates
- Collapsible stats panel with live KPIs that update with active filters

### 5. Follow-Up Cadence Engine

The follow-up system (`/follow-up`) manages post-intro-meeting outreach with a touch-based cadence:

| Touch # | Base interval | High-priority interval |
|---------|--------------|----------------------|
| 1 | 2 days | 1 day |
| 2 | 4 days | 2 days |
| 3 | 7 days | 3 days |
| 4 | 10 days | 5 days |
| 5+ | 14 days | 7 days |

Companies are split into high-priority and standard queues. Each card shows email/call action buttons and an inline compose modal with auto-populated templates (owner name + company name).

### 6. Review-Tiered Reschedule Logic

After each call, the next reach-out date is computed based on the company's Google review count (a proxy for business size) and how many times they've been called:

| Reviews | 1st call | 2nd call | 3rd+ |
|---------|----------|----------|------|
| 500+ | 7 days | 10 days | 14 days |
| < 500 | 14 days | 14 days | 21 days |

Higher-review companies are contacted more frequently because they represent higher-value acquisition targets.

### 7. Email System with Scheduling

Emails are sent via **Gmail OAuth2** through the Gmail API. The compose modal supports:
- Auto-populated templates with owner name and company name
- Immediate send or scheduled send (persisted to `scheduled_emails` table)
- A **Vercel cron job** runs daily at 9am UTC to process the scheduled email queue

### 8. Inbound Call & SMS Handling

The system handles inbound communication across all Twilio numbers:
- **Inbound calls** are forwarded to configured numbers with TwiML, falling back to voicemail
- **Inbound SMS** is logged to `incoming_messages` and viewable in the `/numbers` inbox
- An `IncomingCallListener` component registers a Twilio Device on non-calling pages so incoming calls can be received anywhere in the app

### 9. CIM Document Management

For deals that progress to NDA stage, the `/cim` page provides:
- Per-company document upload to Supabase Storage (`cim-documents` bucket)
- Document listing, download, and deletion
- Filtered view of companies with NDA received status

---

## Data Model

The `companies` table contains 40+ columns spanning the full acquisition lifecycle:

```
Identification    │ id, company_name, google_place_id, phone_number, email, website
Location          │ state, address, county, latitude, longitude
Outreach          │ reach_out_response, last_reach_out, next_reach_out, amount_of_calls
                  │ who_called, calls_leonard, calls_tommaso, calls_john, calls_henry
Scheduling        │ callback_day, callback_time
Deal Progress     │ meeting_priority, loi_sent, loi_sent_date, follow_up_calls, follow_up_emails
Enrichment        │ google_reviews, google_rating, estimated_revenue_min/max,
                  │ revenue_confidence, technician_count_estimate,
                  │ enrichment_reasoning, enrichment_signals, enriched_at
Telephony         │ last_call_sid, total_dialed
```

Supporting tables: `company_notes`, `call_recordings`, `team_members`, `scheduled_emails`, `incoming_messages`, `incoming_calls`, `number_daily_usage`, `number_locks`, `cim_documents`.

---

## API Routes

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/companies` | GET, POST | Paginated list with filters; create new company |
| `/api/companies/[id]` | PATCH, DELETE | Update fields; delete company |
| `/api/companies/[id]/notes` | GET, POST | Note history per company |
| `/api/companies/[id]/enrich` | POST | AI enrichment (Google Places + Claude) |
| `/api/quick-add` | POST | Claude-parsed Google Maps text → company insert |
| `/api/deduplicate` | POST | Dedupe by normalized phone number |
| `/api/scrape` | POST | State-level scrape with SSE progress stream |
| `/api/twilio/token` | POST | Twilio Access Token with caller ID assignment |
| `/api/twilio/voice` | POST | TwiML for outbound calls + recording webhook |
| `/api/twilio/incoming-call` | POST | TwiML for inbound call routing + voicemail |
| `/api/twilio/incoming-sms` | POST | Log inbound SMS |
| `/api/twilio/send-sms` | POST | Send outbound SMS |
| `/api/twilio/recording-webhook` | POST | Persist call recordings |
| `/api/twilio/recordings/[companyId]` | GET | List recordings for a company |
| `/api/twilio/recordings/stream` | GET | Proxy Twilio audio with `Range` header support |
| `/api/number-health` | GET | SkipCalls spam reputation check |
| `/api/email/send` | POST | Gmail send (immediate or scheduled) |
| `/api/email/process` | GET | Cron: process scheduled email queue |
| `/api/stats/leaderboard` | GET | Today + all-time caller stats |
| `/api/cim/[companyId]` | GET, POST, DELETE | CIM document management |

---

## Project Structure

```
app/
├── call/page.tsx                 # VoIP dialer with queue management
├── pipeline/page.tsx             # CRM spreadsheet view
├── follow-up/page.tsx            # Follow-up cadence queues
├── meetings/page.tsx             # Intro-meeting leads list
├── meetings/[id]/page.tsx        # Single lead detail view
├── stats/page.tsx                # Team performance analytics
├── recordings/page.tsx           # Call recording browser
├── scrape/page.tsx               # Geographic scraper UI (SSE)
├── numbers/page.tsx              # Phone health + SMS inbox
├── cim/page.tsx                  # Confidential document management
├── quick-add/page.tsx            # AI-parsed lead entry
├── settings/page.tsx             # Navigation hub
├── start/page.tsx                # Caller selection + daily KPIs
├── login/page.tsx                # Supabase email/password auth
└── api/                          # 20+ API routes (see table above)

components/
├── CallingSession.tsx            # Full dialer: Twilio SDK, presence, auto-dialer
├── IncomingCallListener.tsx      # Global inbound call handler
├── CompanyTable.tsx              # TanStack Table pipeline grid
├── FollowUpQueue.tsx             # Cadence-based follow-up cards
├── EmailComposeModal.tsx         # Gmail compose with templates
├── FilterBar.tsx                 # Multi-dimensional filter controls
├── StatsPanel.tsx                # Live KPI summary bar
├── LeadDetailClient.tsx          # Meeting lead detail view
├── CimClient.tsx                 # Document upload/management
├── RecordingsPlayer.tsx          # Audio player with proxied streams
├── NumberHealthClient.tsx        # Spam check dashboard
├── NumbersInbox.tsx              # SMS/call inbox
└── Nav.tsx                       # App navigation

lib/
├── supabase/client.ts            # Browser Supabase client (@supabase/ssr)
├── supabase/server.ts            # Server client (service role key)
├── data.ts                       # Server-side query helpers
├── scraper.ts                    # Quadtree scraper engine
└── gmail.ts                      # Gmail API OAuth2 send

scripts/
├── scrape-google-maps.mjs        # CLI scraper with checkpoint/resume
├── enrich-leads.mjs              # Batch AI enrichment
├── migrate.mjs                   # CSV → Supabase import
├── migrate-full.mjs              # Full reimport from TSV
├── dedup.mjs                     # Phone number deduplication
├── audit.mjs                     # CSV ↔ DB reconciliation
└── fix-missing.mjs               # Insert missing rows

types/index.ts                    # Company, CompanyNote, shared constants
supabase/schema.sql               # Full DB schema + RLS + indexes + seeds
```

---

## Setup

### 1. Supabase

1. Create a project at [supabase.com](https://supabase.com)
2. Run `supabase/schema.sql` in the SQL Editor
3. Create user accounts in Authentication → Users

### 2. Environment Variables

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Twilio
TWILIO_ACCOUNT_SID=
TWILIO_API_KEY=
TWILIO_API_SECRET=
TWILIO_TWIML_APP_SID=
TWILIO_PHONE_NUMBERS=             # comma-separated
TWILIO_FORWARD_NUMBER=

# Google
GOOGLE_MAPS_API_KEY=
GMAIL_CLIENT_ID=
GMAIL_CLIENT_SECRET=
GMAIL_REFRESH_TOKEN=
GMAIL_SENDER_EMAIL=

# AI
ANTHROPIC_API_KEY=
```

### 3. Install & Run

```bash
npm install
npm run dev
```

### 4. Data Migration

```bash
npm run migrate    # CSV → Supabase
npm run scrape     # Full geographic scrape (long-running)
npm run enrich     # Batch AI enrichment
```

---

## Deployment

1. Push to GitHub
2. Import in Vercel
3. Add environment variables in Vercel → Project Settings
4. Deploy — auto-deploys on push to `main`
5. Vercel cron processes scheduled emails daily at 9am UTC
