#!/usr/bin/env node
/**
 * Add companies.industry and backfill the two cohorts we know:
 *
 *  - 'Rørleggere'   — the proff laglister import of 2026-08-04 (created that
 *                    day; the old stock all predates it)
 *  - 'Bilmekanikere' — everything older; the original database was scraped
 *                    from proff's billverksted search
 *
 * Idempotent: the column add is IF NOT EXISTS and the backfills only touch
 * rows where industry IS NULL, so re-running is harmless. New imports set
 * industry themselves (scrape-proff-laglister.mjs --industry=...).
 *
 * Usage:
 *   node scripts/migrate-add-industry.mjs --dry   # show what would change
 *   node scripts/migrate-add-industry.mjs
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
const IMPORT_DAY = '2026-08-04'

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL not set')
  process.exit(1)
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const q = (sql, p) => pool.query(sql, p).then(r => r.rows)

if (DRY) {
  const [ror] = await q(
    `SELECT COUNT(*)::int n FROM companies WHERE created_at::date = $1`, [IMPORT_DAY]
  )
  const [bil] = await q(
    `SELECT COUNT(*)::int n FROM companies WHERE created_at::date < $1`, [IMPORT_DAY]
  )
  console.log(`--dry: would tag ${ror.n} as Rørleggere, ${bil.n} as Bilmekanikere`)
} else {
  await q(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS industry TEXT`)
  const ror = await q(
    `UPDATE companies SET industry = 'Rørleggere'
     WHERE industry IS NULL AND created_at::date = $1 RETURNING id`, [IMPORT_DAY]
  )
  const bil = await q(
    `UPDATE companies SET industry = 'Bilmekanikere'
     WHERE industry IS NULL AND created_at::date < $1 RETURNING id`, [IMPORT_DAY]
  )
  console.log(`tagged ${ror.length} Rørleggere, ${bil.length} Bilmekanikere`)
  console.table(await q(`SELECT COALESCE(industry,'NULL') industry, COUNT(*)::int n FROM companies GROUP BY 1 ORDER BY n DESC`))
}

await pool.end()
