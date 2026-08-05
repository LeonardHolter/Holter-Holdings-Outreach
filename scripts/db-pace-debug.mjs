#!/usr/bin/env node
/**
 * Read-only: per-caller daily call counts for the last 4 days, from BOTH
 * sources — companies.last_reach_out/who_called (what the pace API uses) and
 * call_events bucketed by Oslo day (the true log). Diagnoses banner-target
 * complaints: the two disagree when re-dials move last_reach_out, when
 * who_called gets reassigned, or when UTC day boundaries drift from Oslo's.
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

console.log('server time:', (await q(`SELECT NOW()::text now, CURRENT_DATE::text utc_today, (NOW() AT TIME ZONE 'Europe/Oslo')::date::text oslo_today`))[0])

console.log('\ncompanies-based (what /api/pace uses): last_reach_out × who_called')
console.table(await q(`
  SELECT last_reach_out::text AS d, who_called, COUNT(*)::int n
  FROM companies
  WHERE last_reach_out >= CURRENT_DATE - 3
  GROUP BY 1, 2 ORDER BY 1 DESC, 2`))

console.log('call_events by OSLO day × caller (the true per-call log):')
console.table(await q(`
  SELECT (created_at AT TIME ZONE 'Europe/Oslo')::date::text AS d, caller_name, COUNT(*)::int n
  FROM call_events
  WHERE created_at >= NOW() - INTERVAL '4 days'
  GROUP BY 1, 2 ORDER BY 1 DESC, 2`))

console.log('call_events by UTC day × caller (for comparison):')
console.table(await q(`
  SELECT created_at::date::text AS d, caller_name, COUNT(*)::int n
  FROM call_events
  WHERE created_at >= NOW() - INTERVAL '4 days'
  GROUP BY 1, 2 ORDER BY 1 DESC, 2`))

await pool.end()
