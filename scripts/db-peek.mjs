#!/usr/bin/env node
/**
 * Read-only sanity check for a DATABASE_URL: which database are we in, what
 * databases exist on the server, and what tables are visible? Used to verify
 * a connection string points at the CRM before running anything that writes.
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

console.log('current database:', (await q('SELECT current_database() db'))[0].db)
console.log('databases on server:', (await q('SELECT datname FROM pg_database WHERE NOT datistemplate')).map(r => r.datname))
console.log('tables in public schema:')
console.table(await q(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`))

await pool.end()
