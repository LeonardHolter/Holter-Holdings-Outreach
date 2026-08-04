#!/usr/bin/env node
/**
 * Read-only: what does the 'Not called' dialer queue look like right now, in
 * the exact priority order /call serves it? Splits each tier into old stock
 * (bilverksted) vs today's rørlegger import (created_at today), so the team
 * knows what mix to expect when dialling.
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

const [total] = await q('SELECT COUNT(*)::int n FROM companies')
console.log('total companies:', total.n, total.n < 7000 ? '(under-5M cleanup has run)' : '(under-5M cleanup NOT run yet)')

console.log('\nNot-called queue by priority tier (dialer serves tier 1 first, revenue DESC within tier):')
console.table(await q(`
  SELECT
    CASE
      WHEN revenue IS NOT NULL AND revenue >= 10000 AND revenue <= 20000 THEN '1: 10-20M'
      WHEN revenue IS NOT NULL AND revenue < 10000 THEN '2: under 10M'
      WHEN revenue IS NOT NULL AND revenue <= 25000 THEN '3: 20-25M'
      WHEN revenue IS NULL THEN '4: unknown revenue'
      ELSE '5: over 25M'
    END tier,
    COUNT(*) FILTER (WHERE created_at::date < CURRENT_DATE)::int bilverksted,
    COUNT(*) FILTER (WHERE created_at::date = CURRENT_DATE)::int rorlegger_new,
    COUNT(*)::int total
  FROM companies
  WHERE (reach_out_response = 'Not called' OR reach_out_response IS NULL)
    AND (next_reach_out IS NULL OR next_reach_out <= CURRENT_DATE)
  GROUP BY 1 ORDER BY 1`))

const [queue] = await q(`
  SELECT COUNT(*)::int n FROM companies
  WHERE (reach_out_response = 'Not called' OR reach_out_response IS NULL)
    AND (next_reach_out IS NULL OR next_reach_out <= CURRENT_DATE)`)
console.log('not-called queue size:', queue.n)

const [followups] = await q(`
  SELECT COUNT(*)::int n FROM companies
  WHERE reach_out_response IS NOT NULL AND reach_out_response != 'Not called'
    AND reach_out_response NOT IN ('Not interested', 'Demo booked', 'Wrong number', 'Not needed')
    AND (next_reach_out <= CURRENT_DATE OR next_reach_out IS NULL)`)
console.log('follow-up queue (served after not-called):', followups.n)

await pool.end()
