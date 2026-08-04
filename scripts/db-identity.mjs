#!/usr/bin/env node
/**
 * Read-only identity check: does this DATABASE_URL hold the outreach CRM's
 * data? The live app shows ~657 Leonard / ~325 William calls and 7 demos —
 * if these numbers don't match, we're pointed at a sibling app's database.
 */
import { readFileSync } from 'node:fs'
import { Pool } from '@neondatabase/serverless'

for (const f of ['../.env.local', process.env.ENV_FILE].filter(Boolean)) {
  try {
    const env = readFileSync(f.startsWith('/') ? f : new URL(f, import.meta.url), 'utf8')
    for (const line of env.split('\n')) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)="?([^"]*)"?$/)
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
    }
  } catch { /* optional */ }
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const q = sql => pool.query(sql).then(r => r.rows)

const [sums] = await q(`SELECT COALESCE(SUM(calls_leonard),0)::int leonard,
                               COALESCE(SUM(calls_william),0)::int william FROM companies`)
console.log('calls_leonard total:', sums.leonard, ' calls_william total:', sums.william)

const demos = await q(`SELECT COALESCE(demo_outcome,'pending') o, COUNT(*)::int n
                       FROM companies WHERE reach_out_response = 'Demo booked' GROUP BY 1`)
console.log('demo booked rows:', JSON.stringify(demos))

const [events] = await q('SELECT COUNT(*)::int n FROM call_events')
console.log('call_events rows:', events.n)

const sample = await q(`SELECT company_name FROM companies WHERE reach_out_response != 'Not called' ORDER BY updated_at DESC NULLS LAST LIMIT 5`)
console.log('recently worked companies:', sample.map(r => r.company_name))

await pool.end()
