/**
 * Inserts rows that are genuinely missing from Supabase
 * (i.e. not just name-variation differences already covered by the TSV migration)
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

// These are the rows that are genuinely absent from the DB
// (verified by checking that no similar name exists in Supabase)
const missing = [
  { company_name: 'Electric Garage Door Sales',                    state: 'PA', phone_number: '7247743200',  reach_out_response: 'Not called', google_reviews: 21 },
  { company_name: 'Walnutportdoor',                                state: 'PA', phone_number: '6107674268',  reach_out_response: 'Not called', google_reviews: 16 },
  { company_name: 'Window & Door Sales',                           state: 'PA', phone_number: '5707252559',  reach_out_response: 'Not called', google_reviews: 3  },
  { company_name: "Today's Garage Door Repair",                    state: 'MN', phone_number: '16122384433', reach_out_response: 'Not called', google_reviews: 303 },
  { company_name: 'DC Garage Doors LLC',                           state: 'MN', phone_number: '12184858575', reach_out_response: 'Not called', google_reviews: 5  },
  { company_name: 'Gopher',                                        state: 'MN', phone_number: '15077443479', reach_out_response: 'Not called', google_reviews: 40 },
  { company_name: '14 McFadden Rd, Palmer Township, PA 18045',     state: 'PA', phone_number: '18003211130', reach_out_response: 'Not called', google_reviews: 11 },
  // Name normalizations — keep exact CSV names as duplicates with same data
  { company_name: 'M R Garage Doors & Operators LLC (751877)',     state: 'PA', phone_number: '15709891232', reach_out_response: 'Not called', google_reviews: 36 },
  { company_name: 'Cumberland Garage Doors (124270)',              state: 'PA', phone_number: '17175308080', reach_out_response: 'Not called', google_reviews: 15 },
  { company_name: 'Expi-Door Systems Inc.',                        state: 'WI', phone_number: '19203934028', reach_out_response: 'Not called', google_reviews: 4  },
]

// Check which ones are ACTUALLY absent (by phone number as fallback)
let all = []
let from = 0
while (true) {
  const { data } = await supabase.from('companies').select('company_name, phone_number').range(from, from + 999)
  if (!data || data.length === 0) break
  all = all.concat(data)
  if (data.length < 1000) break
  from += 1000
}

const dbByPhone = new Set(all.map(r => r.phone_number).filter(Boolean))
const dbByName  = new Set(all.map(r => r.company_name.trim().toLowerCase()))

const toInsert = missing.filter(r => {
  const nameExists = dbByName.has(r.company_name.trim().toLowerCase())
  const phoneExists = r.phone_number && dbByPhone.has(r.phone_number)
  return !nameExists && !phoneExists
})

console.log(`\nChecking ${missing.length} candidates...`)
console.log(`Will insert: ${toInsert.length} rows`)

if (toInsert.length === 0) {
  console.log('✅  Nothing to add — all already present.\n')
  process.exit(0)
}

toInsert.forEach(r => console.log(`  + ${r.company_name}`))

const { error } = await supabase.from('companies').insert(toInsert)
if (error) {
  console.error('❌  Insert failed:', error.message)
} else {
  console.log('\n✅  Inserted successfully.\n')
}
