#!/usr/bin/env node
/**
 * Scrape company data from proff.no and populate the Neon database.
 *
 * Each search page embeds a __NEXT_DATA__ JSON blob with 25 companies and the
 * total page count, so no HTML parsing is needed.
 *
 * Usage:
 *   node scripts/scrape-proff.mjs                 # scrape all pages
 *   node scripts/scrape-proff.mjs --start=1 --end=2   # scrape a page range (testing)
 *   node scripts/scrape-proff.mjs --query=billverksted
 *   node scripts/scrape-proff.mjs --dry           # parse only, no DB writes
 */

import { readFileSync } from 'node:fs'
import { Pool } from '@neondatabase/serverless'

// ---- load env from .env.local ----
try {
  const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
  for (const line of env.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
  }
} catch {
  /* env may already be set in the environment */
}

// ---- args ----
const args = Object.fromEntries(
  process.argv.slice(2).map(a => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/)
    return m ? [m[1], m[2] ?? true] : [a, true]
  })
)
const QUERY = args.query || 'billverksted'
const START = args.start ? parseInt(args.start, 10) : 1
const END = args.end ? parseInt(args.end, 10) : null // null = until last page
const DRY = !!args.dry
const DELAY_MS = args.delay ? parseInt(args.delay, 10) : 700

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'

const sleep = ms => new Promise(r => setTimeout(r, ms))

function pageUrl(page) {
  const q = encodeURIComponent(QUERY)
  return `https://www.proff.no/bransjes%C3%B8k?q=${q}${page > 1 ? `&page=${page}` : ''}`
}

async function fetchPage(page, attempt = 1) {
  const url = pageUrl(page)
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'nb-NO,nb;q=0.9' } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const html = await res.text()
    const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/s)
    if (!m) throw new Error('no __NEXT_DATA__ found')
    const data = JSON.parse(m[1])
    return data.props.pageProps.hydrationData.searchStore.companies
  } catch (err) {
    if (attempt < 4) {
      const backoff = 1500 * attempt
      console.warn(`  page ${page} failed (${err.message}) — retry ${attempt} in ${backoff}ms`)
      await sleep(backoff)
      return fetchPage(page, attempt + 1)
    }
    throw err
  }
}

// Norwegian phone normalization: strip non-digits, prepend +47 to 8-digit numbers.
function normalizePhone(raw) {
  if (!raw) return null
  const digits = String(raw).replace(/\D/g, '')
  if (!digits) return null
  if (digits.length === 8) return `+47${digits}`
  if (digits.length === 10 && digits.startsWith('47')) return `+${digits}`
  if (digits.length < 8) return digits // short / service numbers — leave as-is
  return `+${digits}`
}

function mapCompany(c) {
  const contact = c.contactPerson
  const ownerParts = []
  if (contact?.name) ownerParts.push(contact.name)
  return {
    company_name: c.legalName || c.name,
    org_nr: c.orgnr || null,
    phone_number: normalizePhone(c.phone || c.mobile || c.phone2 || c.mobile2),
    owners_name: ownerParts.length ? ownerParts.join(' ') : null,
    revenue: c.revenue != null && c.revenue !== '' ? parseInt(String(c.revenue).replace(/\D/g, ''), 10) || null : null,
    employees: c.employees || null,
    email: c.email || null,
    website: c.homePage || null,
    state: c.location?.county || c.location?.municipality || null,
  }
}

async function upsert(pool, companies) {
  let inserted = 0
  for (const c of companies) {
    if (!c.org_nr || !c.company_name) continue
    const res = await pool.query(
      `INSERT INTO companies (company_name, org_nr, phone_number, owners_name, revenue, employees, email, website, state, reach_out_response)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'Not called')
       ON CONFLICT (org_nr) WHERE org_nr IS NOT NULL DO NOTHING
       RETURNING id`,
      [c.company_name, c.org_nr, c.phone_number, c.owners_name, c.revenue, c.employees, c.email, c.website, c.state]
    )
    if (res.rowCount > 0) inserted++
  }
  return inserted
}

async function main() {
  if (!DRY && !process.env.DATABASE_URL) {
    console.error('DATABASE_URL not set')
    process.exit(1)
  }
  const pool = DRY ? null : new Pool({ connectionString: process.env.DATABASE_URL })

  console.log(`Query: "${QUERY}"  start=${START}  end=${END ?? 'last'}  dry=${DRY}  delay=${DELAY_MS}ms`)

  // First page tells us the total page count.
  const first = await fetchPage(START)
  const totalPages = first.pages
  const lastPage = END ? Math.min(END, totalPages) : totalPages
  console.log(`hits=${first.hits}  totalPages=${totalPages}  scraping ${START}..${lastPage}`)

  let totalInserted = 0
  let totalSeen = 0

  for (let page = START; page <= lastPage; page++) {
    const store = page === START ? first : await fetchPage(page)
    const mapped = store.companies.map(mapCompany)
    totalSeen += mapped.length

    if (DRY) {
      if (page === START) console.log('Sample mapped record:', JSON.stringify(mapped[0], null, 2))
    } else {
      const ins = await upsert(pool, mapped)
      totalInserted += ins
    }

    const withOrg = mapped.filter(m => m.org_nr).length
    console.log(
      `page ${page}/${lastPage}  fetched=${mapped.length}  withOrgNr=${withOrg}` +
        (DRY ? '' : `  inserted=${totalInserted}`)
    )

    if (page < lastPage) await sleep(DELAY_MS)
  }

  console.log(`\nDone. seen=${totalSeen}${DRY ? '' : `  newlyInserted=${totalInserted}`}`)
  if (pool) {
    const { rows } = await pool.query('SELECT COUNT(*) FROM companies')
    console.log(`Total companies in DB: ${rows[0].count}`)
    await pool.end()
  }
}

main().catch(err => {
  console.error('FATAL:', err)
  process.exit(1)
})
