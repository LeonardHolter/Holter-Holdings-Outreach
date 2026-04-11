# Exhaustive Google Maps Scraper — Technical Specification

A system for scraping **every business in a specific industry** from Google Maps across all 50 US states using the Google Places API (New) with adaptive quadtree subdivision.

Originally built for garage door service companies but easily adaptable to any industry by changing the search queries.

---

## Table of Contents

1. [Problem & Approach](#problem--approach)
2. [Architecture Overview](#architecture-overview)
3. [Google Places API Details](#google-places-api-details)
4. [The Quadtree Algorithm](#the-quadtree-algorithm)
5. [Pagination Within a Cell](#pagination-within-a-cell)
6. [Rate Limiting & Retry Logic](#rate-limiting--retry-logic)
7. [Deduplication](#deduplication)
8. [Data Normalization](#data-normalization)
9. [Checkpoint / Resume System](#checkpoint--resume-system)
10. [Database Persistence](#database-persistence)
11. [Configuration Reference](#configuration-reference)
12. [Adapting to Your Industry](#adapting-to-your-industry)
13. [Cost Estimate](#cost-estimate)
14. [Entrypoints](#entrypoints)

---

## Problem & Approach

### The Problem

Google Places Text Search returns a **maximum of 60 results** per query, even if thousands of matching businesses exist in the search area. There is no way to increase this limit — it is a hard cap in the API. A single query for "garage door service" in California will return only 60 of the ~1,500 actual businesses.

### The Solution: Adaptive Quadtree Subdivision

Instead of making one large query per state, the scraper recursively splits each state into smaller and smaller geographic rectangles until every sub-rectangle returns **fewer than 60 results** (meaning the API returned everything in that area, not a truncated list).

```
State bounding box (e.g. California)
┌─────────────────────────────┐
│         60+ results         │  <- API truncated, subdivide
│                             │
└─────────────────────────────┘
                ↓
┌──────────┬──────────────────┐
│ 60+ hits │    38 results ✓  │  <- top-right is complete
├──────────┼──────────────────┤
│ 22 ✓     │    60+ hits      │  <- bottom-right needs split
└──────────┴──────────────────┘
                ↓
         ... keep splitting bottom-right ...
```

This guarantees **full coverage** of every listed business in the state.

---

## Architecture Overview

The scraper exists in two forms that share the same core algorithm:

```
┌──────────────────────────────────────────────────────────────┐
│                    Shared Core (lib/scraper.ts)               │
│  textSearchRect() → fetchAllPages() → searchArea() [recurse] │
│  scrapeState() → runs 4 queries × 1 state                    │
└──────────────┬─────────────────────────────┬─────────────────┘
               │                             │
    ┌──────────▼──────────┐       ┌──────────▼──────────────┐
    │   CLI Script         │       │   Web API Route          │
    │   (Node.js, .mjs)    │       │   (Next.js, SSE stream)  │
    │                      │       │                          │
    │ - Runs all 50 states │       │ - Runs 1 state at a time │
    │ - Checkpoint/resume  │       │ - Streams progress to UI │
    │ - JSON file output   │       │ - Upserts to DB on done  │
    │ - Supabase upsert    │       │                          │
    └──────────────────────┘       └──────────────────────────┘
```

### CLI Script (`scripts/scrape-google-maps.mjs`)

Standalone Node.js script for bulk scraping. Iterates through all 50 states (or a filtered subset), saves progress to disk after every query, and can resume from where it left off after a crash or interruption.

```bash
# Scrape all 50 states
node scripts/scrape-google-maps.mjs

# Scrape specific states
node scripts/scrape-google-maps.mjs --states TX,CA,FL

# Dry run (no database writes, just collect results to JSON)
node scripts/scrape-google-maps.mjs --dry-run
```

### Web API Route (`/api/scrape`)

Next.js API route that scrapes one state at a time, streaming Server-Sent Events (SSE) back to the browser for a live progress UI. Used by a web page that shows a clickable grid of all 50 states.

---

## Google Places API Details

### Endpoint

```
POST https://places.googleapis.com/v1/places:searchText
```

This is the **Places API (New)** — the newer version of the Places API. Not the legacy "Find Place" or "Nearby Search" endpoints.

### Request Format

```json
{
  "textQuery": "garage door service",
  "locationRestriction": {
    "rectangle": {
      "low":  { "latitude": 32.53, "longitude": -124.41 },
      "high": { "latitude": 42.01, "longitude": -114.13 }
    }
  },
  "pageSize": 20
}
```

### Headers

| Header | Value |
|--------|-------|
| `Content-Type` | `application/json` |
| `X-Goog-Api-Key` | Your Google Maps API key |
| `X-Goog-FieldMask` | Comma-separated list of fields to return (see below) |

### Field Mask

The field mask controls which fields are returned (and billed). The scraper requests:

```
places.id
places.displayName
places.formattedAddress
places.nationalPhoneNumber
places.websiteUri
places.rating
places.userRatingCount
places.location
places.types
nextPageToken
```

**Important:** The field mask directly affects cost. Only request fields you need. The `nextPageToken` field is required for pagination but is not a "places" field — it's top-level.

### Response Format

```json
{
  "places": [
    {
      "id": "ChIJ...",
      "displayName": { "text": "Acme Garage Doors", "languageCode": "en" },
      "formattedAddress": "123 Main St, Austin, TX 78701, USA",
      "nationalPhoneNumber": "(512) 555-1234",
      "websiteUri": "https://acmegaragedoors.com",
      "rating": 4.7,
      "userRatingCount": 342,
      "location": { "latitude": 30.2672, "longitude": -97.7431 },
      "types": ["garage_door_supplier", "point_of_interest", "establishment"]
    }
  ],
  "nextPageToken": "token-for-next-page-or-absent-if-last-page"
}
```

### Key Constraints

| Constraint | Value | Impact |
|-----------|-------|--------|
| Max results per query (all pages) | **60** | The core problem — triggers subdivision |
| Max page size | **20** | So 60 results = 3 pages maximum |
| Page token delay | ~2 seconds | Must wait before using `nextPageToken` |

---

## The Quadtree Algorithm

This is the heart of the scraper. The function `searchArea()` is called recursively.

### Pseudocode

```
function searchArea(bounds, query, collected, depth):
    results = fetchAllPages(query, bounds)    // API call(s)

    if results is empty:
        return                                 // no businesses here, stop

    shouldSubdivide = (
        depth < MAX_DEPTH AND
        (results.length >= 60 OR boundsAreTooLarge(bounds))
    )

    if shouldSubdivide:
        quadrants = splitIntoFour(bounds)
        for each quadrant:
            searchArea(quadrant, query, collected, depth + 1)
        return                                 // don't keep these results, children will re-fetch

    // This cell is complete — collect the results
    for each place in results:
        if place.id not in collected:
            collected[place.id] = normalize(place)
```

### Subdivision Decision Matrix

| Condition | Action |
|-----------|--------|
| 0 results | **Stop.** Empty area, no point going deeper. |
| < 60 results AND cell < 2 degrees | **Keep results.** This cell is fully enumerated. |
| >= 60 results | **Subdivide.** Results were truncated by the cap. |
| Any results AND cell > 2 degrees | **Subdivide.** Large cells silently drop results even below the 60-result cap. |
| >= 60 results AND depth >= MAX_DEPTH | **Keep results + warn.** Safety valve to prevent infinite recursion. Some results may be missing. |

### Why the "Cell Too Large" Rule?

Through testing, we discovered that bounding boxes larger than ~2 degrees (~200 km) in either dimension cause the API to **silently truncate results** — even when fewer than 60 businesses exist in the area. The API returns 30 results and no `nextPageToken`, making it look complete when it isn't.

Forcing subdivision on oversized cells eliminates this problem.

### Why Discard Results on Subdivide?

When a cell is subdivided, its results are **not kept**. Instead, the 4 child quadrants each make their own API calls. This is because:

1. The 60 results from the parent cell are a truncated/biased sample — you don't know which businesses were dropped.
2. The child cells will re-discover those same businesses (plus the ones that were hidden).
3. Deduplication by `google_place_id` ensures no doubles.

### Depth Limit

`MAX_DEPTH = 15` prevents infinite recursion. At depth 15, each cell is approximately 0.0001 degrees (about 11 meters). If the API still returns 60+ results for an 11m x 11m area, something is very wrong and we accept the truncation with a warning.

---

## Pagination Within a Cell

For a single query + bounding box, the API returns up to 20 results per page and provides a `nextPageToken` for the next page. The maximum is 3 pages = 60 results.

```
Page 1: textSearchRect(query, bounds)           → 20 results + nextPageToken
  wait 2 seconds
Page 2: textSearchRect(query, bounds, token)    → 20 results + nextPageToken
  wait 2 seconds
Page 3: textSearchRect(query, bounds, token)    → 20 results (no token = last page)

Total: up to 60 results
```

The 2-second delay between pages (`PAGE_DELAY_MS = 2000`) is required — using the `nextPageToken` immediately returns an error.

---

## Rate Limiting & Retry Logic

### Throttle

A global throttle ensures at least **300ms** between consecutive API requests. This prevents 429 (rate limit) responses during deep recursion where many cells are queried in rapid succession.

### Retry with Exponential Backoff

Every API call is wrapped in a retry loop:

| Attempt | Backoff | Cumulative wait |
|---------|---------|-----------------|
| 1 | 0 (first try) | 0s |
| 2 | 2,000ms | 2s |
| 3 | 4,000ms | 6s |
| 4 | 8,000ms | 14s |
| 5 | 16,000ms | 30s |

Max backoff is capped at 60 seconds. After 5 failed attempts:
- **429 errors:** Return empty results (graceful degradation — the area may get partial coverage).
- **Other errors:** Throw (crash the current state, checkpoint allows resume).

---

## Deduplication

Deduplication happens at two levels:

### 1. Within a Scrape Run (In-Memory)

All results across all queries and subdivisions are stored in a single `Map<string, ScrapedCompany>` keyed by `google_place_id`. If the same business appears in multiple overlapping queries or subdivided cells, it is counted once.

### 2. On Database Insert (Upsert)

The database table has a `UNIQUE` constraint on `google_place_id`. The upsert uses:

```
onConflict: 'google_place_id', ignoreDuplicates: true
```

This means re-running the scraper for a state that was already scraped will not create duplicates — existing rows are left untouched.

---

## Data Normalization

Each raw API response is normalized into a flat record:

| Field | Source | Transform |
|-------|--------|-----------|
| `google_place_id` | `place.id` | Direct |
| `company_name` | `place.displayName.text` | Direct |
| `address` | `place.formattedAddress` | Direct |
| `state` | `place.formattedAddress` | Regex: extract 2-letter state code before ZIP (`/,\s*([A-Z]{2})\s+\d{5}/`) |
| `phone_number` | `place.nationalPhoneNumber` | Strip all non-digit characters |
| `website` | `place.websiteUri` | Direct |
| `google_rating` | `place.rating` | Direct (1.0–5.0) |
| `google_reviews` | `place.userRatingCount` | Direct (integer) |
| `latitude` | `place.location.latitude` | Direct |
| `longitude` | `place.location.longitude` | Direct |
| `types` | `place.types` | Array joined with commas |

---

## Checkpoint / Resume System

The CLI script saves progress to disk so it can resume after crashes or interruptions.

### Checkpoint File (`.scrape-checkpoint.json`)

```json
{
  "completedStates": ["AL", "AK", "AZ"],
  "completedQueries": {
    "AR": ["garage door service", "garage door repair"]
  }
}
```

- `completedStates`: States where all 4 queries have finished. Skipped entirely on resume.
- `completedQueries`: Partially completed states. Only the remaining queries run on resume.

### Results File (`scrape-results.json`)

A JSON array of all scraped companies. Saved to disk after every completed query. On resume, loaded back into memory and used as the starting point (deduplication map).

### Checkpoint Granularity

Progress is saved after each **query within a state**, not after each API call. So in the worst case, a crash loses the work from one query in one state (not the entire run).

```
State: AR
  Query 1: "garage door service"  ✓ saved
  Query 2: "garage door repair"   ✓ saved
  Query 3: "garage door company"  ← crash here = redo this query only
  Query 4: "overhead door company" ← not started
```

---

## Database Persistence

### Schema

The scraper needs these columns on your companies table:

```sql
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS google_place_id TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS address         TEXT,
  ADD COLUMN IF NOT EXISTS website         TEXT,
  ADD COLUMN IF NOT EXISTS latitude        DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS longitude       DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS google_rating   NUMERIC(2,1),
  ADD COLUMN IF NOT EXISTS county          TEXT;

CREATE INDEX IF NOT EXISTS idx_companies_google_place_id
  ON companies(google_place_id);
```

The `UNIQUE` constraint on `google_place_id` is essential for idempotent upserts.

Your table also needs at minimum: `company_name TEXT`, `state TEXT`, `phone_number TEXT`, `google_reviews INTEGER`.

### Upsert Logic

Records are upserted in batches of 100:

```javascript
await supabase
  .from('companies')
  .upsert(batch, { onConflict: 'google_place_id', ignoreDuplicates: true })
```

`ignoreDuplicates: true` means existing rows are **not updated** — only new businesses are inserted. This preserves any manual edits or status changes made to previously scraped companies.

New records get `reach_out_response: 'Not called'` as the default status.

---

## Configuration Reference

| Constant | Value | Purpose |
|----------|-------|---------|
| `RESULT_CAP` | 60 | API's hard limit per query. Triggers subdivision when hit. |
| `MAX_DEPTH` | 15 | Maximum recursion depth. Safety valve against infinite loops. |
| `PAGE_SIZE` | 20 | Results per page (API max is 20). |
| `PAGE_DELAY_MS` | 2000 | Delay between pagination requests (required by API). |
| `REQUEST_DELAY_MS` | 300 | Minimum interval between any two API requests (throttle). |
| `MAX_RETRIES` | 5 | Retry count on 429 or network errors. |
| `MAX_CELL_DEGREES` | 2.0 | Force subdivision when cell spans > 2 degrees (~200 km). |
| `SEARCH_QUERIES` | 4 queries | Each query runs independently per state for full coverage. |

---

## Adapting to Your Industry

To scrape a different type of business, you only need to change two things:

### 1. Search Queries

Replace the `SEARCH_QUERIES` array with queries relevant to your industry:

```javascript
// Original (garage doors)
const SEARCH_QUERIES = [
  'garage door service',
  'garage door repair',
  'garage door company',
  'overhead door company',
]

// Example: plumbing
const SEARCH_QUERIES = [
  'plumber',
  'plumbing service',
  'plumbing company',
  'plumbing repair',
]
```

Multiple queries with different phrasings catch businesses that optimize for different keywords. The deduplication system handles the overlap.

### 2. State Bounding Boxes (Optional)

If you're scraping outside the US, replace `STATE_BOUNDS` with your own geographic regions. Each region needs a `low` (southwest corner) and `high` (northeast corner) in latitude/longitude:

```javascript
const REGION_BOUNDS = {
  'London': {
    low:  { lat: 51.28, lng: -0.51 },
    high: { lat: 51.69, lng: 0.33 },
  },
  // ...
}
```

The algorithm works identically regardless of geography.

---

## Cost Estimate

### Pricing (Google Places API New — Text Search)

$0.032 per request (first 100,000/month). Google provides a **$200/month free credit** for Maps Platform.

### What Counts as a Request

Each HTTP call to `places:searchText` is one billable request — including pagination. So fetching 60 results (3 pages) from one cell = 3 billable requests.

### Estimated Cost for a Full US Scrape

For our garage door scrape (13,500 companies across 50 states):

| Metric | Estimate |
|--------|----------|
| Total API requests | ~5,000 – 12,000 |
| Gross cost | ~$160 – $384 |
| After $200 free credit | **$0 – $184** |

Dense states (CA, TX, FL) cost more due to heavy subdivision. Sparse states (VT, WY, ND) need very few calls.

---

## Entrypoints

### Environment Variables Required

```
GOOGLE_MAPS_API_KEY=your_key
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
```

### CLI

```bash
# All states, live mode (writes to DB)
node scripts/scrape-google-maps.mjs

# Subset of states
node scripts/scrape-google-maps.mjs --states TX,CA

# Dry run (saves to JSON only, no DB)
node scripts/scrape-google-maps.mjs --dry-run
```

### Web API

```bash
# Trigger a state scrape (returns SSE stream)
curl -X POST http://localhost:3000/api/scrape \
  -H "Content-Type: application/json" \
  -d '{"state": "TX"}'

# Get company counts per state
curl http://localhost:3000/api/scrape/counts
```

### SSE Event Types

| Event | Fields | Meaning |
|-------|--------|---------|
| `query_start` | `query`, `found` | Starting a new search query |
| `query_done` | `query`, `newCompanies`, `duplicates`, `apiCalls`, `subdivisions` | Query completed |
| `subdivision` | `depth`, `query` | A cell is being split into 4 (informational) |
| `done` | `total`, `apiCalls`, `subdivisions`, `duplicates` | All queries complete, results saved |
| `error` | `message` | Fatal error |
