#!/usr/bin/env node
/**
 * Single migration entrypoint — runs every schema migration in order.
 *
 * Wired into `npm run build` so a deploy can never ship code that expects
 * columns the database doesn't have. That exact failure took /call down for
 * three weeks: the lead_type/exit_horizon migration lived in scripts/ but
 * was only ever run by hand against the developer's .env.local database,
 * while production (a different Neon instance, its URL a write-only Vercel
 * secret) never got it. Running here, inside Vercel's build, uses the same
 * DATABASE_URL the deployed code will use — right database by construction.
 *
 * Every script listed must be idempotent (IF NOT EXISTS column adds,
 * NULL-only backfills) — they run on every build, including previews.
 * Add new migrations to the END of the list.
 */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

// Local builds: pick up .env.local the same way the scripts themselves do.
if (!process.env.DATABASE_URL) {
  try {
    for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)="?([^"]*)"?$/)
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
    }
  } catch { /* optional */ }
}

if (!process.env.DATABASE_URL) {
  console.warn('migrate: DATABASE_URL not set — skipping migrations (build continues)')
  process.exit(0)
}

const MIGRATIONS = [
  'migrate-add-industry.mjs',
  'migrate-add-lead-type.mjs',
]

for (const script of MIGRATIONS) {
  console.log(`migrate: running ${script}`)
  const { status } = spawnSync(
    process.execPath,
    [new URL(script, import.meta.url).pathname],
    { stdio: 'inherit', env: process.env },
  )
  if (status !== 0) {
    console.error(`migrate: ${script} failed (exit ${status}) — failing the build so broken schema never deploys`)
    process.exit(status ?? 1)
  }
}
console.log('migrate: all migrations applied')
