/**
 * Full re-migration from data-full.tsv
 * Clears existing companies table and re-imports everything.
 * Run: node scripts/migrate-full.mjs
 */

import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createClient } from '@supabase/supabase-js'

const __dirname = dirname(fileURLToPath(import.meta.url))

function loadEnv() {
  try {
    const raw = readFileSync(resolve(__dirname, '../.env.local'), 'utf-8')
    for (const line of raw.split('\n')) {
      const t = line.trim()
      if (!t || t.startsWith('#')) continue
      const idx = t.indexOf('=')
      if (idx === -1) continue
      const key = t.slice(0, idx).trim()
      const val = t.slice(idx + 1).trim()
      if (!process.env[key]) process.env[key] = val
    }
  } catch { /* env vars set externally */ }
}

loadEnv()

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SERVICE_KEY || SUPABASE_URL.includes('your_supabase')) {
  console.error('❌  Set env vars in .env.local first.')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

function parseDate(raw) {
  if (!raw || !raw.trim()) return null
  raw = raw.trim()
  const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/)
  if (m) {
    let [, mo, d, y] = m
    if (y.length === 2) y = '20' + y
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`
  }
  return null
}

function parseNum(raw) {
  if (!raw || !raw.trim()) return null
  const n = parseInt(raw.replace(/,/g, '').trim(), 10)
  return isNaN(n) ? null : n
}

function cleanPhone(raw) {
  if (!raw || !raw.trim()) return null
  const digits = raw.replace(/\D/g, '')
  return digits || null
}

function isEmail(s) {
  return s && s.includes('@')
}

// ── Step 1: Clear existing data ───────────────────────────────
console.log('\n🗑   Clearing existing companies...')
const { error: delErr } = await supabase
  .from('companies')
  .delete()
  .neq('id', '00000000-0000-0000-0000-000000000000') // delete all rows

if (delErr) {
  console.error('❌  Failed to clear:', delErr.message)
  process.exit(1)
}
console.log('✅  Cleared.\n')

// ── Step 2: Parse TSV ─────────────────────────────────────────
const tsvPath = resolve(__dirname, '../data-full.tsv')
const lines = readFileSync(tsvPath, 'utf-8').split('\n')

// Skip header row
const rows = []

for (let i = 1; i < lines.length; i++) {
  const line = lines[i]
  if (!line.trim()) continue

  const cols = line.split('\t').map(c => c.trim())
  const companyName = cols[0]
  if (!companyName) continue

  // Col indices (0-based):
  // 0: company_name
  // 1: google_reviews
  // 2: state
  // 3: phone_number
  // 4: reach_out_response
  // 5: last_reach_out
  // 6: next_reach_out
  // 7: owners_name
  // 8: amount_of_calls
  // 9: who_called
  // 10: email
  // 11: notes
  // 12: total_dialed
  // 13: calls_leonard
  // 14: calls_tommaso
  // 15: calls_john
  // 16: (removed — was calls_sunzim)
  // 17: (removed — was calls_daniel)
  // 18: (removed — was calls_ellison)

  const emailRaw = cols[10] || ''
  const notesRaw = cols[11] || ''

  let email = null
  let notes = notesRaw || null

  if (isEmail(emailRaw)) {
    // Extract just the email part (before any space)
    email = emailRaw.split(' ')[0].trim()
    // Any extra text after the email goes to notes
    const extra = emailRaw.slice(email.length).trim()
    if (extra && !notes) notes = extra
    else if (extra) notes = `${extra} | ${notes}`
  } else if (emailRaw) {
    // Not an email — treat as notes
    notes = notes ? `${emailRaw} | ${notes}` : emailRaw
  }

  const response = cols[4] || null
  // Normalize common typos
  const responseMap = {
    'intro-meetig wanted': 'Intro-meeting wanted',
    'already aquired': 'Already acquired',
    'number does that exist': 'Number does not exist',
    'number does not work': 'Number does not exist',
  }
  const normalizedResponse = response
    ? (responseMap[response.toLowerCase()] ?? response.trim())
    : null

  rows.push({
    company_name: companyName,
    google_reviews: parseNum(cols[1]),
    state: cols[2] || null,
    phone_number: cleanPhone(cols[3]),
    reach_out_response: normalizedResponse,
    last_reach_out: parseDate(cols[5]),
    next_reach_out: parseDate(cols[6]),
    owners_name: cols[7] || null,
    amount_of_calls: parseNum(cols[8]) ?? 0,
    who_called: cols[9] || null,
    email,
    notes,
    total_dialed: parseNum(cols[12]) ?? 0,
    calls_leonard: parseNum(cols[13]) ?? 0,
    calls_tommaso: parseNum(cols[14]) ?? 0,
    calls_john: parseNum(cols[15]) ?? 0,
  })
}

console.log(`📋  Parsed ${rows.length} rows\n`)

// ── Step 3: Insert in batches ─────────────────────────────────
const BATCH = 100
let inserted = 0
let failed = 0

for (let i = 0; i < rows.length; i += BATCH) {
  const batch = rows.slice(i, i + BATCH)
  const { error } = await supabase.from('companies').insert(batch)
  if (error) {
    console.error(`  ❌  Batch ${Math.floor(i / BATCH) + 1} failed:`, error.message)
    failed += batch.length
  } else {
    inserted += batch.length
    console.log(`  ✅  Batch ${Math.floor(i / BATCH) + 1}: ${batch.length} rows (total: ${inserted})`)
  }
}

console.log(`\n✅  Migration complete — Inserted: ${inserted}, Failed: ${failed}\n`)
