#!/usr/bin/env node
/**
 * Read-only: did the Bygningshåndverkere import collide with existing rows
 * because the old "all Bilmekanikere" backfill assumption was wrong? Samples
 * the Bilmekanikere cohort for building-trade names and counts the overlap.
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
const q = (sql, p) => pool.query(sql, p).then(r => r.rows)

console.log('industry counts now:')
console.table(await q(`SELECT COALESCE(industry,'NULL') industry, COUNT(*)::int n FROM companies GROUP BY 1 ORDER BY n DESC`))

const [byggish] = await q(`
  SELECT COUNT(*)::int n FROM companies
  WHERE industry = 'Bilmekanikere'
    AND (company_name ILIKE '%bygg%' OR company_name ILIKE '%tømrer%' OR company_name ILIKE '%murer%'
      OR company_name ILIKE '%maler%' OR company_name ILIKE '%entreprenør%' OR company_name ILIKE '%snekker%'
      OR company_name ILIKE '%håndverk%')`)
const [bilish] = await q(`
  SELECT COUNT(*)::int n FROM companies
  WHERE industry = 'Bilmekanikere'
    AND (company_name ILIKE '%bil%' OR company_name ILIKE '%auto%' OR company_name ILIKE '%dekk%'
      OR company_name ILIKE '%verksted%' OR company_name ILIKE '%motor%')`)
console.log(`'Bilmekanikere' rows with building-trade names: ${byggish.n}`)
console.log(`'Bilmekanikere' rows with car-trade names:      ${bilish.n}`)

console.log('\nrandom sample of Bilmekanikere names:')
console.table(await q(`SELECT company_name, revenue, reach_out_response FROM companies WHERE industry = 'Bilmekanikere' ORDER BY random() LIMIT 12`))

await pool.end()
