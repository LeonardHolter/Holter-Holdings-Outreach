/**
 * One-time CSV migration script: Garage Door Outreach - Database.csv → Supabase
 *
 * Usage:
 *   1. Add your .env.local values or set env vars:
 *      NEXT_PUBLIC_SUPABASE_URL=...
 *      SUPABASE_SERVICE_ROLE_KEY=...
 *   2. Run: node scripts/migrate.mjs
 *
 * Requires Node 18+. Uses built-in fetch.
 */

import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createClient } from '@supabase/supabase-js'

const __dirname = dirname(fileURLToPath(import.meta.url))

// ── Load env ─────────────────────────────────────────────────
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
  } catch {
    // .env.local not found — rely on actual env vars
  }
}

loadEnv()

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SERVICE_KEY || SUPABASE_URL.includes('your_supabase')) {
  console.error('❌  Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local first.')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

// ── CSV parsing ───────────────────────────────────────────────
function parseCSVLine(line) {
  const result = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim())
      current = ''
    } else {
      current += char
    }
  }
  result.push(current.trim())
  return result
}

function parseDate(raw) {
  if (!raw || raw.trim() === '' || raw === '14') return null
  raw = raw.trim()

  // MM/DD/YY or MM/DD/YYYY
  const slashMatch = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/)
  if (slashMatch) {
    let [, m, d, y] = slashMatch
    if (y.length === 2) y = '20' + y
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
  }

  // M/D/YYYY
  const dotMatch = raw.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/)
  if (dotMatch) {
    const [, m, d, y] = dotMatch
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
  }

  return null
}

function parseNum(raw) {
  if (!raw || raw.trim() === '') return null
  const cleaned = raw.replace(/,/g, '').trim()
  const n = parseInt(cleaned, 10)
  return isNaN(n) ? null : n
}

function cleanResponse(raw) {
  if (!raw || raw.trim() === '') return null
  const trimmed = raw.trim()
  const valid = [
    'Did not pick up',
    'Did not reach the Owner',
    'Left a message to the owner',
    'Intro-meeting wanted',
    'Owner is not interested',
    'Already acquired',
    'Not a garage door service company',
    'Not called',
    'Number does not exist',
    'Call back on Monday',
  ]
  const match = valid.find(v => v.toLowerCase() === trimmed.toLowerCase())
  return match ?? trimmed
}

function cleanPhone(raw) {
  if (!raw || raw.trim() === '') return null
  return raw.replace(/\D/g, '').trim() || null
}

// ── Main ──────────────────────────────────────────────────────
const csvPath = resolve(__dirname, '../Garage Door Outreach - Database.csv')
const raw = readFileSync(csvPath, 'utf-8')
const lines = raw.split('\n')

// Skip header
const rows = []
const errors = []

for (let i = 1; i < lines.length; i++) {
  const line = lines[i]
  if (!line.trim()) continue

  const cols = parseCSVLine(line)

  // Header columns (0-indexed):
  // 0: Company Name | CEO name
  // 1: Google Reviews
  // 2: State
  // 3: Phone Number
  // 4: Reach Out Response
  // 5: Last Reach Out
  // 6: Next Reach Out
  // 7: Owners Name
  // 8: Amount of Calls
  // 9: Who called
  // 10: Email
  // 11: (empty / extra col)
  // 12: Total dialed
  // 13: Intro meeting rate (skip)
  // 14: Calls made by Leonard
  // 15: Calls made by Tommaso
  // 16: Calls made by John
  // 17: (removed — was Sunzim)
  // 18: (removed — was Daniel)
  // 19: (removed — was Ellison)

  const companyName = cols[0]?.replace(/\|.*$/, '').trim() // strip "| CEO name" suffix
  if (!companyName) {
    console.warn(`  ⚠️  Row ${i + 1} skipped: no company name`)
    continue
  }

  const ownersName = cols[7]?.trim() || null

  const row = {
    company_name: companyName,
    google_reviews: parseNum(cols[1]),
    state: cols[2]?.trim() || null,
    phone_number: cleanPhone(cols[3]),
    reach_out_response: cleanResponse(cols[4]),
    last_reach_out: parseDate(cols[5]),
    next_reach_out: parseDate(cols[6]),
    owners_name: ownersName,
    amount_of_calls: parseNum(cols[8]) ?? 0,
    who_called: cols[9]?.trim() || null,
    email: cols[10]?.trim() || null,
    notes: null,
    total_dialed: parseNum(cols[12]) ?? 0,
    calls_leonard: parseNum(cols[14]) ?? 0,
    calls_tommaso: parseNum(cols[15]) ?? 0,
    calls_john: parseNum(cols[16]) ?? 0,
  }

  rows.push(row)
}

console.log(`\n📋  Parsed ${rows.length} rows from CSV\n`)

// Insert in batches of 100
const BATCH = 100
let inserted = 0
let failed = 0

for (let i = 0; i < rows.length; i += BATCH) {
  const batch = rows.slice(i, i + BATCH)
  const { data, error } = await supabase.from('companies').insert(batch)

  if (error) {
    console.error(`  ❌  Batch ${Math.floor(i / BATCH) + 1} failed:`, error.message)
    failed += batch.length
    errors.push({ batch: Math.floor(i / BATCH) + 1, error: error.message })
  } else {
    inserted += batch.length
    console.log(`  ✅  Batch ${Math.floor(i / BATCH) + 1}: inserted ${batch.length} rows (total: ${inserted})`)
  }
}

console.log(`\n✅  Migration complete`)
console.log(`   Inserted: ${inserted}`)
console.log(`   Failed:   ${failed}`)

if (errors.length > 0) {
  console.log('\n❌  Errors:')
  errors.forEach(e => console.log(`   Batch ${e.batch}: ${e.error}`))
}
