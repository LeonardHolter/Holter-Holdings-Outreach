/**
 * Lead enrichment script for "Intro-meeting wanted" companies.
 *
 * For each lead with a google_place_id, this script:
 *   1. Fetches Google Reviews via the Places API (New) Place Details endpoint
 *   2. Uses Claude with web_search to gather public intel on the company
 *   3. Uses Claude to estimate annual revenue from reviews + web intel
 *   4. Writes enrichment data back to Supabase
 *
 * Usage:
 *   node scripts/enrich-leads.mjs
 *   node scripts/enrich-leads.mjs --limit 5
 *   node scripts/enrich-leads.mjs --dry-run
 *   node scripts/enrich-leads.mjs --force          (re-enrich already-enriched leads)
 */

import { readFileSync, writeFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'

const __dirname = dirname(fileURLToPath(import.meta.url))

// ── Config ────────────────────────────────────────────────────────

const REQUEST_DELAY_MS = 300
const MAX_RETRIES = 3
const REPORT_PATH = resolve(__dirname, 'enrichment-report.json')

const REVIEW_FIELD_MASK = [
  'reviews',
  'rating',
  'userRatingCount',
  'displayName',
].join(',')

// ── CLI args ──────────────────────────────────────────────────────

const args = process.argv.slice(2)
const DRY_RUN = args.includes('--dry-run')
const FORCE = args.includes('--force')
const limitFlag = args.find(a => a.startsWith('--limit'))
const LIMIT = limitFlag
  ? parseInt(args[args.indexOf(limitFlag) + 1] || limitFlag.split('=')[1], 10)
  : null

// ── Env ───────────────────────────────────────────────────────────

function loadEnv() {
  try {
    const envPath = resolve(__dirname, '../.env.local')
    const raw = readFileSync(envPath, 'utf-8')
    for (const line of raw.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const idx = trimmed.indexOf('=')
      if (idx === -1) continue
      const key = trimmed.slice(0, idx).trim()
      const value = trimmed.slice(idx + 1).trim()
      if (!process.env[key]) process.env[key] = value
    }
  } catch { /* rely on actual env vars */ }
}

loadEnv()

const GOOGLE_API_KEY = process.env.GOOGLE_MAPS_API_KEY
if (!GOOGLE_API_KEY) {
  console.error('Set GOOGLE_MAPS_API_KEY in env or .env.local')
  process.exit(1)
}

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY
if (!ANTHROPIC_API_KEY) {
  console.error('Set ANTHROPIC_API_KEY in env or .env.local')
  process.exit(1)
}

let supabase = null
if (!DRY_RUN) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY for DB writes (or use --dry-run)')
    process.exit(1)
  }
  supabase = createClient(url, key)
}

const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY })

// ── Rate limiter ──────────────────────────────────────────────────

let lastRequestTime = 0

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms))
}

async function throttle() {
  const now = Date.now()
  const elapsed = now - lastRequestTime
  if (elapsed < REQUEST_DELAY_MS) {
    await sleep(REQUEST_DELAY_MS - elapsed)
  }
  lastRequestTime = Date.now()
}

// ── Google Places API — Fetch Reviews ─────────────────────────────

async function fetchReviews(placeId) {
  await throttle()

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(
        `https://places.googleapis.com/v1/places/${placeId}`,
        {
          method: 'GET',
          headers: {
            'X-Goog-Api-Key': GOOGLE_API_KEY,
            'X-Goog-FieldMask': REVIEW_FIELD_MASK,
          },
        },
      )

      if (res.status === 429) {
        if (attempt === MAX_RETRIES - 1) return { reviews: [], rating: null, userRatingCount: null }
        const backoff = Math.min(2000 * 2 ** attempt, 30000)
        console.warn(`  Rate limited, backing off ${backoff}ms...`)
        await sleep(backoff)
        continue
      }

      if (!res.ok) {
        const errBody = await res.text()
        throw new Error(`HTTP ${res.status}: ${errBody}`)
      }

      const data = await res.json()
      return {
        reviews: (data.reviews || []).map(r => ({
          text: r.text?.text || '',
          rating: r.rating || null,
          author: r.authorAttribution?.displayName || 'Anonymous',
          time: r.relativePublishTimeDescription || '',
        })),
        rating: data.rating || null,
        userRatingCount: data.userRatingCount || null,
        displayName: data.displayName?.text || null,
      }
    } catch (err) {
      if (attempt === MAX_RETRIES - 1) {
        console.error(`  Failed to fetch reviews for ${placeId}: ${err.message}`)
        return { reviews: [], rating: null, userRatingCount: null }
      }
      const backoff = Math.min(2000 * 2 ** attempt, 30000)
      await sleep(backoff)
    }
  }
  return { reviews: [], rating: null, userRatingCount: null }
}

// ── Claude — Web Search ───────────────────────────────────────────

async function webSearchCompany(company) {
  const searchQuery = [
    company.company_name,
    company.state ? `${company.state}` : '',
    'garage door',
    'company info employees revenue',
  ].filter(Boolean).join(' ')

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 2048,
    tools: [{
      type: 'web_search_20250305',
      name: 'web_search',
      max_uses: 3,
    }],
    messages: [{
      role: 'user',
      content: `Research the following garage door service company and gather as much business intelligence as possible.

Company: ${company.company_name}
State: ${company.state || 'Unknown'}
Phone: ${company.phone_number || 'Unknown'}
Website: ${company.website || 'Unknown'}
Google Rating: ${company.google_rating || 'Unknown'} (${company.google_reviews || 0} reviews)

Find and report on:
- Number of employees or technicians
- Fleet size (trucks/vans)
- Service area (cities, counties, radius)
- Years in business
- Any acquisition history or private equity involvement
- Revenue if publicly available or estimable
- BBB rating or other trust signals
- Any notable awards, certifications, or affiliations

Return a concise summary of what you find. If you cannot find information on a particular point, skip it rather than speculating.`,
    }],
  })

  const textBlocks = response.content.filter(b => b.type === 'text')
  return textBlocks.map(b => b.text).join('\n\n')
}

// ── Claude — Revenue Estimation ───────────────────────────────────

async function estimateRevenue(company, reviews, webIntel) {
  const reviewsText = reviews.reviews.length > 0
    ? reviews.reviews.map((r, i) => `Review ${i + 1} (${r.rating}★ by ${r.author}, ${r.time}):\n${r.text}`).join('\n\n')
    : 'No reviews available.'

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 1500,
    messages: [{
      role: 'user',
      content: `You are an analyst estimating the annual revenue of a garage door service company based on available data.

## Company Info
- Name: ${company.company_name}
- State: ${company.state || 'Unknown'}
- Google Rating: ${reviews.rating || company.google_rating || 'Unknown'}
- Total Google Reviews: ${reviews.userRatingCount || company.google_reviews || 0}
- Website: ${company.website || 'None'}

## Google Reviews
${reviewsText}

## Web Research
${webIntel || 'No additional web intel available.'}

## Instructions

Analyze the data above to estimate this company's annual revenue. Pay close attention to:
1. **Technician names** mentioned in reviews — each unique tech name suggests at least one full-time employee. A typical garage door technician generates $150,000–$250,000 in revenue per year.
2. **Review volume** — more reviews typically correlate with higher transaction volume. A rough benchmark: 1 Google review per 20–50 completed jobs.
3. **Service area breadth** — companies covering multiple cities/counties tend to be larger.
4. **Fleet/truck mentions** in reviews or web results.
5. **Years in business** — established companies tend to have higher revenue.

Respond with ONLY a valid JSON object (no markdown, no explanation outside the JSON):
{
  "estimated_annual_revenue_low": <integer, lower bound in USD>,
  "estimated_annual_revenue_high": <integer, upper bound in USD>,
  "confidence": "<low|medium|high>",
  "technician_count_estimate": <integer or null if unknown>,
  "reasoning": "<2-3 sentence explanation>",
  "key_signals": ["<signal 1>", "<signal 2>", ...]
}`,
    }],
  })

  const text = response.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('')
    .trim()

  try {
    const cleaned = text.replace(/^```json?\s*/i, '').replace(/```\s*$/, '').trim()
    return JSON.parse(cleaned)
  } catch {
    console.error(`  Failed to parse revenue estimate JSON. Raw response:\n  ${text.slice(0, 300)}`)
    return null
  }
}

// ── Fetch leads from Supabase ─────────────────────────────────────

async function fetchLeads() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  const db = createClient(url, key)

  let query = db
    .from('companies')
    .select('*')
    .eq('reach_out_response', 'Intro-meeting wanted')
    .not('google_place_id', 'is', null)
    .order('google_reviews', { ascending: false, nullsFirst: false })

  if (!FORCE) {
    query = query.is('enriched_at', null)
  }

  if (LIMIT) {
    query = query.limit(LIMIT)
  }

  const { data, error } = await query
  if (error) throw new Error(`Failed to fetch leads: ${error.message}`)
  return data || []
}

// ── Write enrichment back to DB ───────────────────────────────────

async function patchCompany(id, enrichment) {
  if (DRY_RUN || !supabase) return
  const { error } = await supabase
    .from('companies')
    .update(enrichment)
    .eq('id', id)
  if (error) {
    console.error(`  DB update failed for ${id}: ${error.message}`)
  }
}

// ── Main ──────────────────────────────────────────────────────────

async function main() {
  console.log('=== Lead Enrichment Script ===')
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no DB writes)' : 'LIVE (will write to Supabase)'}`)
  if (LIMIT) console.log(`Limit: ${LIMIT} leads`)
  if (FORCE) console.log(`Force: re-enriching already-enriched leads`)
  console.log('')

  const leads = await fetchLeads()
  console.log(`Found ${leads.length} leads to enrich\n`)

  if (leads.length === 0) {
    console.log('Nothing to do.')
    return
  }

  const report = []
  const startTime = Date.now()
  let successCount = 0
  let failCount = 0

  for (let i = 0; i < leads.length; i++) {
    const company = leads[i]
    const progress = `[${i + 1}/${leads.length}]`

    console.log(`${progress} ${company.company_name} (${company.state || '??'}) — ${company.google_reviews || 0} reviews`)

    // Step 1: Fetch Google Reviews
    console.log('  Fetching Google Reviews...')
    const reviews = await fetchReviews(company.google_place_id)
    console.log(`  Got ${reviews.reviews.length} reviews (${reviews.rating}★, ${reviews.userRatingCount} total)`)

    // Step 2: Web search via Claude
    console.log('  Running web search...')
    let webIntel = ''
    try {
      webIntel = await webSearchCompany(company)
      console.log(`  Web intel: ${webIntel.length} chars`)
    } catch (err) {
      console.error(`  Web search failed: ${err.message}`)
    }

    // Step 3: Revenue estimation via Claude
    console.log('  Estimating revenue...')
    let estimate = null
    try {
      estimate = await estimateRevenue(company, reviews, webIntel)
    } catch (err) {
      console.error(`  Revenue estimation failed: ${err.message}`)
    }

    if (estimate) {
      const low = (estimate.estimated_annual_revenue_low / 1e6).toFixed(1)
      const high = (estimate.estimated_annual_revenue_high / 1e6).toFixed(1)
      console.log(`  Revenue: $${low}M – $${high}M (${estimate.confidence} confidence)`)
      if (estimate.technician_count_estimate) {
        console.log(`  Techs: ~${estimate.technician_count_estimate}`)
      }
      console.log(`  Reasoning: ${estimate.reasoning}`)

      // Step 4: Write to DB
      const enrichment = {
        estimated_revenue_low: estimate.estimated_annual_revenue_low,
        estimated_revenue_high: estimate.estimated_annual_revenue_high,
        revenue_confidence: estimate.confidence,
        technician_count_estimate: estimate.technician_count_estimate,
        enrichment_reasoning: estimate.reasoning,
        enrichment_signals: estimate.key_signals || [],
        enriched_at: new Date().toISOString(),
      }

      await patchCompany(company.id, enrichment)
      successCount++

      report.push({
        company_name: company.company_name,
        state: company.state,
        google_reviews: company.google_reviews,
        google_rating: company.google_rating,
        website: company.website,
        ...enrichment,
        review_excerpts: reviews.reviews.map(r => r.text.slice(0, 200)),
        web_intel_summary: webIntel.slice(0, 500),
      })
    } else {
      failCount++
      report.push({
        company_name: company.company_name,
        state: company.state,
        error: 'Revenue estimation failed',
      })
    }

    console.log('')
  }

  // Save report
  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2))

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
  console.log('=== Summary ===')
  console.log(`Enriched: ${successCount}`)
  console.log(`Failed: ${failCount}`)
  console.log(`Time: ${elapsed}s`)
  console.log(`Report: ${REPORT_PATH}`)
  console.log('')
  console.log('Done.')
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
