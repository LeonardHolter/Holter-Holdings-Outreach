#!/usr/bin/env node
/**
 * Two columns that turn the dialer from a conversion funnel into an
 * acquisition-search funnel:
 *
 *  - lead_type    'target' (a business we might buy) | 'intermediary' (an
 *                 accountant / adviser who refers deals). They are different
 *                 funnels with different base rates, and blending them makes
 *                 every conversion rate on /stats uninterpretable.
 *
 *  - exit_horizon when the owner would consider stepping back:
 *                 'now' | '<1y' | '1-3y' | '3-5y' | 'never' | 'sold'.
 *                 This is the single most valuable field in the database: in
 *                 a proprietary search the answer you are mining for is
 *                 "not right now", and the horizon says exactly when to
 *                 come back.
 *
 * Deliberately NOT adding a separate revisit_on date. next_reach_out already
 * gates both queue branches, and a second date column would leave it
 * ambiguous which one wins. exit_horizon is the durable fact; next_reach_out
 * is derived from it by nextRescheduleDate() in components/CallingSession.tsx.
 *
 * Idempotent: ADD COLUMN IF NOT EXISTS, and the backfill only touches rows
 * still on the default. Re-running is harmless.
 *
 * Usage:
 *   node scripts/migrate-add-lead-type.mjs --dry   # show what would change
 *   node scripts/migrate-add-lead-type.mjs
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

const DRY = process.argv.includes('--dry')

// Accountants and advisers are intermediaries however they were imported.
// Everything else stays a target — the safe default, since mislabelling a
// target as an intermediary would drop it out of the acquisition stats.
const INTERMEDIARY_INDUSTRY = `(industry ILIKE '%regnskap%' OR industry ILIKE '%revisor%' OR industry ILIKE '%revisjon%')`

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL not set')
  process.exit(1)
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const q = (sql, p) => pool.query(sql, p).then(r => r.rows)

// Not every database has industry yet (scripts/migrate-add-industry.mjs).
// Without it there is nothing to infer from, so the backfill is skipped and
// everything stays 'target' — the safe default.
const hasIndustry = (await q(
  `SELECT 1 FROM information_schema.columns
   WHERE table_name = 'companies' AND column_name = 'industry'`
)).length > 0

if (DRY) {
  const [{ n: total }] = await q(`SELECT COUNT(*)::int n FROM companies`)
  if (!hasIndustry) {
    console.log(`--dry: ${total} companies; no industry column, so all ${total} stay 'target' (tag accountants by hand or re-run after the industry migration)`)
  } else {
    const [{ n: inter }] = await q(`SELECT COUNT(*)::int n FROM companies WHERE ${INTERMEDIARY_INDUSTRY}`)
    console.log(`--dry: ${total} companies; would tag ${inter} as intermediary, ${total - inter} as target`)
    console.table(await q(`SELECT COALESCE(industry, 'NULL') industry, COUNT(*)::int n FROM companies GROUP BY 1 ORDER BY n DESC LIMIT 20`))
  }
} else {
  await q(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS lead_type TEXT NOT NULL DEFAULT 'target'`)
  await q(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS exit_horizon TEXT`)
  // Partial index: the queue filters on lead_type constantly, and the
  // intermediary side is the small minority.
  await q(`CREATE INDEX IF NOT EXISTS companies_lead_type_idx ON companies (lead_type)`)

  if (hasIndustry) {
    const tagged = await q(
      `UPDATE companies SET lead_type = 'intermediary'
       WHERE lead_type = 'target' AND ${INTERMEDIARY_INDUSTRY}
       RETURNING id`
    )
    console.log(`tagged ${tagged.length} companies as intermediary`)
  } else {
    console.log(`no industry column — everything stays 'target'; tag accountants by hand or re-run later`)
  }
  console.table(await q(`SELECT lead_type, COUNT(*)::int n FROM companies GROUP BY 1 ORDER BY n DESC`))
}

await pool.end()
