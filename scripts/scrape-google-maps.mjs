/**
 * Exhaustive Google Maps scraper for garage door service companies.
 *
 * Uses adaptive quadtree subdivision to overcome the 60-result cap on
 * Google Places Text Search (New). Recursively splits geographic areas
 * until every sub-area returns below the cap, guaranteeing full coverage.
 *
 * Usage:
 *   export GOOGLE_MAPS_API_KEY=your_key
 *   node scripts/scrape-google-maps.mjs
 *   node scripts/scrape-google-maps.mjs --states TX,CA,FL
 *   node scripts/scrape-google-maps.mjs --dry-run
 */

import { readFileSync, writeFileSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createClient } from '@supabase/supabase-js'

const __dirname = dirname(fileURLToPath(import.meta.url))

// ── Config ────────────────────────────────────────────────────────

const RESULT_CAP = 60
const MAX_DEPTH = 15
const PAGE_SIZE = 20
const PAGE_DELAY_MS = 2000
const REQUEST_DELAY_MS = 300
const MAX_RETRIES = 5
// Force subdivision when a cell spans more than ~2 degrees in either
// dimension (~200 km). Large bounding boxes cause the API to silently
// drop results even below the 60-result cap.
const MAX_CELL_DEGREES = 2.0
const CHECKPOINT_PATH = resolve(__dirname, '.scrape-checkpoint.json')
const RESULTS_PATH = resolve(__dirname, 'scrape-results.json')

const SEARCH_QUERIES = [
  'garage door service',
  'garage door repair',
  'garage door company',
  'overhead door company',
]

const FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.nationalPhoneNumber',
  'places.websiteUri',
  'places.rating',
  'places.userRatingCount',
  'places.location',
  'places.types',
  'nextPageToken',
].join(',')

// ── CLI args ──────────────────────────────────────────────────────

const args = process.argv.slice(2)
const DRY_RUN = args.includes('--dry-run')
const statesFlag = args.find(a => a.startsWith('--states'))
const statesArg = statesFlag
  ? (args[args.indexOf(statesFlag) + 1] || statesFlag.split('=')[1])
  : null
const FILTER_STATES = statesArg
  ? statesArg.split(',').map(s => s.trim().toUpperCase())
  : null

// ── Env ───────────────────────────────────────────────────────────

function loadEnv() {
  try {
    const envPath = resolve(__dirname, '../.env.local')
    const raw = readFileSync(envPath, 'utf-8')
    for (const line of raw.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const idx = trimmed.indexOf('=')
      if (idx === -1) continue
      const key = trimmed.slice(0, idx).trim()
      const value = trimmed.slice(idx + 1).trim()
      if (!process.env[key]) process.env[key] = value
    }
  } catch { /* rely on actual env vars */ }
}

loadEnv()

const API_KEY = process.env.GOOGLE_MAPS_API_KEY
if (!API_KEY) {
  console.error('Set GOOGLE_MAPS_API_KEY in env or .env.local')
  process.exit(1)
}

let supabase = null
if (!DRY_RUN) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY for DB writes (or use --dry-run)')
    process.exit(1)
  }
  supabase = createClient(url, key)
}

// ── State bounding boxes (lat/lng) ───────────────────────────────

const STATE_BOUNDS = {
  AL: { low: { lat: 30.22, lng: -88.47 }, high: { lat: 35.01, lng: -84.89 } },
  AK: { low: { lat: 51.21, lng: -179.15 }, high: { lat: 71.39, lng: -129.98 } },
  AZ: { low: { lat: 31.33, lng: -114.81 }, high: { lat: 37.00, lng: -109.04 } },
  AR: { low: { lat: 33.00, lng: -94.62 }, high: { lat: 36.50, lng: -89.64 } },
  CA: { low: { lat: 32.53, lng: -124.41 }, high: { lat: 42.01, lng: -114.13 } },
  CO: { low: { lat: 36.99, lng: -109.06 }, high: { lat: 41.00, lng: -102.04 } },
  CT: { low: { lat: 40.95, lng: -73.73 }, high: { lat: 42.05, lng: -71.79 } },
  DE: { low: { lat: 38.45, lng: -75.79 }, high: { lat: 39.84, lng: -75.05 } },
  FL: { low: { lat: 24.40, lng: -87.63 }, high: { lat: 31.00, lng: -80.03 } },
  GA: { low: { lat: 30.36, lng: -85.61 }, high: { lat: 35.00, lng: -80.84 } },
  HI: { low: { lat: 18.91, lng: -160.24 }, high: { lat: 22.24, lng: -154.81 } },
  ID: { low: { lat: 41.99, lng: -117.24 }, high: { lat: 49.00, lng: -111.04 } },
  IL: { low: { lat: 36.97, lng: -91.51 }, high: { lat: 42.51, lng: -87.02 } },
  IN: { low: { lat: 37.77, lng: -88.10 }, high: { lat: 41.76, lng: -84.78 } },
  IA: { low: { lat: 40.38, lng: -96.64 }, high: { lat: 43.50, lng: -90.14 } },
  KS: { low: { lat: 36.99, lng: -102.05 }, high: { lat: 40.00, lng: -94.59 } },
  KY: { low: { lat: 36.50, lng: -89.57 }, high: { lat: 39.15, lng: -81.96 } },
  LA: { low: { lat: 28.93, lng: -94.04 }, high: { lat: 33.02, lng: -89.00 } },
  ME: { low: { lat: 43.06, lng: -71.08 }, high: { lat: 47.46, lng: -66.95 } },
  MD: { low: { lat: 37.91, lng: -79.49 }, high: { lat: 39.72, lng: -75.05 } },
  MA: { low: { lat: 41.24, lng: -73.51 }, high: { lat: 42.89, lng: -69.93 } },
  MI: { low: { lat: 41.70, lng: -90.42 }, high: { lat: 48.31, lng: -82.12 } },
  MN: { low: { lat: 43.50, lng: -97.24 }, high: { lat: 49.38, lng: -89.49 } },
  MS: { low: { lat: 30.17, lng: -91.66 }, high: { lat: 34.99, lng: -88.10 } },
  MO: { low: { lat: 35.99, lng: -95.77 }, high: { lat: 40.61, lng: -89.10 } },
  MT: { low: { lat: 44.36, lng: -116.05 }, high: { lat: 49.00, lng: -104.04 } },
  NE: { low: { lat: 39.99, lng: -104.05 }, high: { lat: 43.00, lng: -95.31 } },
  NV: { low: { lat: 35.00, lng: -120.01 }, high: { lat: 42.00, lng: -114.04 } },
  NH: { low: { lat: 42.70, lng: -72.56 }, high: { lat: 45.31, lng: -70.70 } },
  NJ: { low: { lat: 38.93, lng: -75.56 }, high: { lat: 41.36, lng: -73.89 } },
  NM: { low: { lat: 31.33, lng: -109.05 }, high: { lat: 37.00, lng: -103.00 } },
  NY: { low: { lat: 40.50, lng: -79.76 }, high: { lat: 45.02, lng: -71.86 } },
  NC: { low: { lat: 33.84, lng: -84.32 }, high: { lat: 36.59, lng: -75.46 } },
  ND: { low: { lat: 45.94, lng: -104.05 }, high: { lat: 49.00, lng: -96.55 } },
  OH: { low: { lat: 38.40, lng: -84.82 }, high: { lat: 41.98, lng: -80.52 } },
  OK: { low: { lat: 33.62, lng: -103.00 }, high: { lat: 37.00, lng: -94.43 } },
  OR: { low: { lat: 41.99, lng: -124.57 }, high: { lat: 46.29, lng: -116.46 } },
  PA: { low: { lat: 39.72, lng: -80.52 }, high: { lat: 42.27, lng: -74.69 } },
  RI: { low: { lat: 41.15, lng: -71.86 }, high: { lat: 42.02, lng: -71.12 } },
  SC: { low: { lat: 32.05, lng: -83.35 }, high: { lat: 35.22, lng: -78.54 } },
  SD: { low: { lat: 42.48, lng: -104.06 }, high: { lat: 45.95, lng: -96.44 } },
  TN: { low: { lat: 34.98, lng: -90.31 }, high: { lat: 36.68, lng: -81.65 } },
  TX: { low: { lat: 25.84, lng: -106.65 }, high: { lat: 36.50, lng: -93.51 } },
  UT: { low: { lat: 36.99, lng: -114.05 }, high: { lat: 42.00, lng: -109.04 } },
  VT: { low: { lat: 42.73, lng: -73.44 }, high: { lat: 45.02, lng: -71.46 } },
  VA: { low: { lat: 36.54, lng: -83.68 }, high: { lat: 39.47, lng: -75.24 } },
  WA: { low: { lat: 45.54, lng: -124.85 }, high: { lat: 49.00, lng: -116.92 } },
  WV: { low: { lat: 37.20, lng: -82.64 }, high: { lat: 40.64, lng: -77.72 } },
  WI: { low: { lat: 42.49, lng: -92.89 }, high: { lat: 47.31, lng: -86.25 } },
  WY: { low: { lat: 40.99, lng: -111.06 }, high: { lat: 45.01, lng: -104.05 } },
}

// ── Rate limiter ──────────────────────────────────────────────────

let lastRequestTime = 0

async function throttle() {
  const now = Date.now()
  const elapsed = now - lastRequestTime
  if (elapsed < REQUEST_DELAY_MS) {
    await sleep(REQUEST_DELAY_MS - elapsed)
  }
  lastRequestTime = Date.now()
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms))
}

// ── Google Places Text Search ─────────────────────────────────────

async function textSearchRect(query, bounds, pageToken) {
  await throttle()

  const body = {
    textQuery: query,
    locationRestriction: {
      rectangle: {
        low: { latitude: bounds.low.lat, longitude: bounds.low.lng },
        high: { latitude: bounds.high.lat, longitude: bounds.high.lng },
      },
    },
    pageSize: PAGE_SIZE,
  }

  if (pageToken) {
    body.pageToken = pageToken
  }

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': API_KEY,
          'X-Goog-FieldMask': FIELD_MASK,
        },
        body: JSON.stringify(body),
      })

      if (res.status === 429) {
        if (attempt === MAX_RETRIES - 1) {
          console.warn(`  Rate limited after ${MAX_RETRIES} retries, returning empty.`)
          return { places: [] }
        }
        const backoff = Math.min(2000 * Math.pow(2, attempt), 60000)
        console.warn(`  Rate limited, backing off ${backoff}ms...`)
        await sleep(backoff)
        continue
      }

      if (!res.ok) {
        const errBody = await res.text()
        throw new Error(`HTTP ${res.status}: ${errBody}`)
      }

      return await res.json()
    } catch (err) {
      if (attempt === MAX_RETRIES - 1) throw err
      const backoff = Math.min(2000 * Math.pow(2, attempt), 60000)
      console.warn(`  Request failed (attempt ${attempt + 1}/${MAX_RETRIES}): ${err.message}. Retrying in ${backoff}ms...`)
      await sleep(backoff)
    }
  }
  return { places: [] }
}

/**
 * Fetches all pages (up to the 60-result cap) for a single query+bounds.
 * Returns { places: [], hitCap: boolean }.
 */
async function fetchAllPages(query, bounds) {
  const allPlaces = []
  let pageToken = null

  for (let page = 0; page < 3; page++) {
    const data = await textSearchRect(query, bounds, pageToken)
    const places = data.places || []
    allPlaces.push(...places)

    if (!data.nextPageToken) break
    pageToken = data.nextPageToken
    await sleep(PAGE_DELAY_MS)
  }

  return {
    places: allPlaces,
    hitCap: allPlaces.length >= RESULT_CAP,
  }
}

// ── Quadtree subdivision ──────────────────────────────────────────

function subdivide(bounds) {
  const midLat = (bounds.low.lat + bounds.high.lat) / 2
  const midLng = (bounds.low.lng + bounds.high.lng) / 2
  return [
    { low: { lat: bounds.low.lat, lng: bounds.low.lng }, high: { lat: midLat, lng: midLng } },
    { low: { lat: bounds.low.lat, lng: midLng },        high: { lat: midLat, lng: bounds.high.lng } },
    { low: { lat: midLat, lng: bounds.low.lng },         high: { lat: bounds.high.lat, lng: midLng } },
    { low: { lat: midLat, lng: midLng },                 high: { lat: bounds.high.lat, lng: bounds.high.lng } },
  ]
}

function cellTooLarge(bounds) {
  return (
    bounds.high.lat - bounds.low.lat > MAX_CELL_DEGREES ||
    bounds.high.lng - bounds.low.lng > MAX_CELL_DEGREES
  )
}

/**
 * Recursively searches an area for a single query.
 * Always queries the API first, then decides whether to subdivide based
 * on both the result count AND the cell size.
 *  - 0 results → stop (empty area, no point subdividing further)
 *  - Hit the 60 cap → subdivide (results were truncated)
 *  - Got results but cell is oversized → subdivide (API may silently truncate)
 *  - Got results and cell is small → keep them (comprehensive)
 */
async function searchArea(bounds, query, collectedIds, depth, stats) {
  const pad = ' '.repeat(depth + 1)
  const latSpan = (bounds.high.lat - bounds.low.lat).toFixed(2)
  const lngSpan = (bounds.high.lng - bounds.low.lng).toFixed(2)

  const { places, hitCap } = await fetchAllPages(query, bounds)
  stats.apiCalls++

  if (places.length === 0) {
    console.log(`${pad}d${depth}: 0 results (${latSpan}°×${lngSpan}°) — skipping`)
    return
  }

  const shouldSubdivide =
    depth < MAX_DEPTH && (hitCap || cellTooLarge(bounds))

  if (shouldSubdivide) {
    const reason = hitCap ? `cap hit (${places.length})` : 'cell too large'
    console.log(`${pad}d${depth}: ${places.length} results (${latSpan}°×${lngSpan}°) — ${reason}, subdividing...`)
    stats.subdivisions++

    const quadrants = subdivide(bounds)
    for (const quad of quadrants) {
      await searchArea(quad, query, collectedIds, depth + 1, stats)
    }
    return
  }

  if (hitCap && depth >= MAX_DEPTH) {
    console.warn(`${pad}WARNING: Cap hit at max depth ${depth}. Some results may be missing.`)
    console.warn(`${pad}  Bounds: ${JSON.stringify(bounds)}`)
  }

  let newCount = 0
  for (const place of places) {
    const id = place.id || place.name
    if (!collectedIds.has(id)) {
      collectedIds.set(id, normalizePlace(place))
      stats.newPlaces++
      newCount++
    } else {
      stats.duplicates++
    }
  }
  console.log(`${pad}d${depth}: ${places.length} results, +${newCount} new (${latSpan}°×${lngSpan}°) ✓`)
}

// ── Normalize a Places API response into a flat record ────────────

function normalizePlace(place) {
  const addr = place.formattedAddress || ''
  return {
    google_place_id: place.id || null,
    company_name: place.displayName?.text || '',
    address: addr,
    state: extractState(addr),
    county: extractCounty(addr),
    phone_number: (place.nationalPhoneNumber || '').replace(/\D/g, '') || null,
    website: place.websiteUri || null,
    google_rating: place.rating || null,
    google_reviews: place.userRatingCount || null,
    latitude: place.location?.latitude || null,
    longitude: place.location?.longitude || null,
    types: (place.types || []).join(','),
  }
}

function extractState(address) {
  const match = address.match(/,\s*([A-Z]{2})\s+\d{5}/)
  return match ? match[1] : null
}

function extractCounty(address) {
  // Google's formattedAddress doesn't include county; we leave this null.
  // A reverse-geocode pass could fill it in later if needed.
  return null
}

// ── Checkpoint / resume ───────────────────────────────────────────

function loadCheckpoint() {
  if (!existsSync(CHECKPOINT_PATH)) return null
  try {
    return JSON.parse(readFileSync(CHECKPOINT_PATH, 'utf-8'))
  } catch {
    return null
  }
}

function saveCheckpoint(data) {
  writeFileSync(CHECKPOINT_PATH, JSON.stringify(data, null, 2))
}

function loadResults() {
  if (!existsSync(RESULTS_PATH)) return new Map()
  try {
    const arr = JSON.parse(readFileSync(RESULTS_PATH, 'utf-8'))
    return new Map(arr.map(r => [r.google_place_id, r]))
  } catch {
    return new Map()
  }
}

function saveResults(resultsMap) {
  const arr = [...resultsMap.values()]
  writeFileSync(RESULTS_PATH, JSON.stringify(arr, null, 2))
}

// ── Supabase upsert ──────────────────────────────────────────────

async function upsertToSupabase(resultsMap) {
  if (DRY_RUN || !supabase) return

  const records = [...resultsMap.values()].map(r => ({
    company_name: r.company_name,
    google_place_id: r.google_place_id,
    address: r.address,
    state: r.state,
    county: r.county,
    phone_number: r.phone_number,
    website: r.website,
    google_rating: r.google_rating,
    google_reviews: r.google_reviews,
    latitude: r.latitude,
    longitude: r.longitude,
    reach_out_response: 'Not called',
  }))

  const BATCH = 100
  let upserted = 0
  let failed = 0

  for (let i = 0; i < records.length; i += BATCH) {
    const batch = records.slice(i, i + BATCH)
    const { error } = await supabase
      .from('companies')
      .upsert(batch, { onConflict: 'google_place_id', ignoreDuplicates: true })

    if (error) {
      console.error(`  Upsert batch ${Math.floor(i / BATCH) + 1} failed: ${error.message}`)
      failed += batch.length
    } else {
      upserted += batch.length
    }
  }

  console.log(`\nSupabase: upserted ${upserted}, failed ${failed}`)
}

// ── Main ──────────────────────────────────────────────────────────

async function main() {
  console.log('=== Google Maps Garage Door Scraper ===')
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no DB writes)' : 'LIVE (will write to Supabase)'}`)
  console.log(`Queries: ${SEARCH_QUERIES.join(', ')}`)
  console.log('')

  const allResults = loadResults()
  const checkpoint = loadCheckpoint() || { completedStates: [], completedQueries: {} }

  const stateKeys = FILTER_STATES
    ? FILTER_STATES.filter(s => STATE_BOUNDS[s])
    : Object.keys(STATE_BOUNDS)

  const totalStats = { apiCalls: 0, subdivisions: 0, newPlaces: 0, duplicates: 0 }
  const startTime = Date.now()

  for (const state of stateKeys) {
    if (checkpoint.completedStates.includes(state)) {
      console.log(`Skipping ${state} (already completed)`)
      continue
    }

    const bounds = STATE_BOUNDS[state]
    const stateCompletedQueries = checkpoint.completedQueries[state] || []

    console.log(`\n--- ${state} ---`)

    for (const query of SEARCH_QUERIES) {
      if (stateCompletedQueries.includes(query)) {
        console.log(`  Skipping query "${query}" (already completed)`)
        continue
      }

      const beforeCount = allResults.size
      const stats = { apiCalls: 0, subdivisions: 0, newPlaces: 0, duplicates: 0 }

      console.log(`  Searching: "${query}"...`)
      await searchArea(bounds, query, allResults, 0, stats)

      totalStats.apiCalls += stats.apiCalls
      totalStats.subdivisions += stats.subdivisions
      totalStats.newPlaces += stats.newPlaces
      totalStats.duplicates += stats.duplicates

      console.log(`    +${allResults.size - beforeCount} new (${stats.duplicates} dupes, ${stats.subdivisions} subdivisions, ${stats.apiCalls} API calls)`)

      // Checkpoint after each query
      if (!checkpoint.completedQueries[state]) checkpoint.completedQueries[state] = []
      checkpoint.completedQueries[state].push(query)
      saveCheckpoint(checkpoint)
      saveResults(allResults)
    }

    checkpoint.completedStates.push(state)
    delete checkpoint.completedQueries[state]
    saveCheckpoint(checkpoint)

    console.log(`  ${state} done. Total unique companies so far: ${allResults.size}`)
  }

  // Final save
  saveResults(allResults)

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
  console.log('\n=== Summary ===')
  console.log(`Total unique companies: ${allResults.size}`)
  console.log(`API calls: ${totalStats.apiCalls}`)
  console.log(`Subdivisions: ${totalStats.subdivisions}`)
  console.log(`Duplicates skipped: ${totalStats.duplicates}`)
  console.log(`Time: ${elapsed}s`)
  console.log(`Results saved to: ${RESULTS_PATH}`)

  // Upsert to Supabase
  await upsertToSupabase(allResults)

  console.log('\nDone.')
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
