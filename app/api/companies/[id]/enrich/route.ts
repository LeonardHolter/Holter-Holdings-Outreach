import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@/lib/supabase/server'

export const maxDuration = 120

const REVIEW_FIELD_MASK = 'reviews,rating,userRatingCount,displayName'

// ── Google Places — fetch reviews ────────────────────────────────

async function fetchReviews(placeId: string, apiKey: string) {
  const res = await fetch(
    `https://places.googleapis.com/v1/places/${placeId}`,
    {
      headers: {
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': REVIEW_FIELD_MASK,
      },
    },
  )

  if (!res.ok) return { reviews: [], rating: null, userRatingCount: null }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = await res.json()
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    reviews: (data.reviews || []).map((r: any) => ({
      text: r.text?.text || '',
      rating: r.rating || null,
      author: r.authorAttribution?.displayName || 'Anonymous',
      time: r.relativePublishTimeDescription || '',
    })),
    rating: data.rating as number | null,
    userRatingCount: data.userRatingCount as number | null,
  }
}

// ── Claude — web search ──────────────────────────────────────────

async function webSearchCompany(
  anthropic: Anthropic,
  company: { company_name: string; state: string | null; phone_number: string | null; website: string | null; google_rating: number | null; google_reviews: number | null },
) {
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 2048,
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }],
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

  return response.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('\n\n')
}

// ── Claude — revenue estimation ──────────────────────────────────

interface RevenueEstimate {
  estimated_annual_revenue_low: number
  estimated_annual_revenue_high: number
  confidence: string
  technician_count_estimate: number | null
  reasoning: string
  key_signals: string[]
}

async function estimateRevenue(
  anthropic: Anthropic,
  company: { company_name: string; state: string | null; website: string | null; google_rating: number | null; google_reviews: number | null },
  reviews: { reviews: { text: string; rating: number | null; author: string; time: string }[]; rating: number | null; userRatingCount: number | null },
  webIntel: string,
): Promise<RevenueEstimate | null> {
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
    return JSON.parse(cleaned) as RevenueEstimate
  } catch {
    console.error('[enrich] Failed to parse revenue JSON:', text.slice(0, 300))
    return null
  }
}

// ── Route handler ────────────────────────────────────────────────

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const googleApiKey = process.env.GOOGLE_MAPS_API_KEY
  const anthropicKey = process.env.ANTHROPIC_API_KEY
  if (!googleApiKey || !anthropicKey) {
    return NextResponse.json(
      { error: 'GOOGLE_MAPS_API_KEY and ANTHROPIC_API_KEY must be configured' },
      { status: 500 },
    )
  }

  const { id } = await params
  const supabase = await createClient()

  const { data: company, error: fetchErr } = await supabase
    .from('companies')
    .select('*')
    .eq('id', id)
    .single()

  if (fetchErr || !company) {
    return NextResponse.json({ error: 'Company not found' }, { status: 404 })
  }

  const anthropic = new Anthropic({ apiKey: anthropicKey })

  // Step 1: Google Reviews (skip if no place ID)
  const reviews = company.google_place_id
    ? await fetchReviews(company.google_place_id, googleApiKey)
    : { reviews: [], rating: null, userRatingCount: null }

  // Step 2: Web search
  let webIntel = ''
  try {
    webIntel = await webSearchCompany(anthropic, company)
  } catch (err) {
    console.error('[enrich] Web search failed:', err)
  }

  // Step 3: Revenue estimate
  const estimate = await estimateRevenue(anthropic, company, reviews, webIntel)

  if (!estimate) {
    return NextResponse.json({ error: 'Revenue estimation failed' }, { status: 500 })
  }

  // Step 4: Persist
  const enrichment = {
    estimated_revenue_low: estimate.estimated_annual_revenue_low,
    estimated_revenue_high: estimate.estimated_annual_revenue_high,
    revenue_confidence: estimate.confidence,
    technician_count_estimate: estimate.technician_count_estimate,
    enrichment_reasoning: estimate.reasoning,
    enrichment_signals: estimate.key_signals || [],
    enriched_at: new Date().toISOString(),
  }

  const { data: updated, error: patchErr } = await supabase
    .from('companies')
    .update(enrichment)
    .eq('id', id)
    .select()
    .single()

  if (patchErr) {
    return NextResponse.json({ error: 'Failed to save enrichment' }, { status: 500 })
  }

  return NextResponse.json({
    ...enrichment,
    reviews_fetched: reviews.reviews.length,
    web_intel_length: webIntel.length,
    company: updated,
  })
}
