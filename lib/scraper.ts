// Shared scraper core for the Google Maps garage door company search.
// Used by both the API route (/api/scrape) and the CLI script.

export interface LatLng {
  lat: number
  lng: number
}

export interface Bounds {
  low: LatLng
  high: LatLng
}

export interface ScrapedCompany {
  google_place_id: string | null
  company_name: string
  address: string
  state: string | null
  county: string | null
  phone_number: string | null
  website: string | null
  google_rating: number | null
  google_reviews: number | null
  latitude: number | null
  longitude: number | null
  types: string
}

export interface ScrapeProgress {
  type: 'query_start' | 'query_done' | 'subdivision' | 'done'
  query?: string
  found?: number
  newCompanies?: number
  duplicates?: number
  apiCalls?: number
  subdivisions?: number
  total?: number
  depth?: number
}

interface Stats {
  apiCalls: number
  subdivisions: number
  newPlaces: number
  duplicates: number
}

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

export const SEARCH_QUERIES = [
  'garage door service',
  'garage door repair',
  'garage door company',
  'overhead door company',
]

// ── State bounding boxes ──────────────────────────────────────────

export const STATE_BOUNDS: Record<string, Bounds> = {
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

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms))
}

async function throttle() {
  const now = Date.now()
  const elapsed = now - lastRequestTime
  if (elapsed < REQUEST_DELAY_MS) {
    await sleep(REQUEST_DELAY_MS - elapsed)
  }
  lastRequestTime = Date.now()
}

// ── Google Places Text Search ─────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */

async function textSearchRect(
  query: string,
  bounds: Bounds,
  apiKey: string,
  pageToken?: string | null,
): Promise<any> {
  await throttle()

  const body: Record<string, unknown> = {
    textQuery: query,
    locationRestriction: {
      rectangle: {
        low: { latitude: bounds.low.lat, longitude: bounds.low.lng },
        high: { latitude: bounds.high.lat, longitude: bounds.high.lng },
      },
    },
    pageSize: PAGE_SIZE,
  }

  if (pageToken) body.pageToken = pageToken

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(
        'https://places.googleapis.com/v1/places:searchText',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': apiKey,
            'X-Goog-FieldMask': FIELD_MASK,
          },
          body: JSON.stringify(body),
        },
      )

      if (res.status === 429) {
        if (attempt === MAX_RETRIES - 1) return { places: [] }
        const backoff = Math.min(2000 * 2 ** attempt, 60000)
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
      const backoff = Math.min(2000 * 2 ** attempt, 60000)
      await sleep(backoff)
    }
  }
  return { places: [] }
}

async function fetchAllPages(
  query: string,
  bounds: Bounds,
  apiKey: string,
): Promise<{ places: any[]; hitCap: boolean }> {
  const allPlaces: any[] = []
  let pageToken: string | null = null

  for (let page = 0; page < 3; page++) {
    const data = await textSearchRect(query, bounds, apiKey, pageToken)
    const places = data?.places || []
    allPlaces.push(...places)

    if (!data?.nextPageToken) break
    pageToken = data.nextPageToken
    await sleep(PAGE_DELAY_MS)
  }

  return { places: allPlaces, hitCap: allPlaces.length >= RESULT_CAP }
}

// ── Quadtree ──────────────────────────────────────────────────────

function subdivide(bounds: Bounds): Bounds[] {
  const midLat = (bounds.low.lat + bounds.high.lat) / 2
  const midLng = (bounds.low.lng + bounds.high.lng) / 2
  return [
    { low: { lat: bounds.low.lat, lng: bounds.low.lng }, high: { lat: midLat, lng: midLng } },
    { low: { lat: bounds.low.lat, lng: midLng }, high: { lat: midLat, lng: bounds.high.lng } },
    { low: { lat: midLat, lng: bounds.low.lng }, high: { lat: bounds.high.lat, lng: midLng } },
    { low: { lat: midLat, lng: midLng }, high: { lat: bounds.high.lat, lng: bounds.high.lng } },
  ]
}

function cellTooLarge(bounds: Bounds): boolean {
  return (
    bounds.high.lat - bounds.low.lat > MAX_CELL_DEGREES ||
    bounds.high.lng - bounds.low.lng > MAX_CELL_DEGREES
  )
}

async function searchArea(
  bounds: Bounds,
  query: string,
  apiKey: string,
  collected: Map<string, ScrapedCompany>,
  depth: number,
  stats: Stats,
  onProgress?: (p: ScrapeProgress) => void,
): Promise<void> {
  // Always query the API first so we can skip empty areas immediately.
  const { places, hitCap } = await fetchAllPages(query, bounds, apiKey)
  stats.apiCalls++

  // Empty area -- no companies here, stop recursing.
  if (places.length === 0) return

  // Subdivide if we hit the 60-result cap OR if the cell is still large
  // enough that the API may be silently truncating results.
  const shouldSubdivide =
    depth < MAX_DEPTH && (hitCap || cellTooLarge(bounds))

  if (shouldSubdivide) {
    stats.subdivisions++
    onProgress?.({ type: 'subdivision', depth, query })

    const quadrants = subdivide(bounds)
    for (const quad of quadrants) {
      await searchArea(quad, query, apiKey, collected, depth + 1, stats, onProgress)
    }
    return
  }

  for (const place of places) {
    const id = place.id || place.name
    if (!collected.has(id)) {
      collected.set(id, normalizePlace(place))
      stats.newPlaces++
    } else {
      stats.duplicates++
    }
  }
}

// ── Normalize ─────────────────────────────────────────────────────

function normalizePlace(place: any): ScrapedCompany {
  const addr: string = place.formattedAddress || ''
  return {
    google_place_id: place.id || null,
    company_name: place.displayName?.text || '',
    address: addr,
    state: extractState(addr),
    county: null,
    phone_number: (place.nationalPhoneNumber || '').replace(/\D/g, '') || null,
    website: place.websiteUri || null,
    google_rating: place.rating || null,
    google_reviews: place.userRatingCount || null,
    latitude: place.location?.latitude || null,
    longitude: place.location?.longitude || null,
    types: (place.types || []).join(','),
  }
}

function extractState(address: string): string | null {
  const match = address.match(/,\s*([A-Z]{2})\s+\d{5}/)
  return match ? match[1] : null
}

/* eslint-enable @typescript-eslint/no-explicit-any */

// ── Public API ────────────────────────────────────────────────────

export async function scrapeState(
  stateCode: string,
  apiKey: string,
  onProgress?: (p: ScrapeProgress) => void,
): Promise<{ results: Map<string, ScrapedCompany>; stats: Stats }> {
  const bounds = STATE_BOUNDS[stateCode]
  if (!bounds) throw new Error(`Unknown state: ${stateCode}`)

  const results = new Map<string, ScrapedCompany>()
  const totalStats: Stats = { apiCalls: 0, subdivisions: 0, newPlaces: 0, duplicates: 0 }

  for (const query of SEARCH_QUERIES) {
    onProgress?.({ type: 'query_start', query, found: results.size })

    const stats: Stats = { apiCalls: 0, subdivisions: 0, newPlaces: 0, duplicates: 0 }
    const before = results.size

    await searchArea(bounds, query, apiKey, results, 0, stats, onProgress)

    totalStats.apiCalls += stats.apiCalls
    totalStats.subdivisions += stats.subdivisions
    totalStats.newPlaces += stats.newPlaces
    totalStats.duplicates += stats.duplicates

    onProgress?.({
      type: 'query_done',
      query,
      newCompanies: results.size - before,
      duplicates: stats.duplicates,
      apiCalls: stats.apiCalls,
      subdivisions: stats.subdivisions,
      found: results.size,
    })
  }

  onProgress?.({
    type: 'done',
    total: results.size,
    apiCalls: totalStats.apiCalls,
    subdivisions: totalStats.subdivisions,
    duplicates: totalStats.duplicates,
  })

  return { results, stats: totalStats }
}
