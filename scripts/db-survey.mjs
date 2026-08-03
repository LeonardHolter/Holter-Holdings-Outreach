#!/usr/bin/env node
/**
 * Read-only survey of the companies table ahead of the plumber import and the
 * under-5M bilverksted cleanup: how many rows fall under 5M revenue, and how
 * many of those carry call history that a delete would destroy.
 *
 * Usage: node scripts/db-survey.mjs
 */

import { readFileSync } from 'node:fs'
import { Pool } from '@neondatabase/serverless'

// DATABASE_URL lives in Vercel, not .env.local — accept both, plus a pulled
// env file passed via ENV_FILE.
for (const f of ['../.env.local', process.env.ENV_FILE].filter(Boolean)) {
  try {
    const env = readFileSync(f.startsWith('/') ? f : new URL(f, import.meta.url), 'utf8')
    for (const line of env.split('\n')) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)="?([^"]*)"?$/)
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
    }
  } catch { /* optional */ }
}

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL not set (set it, or pass ENV_FILE=/path/to/env)')
  process.exit(1)
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const q = (sql, p) => pool.query(sql, p).then(r => r.rows)

const total = await q('SELECT COUNT(*)::int n FROM companies')
console.log('total companies:', total[0].n)

console.log('\nby response:')
console.table(await q(`SELECT COALESCE(reach_out_response,'NULL') response, COUNT(*)::int n
                       FROM companies GROUP BY 1 ORDER BY n DESC`))

console.log('revenue bands (thousands NOK):')
console.table(await q(`SELECT CASE
    WHEN revenue IS NULL THEN 'unknown'
    WHEN revenue < 5000 THEN 'under 5M'
    ELSE '5M+' END band, COUNT(*)::int n
  FROM companies GROUP BY 1 ORDER BY n DESC`))

console.log('under-5M rows by response:')
console.table(await q(`SELECT COALESCE(reach_out_response,'NULL') response, COUNT(*)::int n
                       FROM companies WHERE revenue < 5000 GROUP BY 1 ORDER BY n DESC`))

const withEvents = await q(`SELECT COUNT(DISTINCT c.id)::int n FROM companies c
                            JOIN call_events e ON e.company_id = c.id WHERE c.revenue < 5000`)
console.log('under-5M with call_events:', withEvents[0].n)

console.log('under-5M with a demo or decided outcome:')
console.table(await q(`SELECT reach_out_response response, demo_outcome, COUNT(*)::int n
  FROM companies WHERE revenue < 5000
    AND (reach_out_response = 'Demo booked' OR demo_outcome IS NOT NULL)
  GROUP BY 1,2`))

const clean = await q(`SELECT COUNT(*)::int n FROM companies c
  WHERE c.revenue < 5000
    AND COALESCE(c.amount_of_calls, 0) = 0
    AND (c.reach_out_response = 'Not called' OR c.reach_out_response IS NULL)
    AND NOT EXISTS (SELECT 1 FROM call_events e WHERE e.company_id = c.id)`)
console.log('under-5M never touched (deletable without losing history):', clean[0].n)

await pool.end()
