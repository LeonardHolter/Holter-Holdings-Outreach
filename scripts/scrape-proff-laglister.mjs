#!/usr/bin/env node
/**
 * Import companies from a proff.no laglister (segmentation) URL into the
 * dialer. Unlike bransjesøk (scrape-proff.mjs), laglister pages carry the
 * filters in the query string — industry, revenue band, has-phone — and embed
 * 10 companies per page in __NEXT_DATA__ under pageProps.companies.
 *
 * The default URL is the rørleggertjenester segment: proff industry 10060,
 * revenue 5M+ (proff stores revenue in thousands, so revenueFrom=5000),
 * phone required, sorted by revenue descending.
 *
 * Companies flagged marketingProtection (reservation against marketing,
 * which covers sole proprietors under markedsføringsloven) are skipped and
 * counted, not imported.
 *
 * Usage:
 *   node scripts/scrape-proff-laglister.mjs --dry            # parse only
 *   node scripts/scrape-proff-laglister.mjs                  # import all pages
 *   node scripts/scrape-proff-laglister.mjs --start=1 --end=2
 *   node scripts/scrape-proff-laglister.mjs --url='https://www.proff.no/laglister?...'
 *
 * DATABASE_URL comes from .env.local or an ENV_FILE=/path env file.
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

const args = Object.fromEntries(
  process.argv.slice(2).map(a => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/)
    return m ? [m[1], m[2] ?? true] : [a, true]
  })
)

const DEFAULT_URL =
  'https://www.proff.no/laglister?profitFrom=-8556257&profitTo=47479000&revenueFrom=5000&revenueTo=127927000&phone=true&proffIndustryCode=10060&sort=revenueDesc'
const BASE_URL = args.url || DEFAULT_URL
const START = args.start ? parseInt(args.start, 10) : 1
const END = args.end ? parseInt(args.end, 10) : null
const DRY = !!args.dry
const DELAY_MS = args.delay ? parseInt(args.delay, 10) : 700

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'

const sleep = ms => new Promise(r => setTimeout(r, ms))

function pageUrl(page) {
  return page > 1 ? `${BASE_URL}&page=${page}` : BASE_URL
}

async function fetchPage(page, attempt = 1) {
  try {
    const res = await fetch(pageUrl(page), {
      headers: { 'User-Agent': UA, 'Accept-Language': 'nb-NO,nb;q=0.9' },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const html = await res.text()
    const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/s)
    if (!m) throw new Error('no __NEXT_DATA__ found')
    const pp = JSON.parse(m[1]).props.pageProps
    return {
      companies: pp.companies ?? [],
      hits: pp.numberOfHits,
      totalPages: pp.pagination?.numberOfAvailablePages ?? 1,
    }
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
  if (digits.length < 8) return digits
  return `+${digits}`
}

function mapCompany(c) {
  // Daglig leder is who the dialer wants on the phone; fall back to styreleder.
  const roles = c.personRoles ?? []
  const leader =
    roles.find(r => /daglig leder/i.test(r.title ?? '')) ??
    roles.find(r => /styreleder|innehaver/i.test(r.title ?? ''))
  return {
    company_name: c.displayName || c.name,
    org_nr: c.organisationNumber || null,
    phone_number: normalizePhone(c.phoneNumbers?.telephoneNumber || c.phoneNumbers?.mobilePhone),
    owners_name: leader?.name ?? null,
    revenue: c.revenue != null && c.revenue !== '' ? parseInt(String(c.revenue).replace(/\D/g, ''), 10) || null : null,
    employees: c.numberOfEmployees != null ? String(c.numberOfEmployees) : null,
    email: c.email || null,
    website: c.homePage || null,
    state: c.location?.county || c.location?.municipality || null,
    protected: !!c.marketingProtection,
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
    console.error('DATABASE_URL not set (set it, or pass ENV_FILE=/path/to/env)')
    process.exit(1)
  }
  const pool = DRY ? null : new Pool({ connectionString: process.env.DATABASE_URL })

  console.log(`laglister import  start=${START}  end=${END ?? 'last'}  dry=${DRY}  delay=${DELAY_MS}ms`)

  const first = await fetchPage(START)
  const lastPage = END ? Math.min(END, first.totalPages) : first.totalPages
  console.log(`hits=${first.hits}  totalPages=${first.totalPages}  scraping ${START}..${lastPage}`)

  let totalSeen = 0
  let totalInserted = 0
  let totalProtected = 0
  let totalNoPhone = 0

  for (let page = START; page <= lastPage; page++) {
    const { companies } = page === START ? first : await fetchPage(page)
    const mapped = companies.map(mapCompany)
    totalSeen += mapped.length

    const importable = mapped.filter(c => !c.protected)
    totalProtected += mapped.length - importable.length
    totalNoPhone += importable.filter(c => !c.phone_number).length

    if (DRY) {
      if (page === START) console.log('Sample mapped record:', JSON.stringify(importable[0], null, 2))
    } else {
      totalInserted += await upsert(pool, importable)
    }

    console.log(
      `page ${page}/${lastPage}  fetched=${mapped.length}` + (DRY ? '' : `  insertedSoFar=${totalInserted}`)
    )
    if (page < lastPage) await sleep(DELAY_MS)
  }

  console.log(
    `\nDone. seen=${totalSeen}  skippedMarketingProtection=${totalProtected}  withoutPhone=${totalNoPhone}` +
      (DRY ? '' : `  newlyInserted=${totalInserted}`)
  )
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
