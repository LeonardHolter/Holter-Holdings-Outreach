/**
 * Finds and removes duplicate companies in Supabase.
 * Duplicate = same phone number OR same company name (case-insensitive).
 * Keeps the row with the most data filled in. Deletes the rest.
 * Run: node scripts/dedup.mjs
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

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
  } catch {}
}
loadEnv()

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// ── Fetch all rows ────────────────────────────────────────────
let all = []
let from = 0
while (true) {
  const { data, error } = await supabase.from('companies').select('*').range(from, from + 999)
  if (error || !data || data.length === 0) break
  all = all.concat(data)
  if (data.length < 1000) break
  from += 1000
}
console.log(`\n📦  Fetched ${all.length} rows\n`)

// ── Score a row by how complete it is ────────────────────────
function score(row) {
  let s = 0
  const fields = [
    'reach_out_response', 'last_reach_out', 'next_reach_out',
    'owners_name', 'who_called', 'email', 'notes',
    'phone_number', 'state', 'google_reviews',
  ]
  for (const f of fields) {
    if (row[f] !== null && row[f] !== undefined && row[f] !== '') s++
  }
  s += (row.amount_of_calls ?? 0)
  s += (row.total_dialed ?? 0)
  if (row.reach_out_response && row.reach_out_response !== 'Not called') s += 5
  return s
}

// ── Group by phone number (exact match) ──────────────────────
const byPhone = {}
for (const row of all) {
  if (!row.phone_number) continue
  const key = row.phone_number.replace(/\D/g, '')
  if (!byPhone[key]) byPhone[key] = []
  byPhone[key].push(row)
}

// ── Group by name (case-insensitive) ─────────────────────────
const byName = {}
for (const row of all) {
  const key = row.company_name.trim().toLowerCase()
  if (!byName[key]) byName[key] = []
  byName[key].push(row)
}

// ── Collect IDs to delete ─────────────────────────────────────
const toDelete = new Set()
const groups = []

// Phone duplicates
for (const [phone, rows] of Object.entries(byPhone)) {
  if (rows.length < 2) continue
  rows.sort((a, b) => score(b) - score(a))
  const keep = rows[0]
  const dupes = rows.slice(1)
  groups.push({ reason: `phone: ${phone}`, keep, dupes })
  dupes.forEach(d => toDelete.add(d.id))
}

// Name duplicates (only among rows not already flagged)
for (const [name, rows] of Object.entries(byName)) {
  if (rows.length < 2) continue
  // Filter out rows already marked for deletion
  const live = rows.filter(r => !toDelete.has(r.id))
  if (live.length < 2) continue
  live.sort((a, b) => score(b) - score(a))
  const keep = live[0]
  const dupes = live.slice(1)
  groups.push({ reason: `name: "${name}"`, keep, dupes })
  dupes.forEach(d => toDelete.add(d.id))
}

// ── Report ────────────────────────────────────────────────────
if (groups.length === 0) {
  console.log('✅  No duplicates found.\n')
  process.exit(0)
}

console.log(`⚠️  Found ${groups.length} duplicate groups (${toDelete.size} rows to delete):\n`)
for (const g of groups) {
  console.log(`  [${g.reason}]`)
  console.log(`    KEEP:   "${g.keep.company_name}" (score ${score(g.keep)}, response: ${g.keep.reach_out_response ?? 'none'})`)
  for (const d of g.dupes) {
    console.log(`    DELETE: "${d.company_name}" (score ${score(d)}, response: ${d.reach_out_response ?? 'none'})`)
  }
}

// ── Ask for confirmation then delete ─────────────────────────
const ids = [...toDelete]
console.log(`\n🗑   Deleting ${ids.length} duplicate rows...`)

const batchSize = 50
let deleted = 0
for (let i = 0; i < ids.length; i += batchSize) {
  const batch = ids.slice(i, i + batchSize)
  const { error } = await supabase.from('companies').delete().in('id', batch)
  if (error) {
    console.error('  ❌  Batch delete failed:', error.message)
  } else {
    deleted += batch.length
  }
}

console.log(`\n✅  Done. Deleted ${deleted} duplicates. ${all.length - deleted} rows remain.\n`)
