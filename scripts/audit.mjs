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

// ── Parse original CSV ────────────────────────────────────────
function parseCSVLine(line) {
  const result = []
  let current = '', inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++ }
      else inQuotes = !inQuotes
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim()); current = ''
    } else current += char
  }
  result.push(current.trim())
  return result
}

const csvLines = readFileSync(resolve(__dirname, '../Garage Door Outreach - Database.csv'), 'utf-8').split('\n')
const csvRows = []
for (let i = 1; i < csvLines.length; i++) {
  const cols = parseCSVLine(csvLines[i])
  const name = cols[0]?.replace(/\|.*$/, '').trim()
  if (name) csvRows.push({ name, row: i + 1, phone: cols[3]?.trim(), state: cols[2]?.trim() })
}

console.log(`\n📄  CSV: ${csvRows.length} non-blank rows`)

// ── Fetch all from Supabase ───────────────────────────────────
let all = []
let from = 0
while (true) {
  const { data, error } = await supabase
    .from('companies')
    .select('company_name, phone_number, state')
    .range(from, from + 999)
  if (error || !data || data.length === 0) break
  all = all.concat(data)
  if (data.length < 1000) break
  from += 1000
}

console.log(`🗄   Supabase: ${all.length} rows`)

// ── Compare by name (case-insensitive) ───────────────────────
const dbNames = new Set(all.map(r => r.company_name.trim().toLowerCase()))

const missing = csvRows.filter(r => !dbNames.has(r.name.toLowerCase()))

if (missing.length === 0) {
  console.log('\n✅  No data lost — every company from the CSV exists in Supabase.\n')
} else {
  console.log(`\n⚠️  ${missing.length} companies from the CSV are missing from Supabase:\n`)
  missing.forEach(r => console.log(`  Row ${r.row}: "${r.name}" (${r.state}, ${r.phone})`))
  console.log()
}

// ── Summary ───────────────────────────────────────────────────
const csvUnique = new Set(csvRows.map(r => r.name.toLowerCase()))
console.log(`📊  Summary`)
console.log(`   CSV total rows:       ${csvRows.length}`)
console.log(`   CSV unique names:     ${csvUnique.size}`)
console.log(`   Supabase rows:        ${all.length}`)
console.log(`   Missing from DB:      ${missing.length}`)
