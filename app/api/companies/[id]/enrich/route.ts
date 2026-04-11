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
      content: `Search for Google reviews and any public information about this garage door service company. Focus specifically on finding technician and employee names.

Company: ${company.company_name}
State: ${company.state || 'Unknown'}
Phone: ${company.phone_number || 'Unknown'}
Website: ${company.website || 'Unknown'}

Search for their Google reviews, Yelp reviews, and any "Meet the team" or "About us" pages on their website. Your primary goal is to find as many unique technician/employee first names as possible.

Report:
1. Every technician or employee name you find mentioned in reviews or on their website
2. Number of employees if listed anywhere
3. Any team photos or staff pages that indicate company size

Keep the response concise and focused on names and headcount.`,
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
      content: `You are an analyst estimating the size of a garage door service company based ONLY on technician/employee names mentioned in their Google reviews and web presence.

## Company Info
- Name: ${company.company_name}
- State: ${company.state || 'Unknown'}
- Total Google Reviews: ${reviews.userRatingCount || company.google_reviews || 0}

## Google Reviews
${reviewsText}

## Web Research
${webIntel || 'No additional web intel available.'}

## Instructions

Your ONLY job is to count unique technician/employee first names mentioned in the reviews and web research above. Then estimate revenue from that count.

1. Go through every review and extract every unique person name mentioned (e.g. "Mike was great", "Our tech Josh arrived on time", "Shout out to Daniel and Chris"). These are technicians.
2. Deduplicate — "Mike" mentioned in 3 different reviews is still 1 technician.
3. List every unique technician name you found.
4. A typical garage door technician generates $150,000–$250,000 in revenue per year.
5. Multiply the technician count by that range to get the revenue estimate.
6. If zero technician names are found, set technician_count_estimate to null and revenue to null values.

Respond with ONLY a valid JSON object (no markdown, no explanation outside the JSON):
{
  "estimated_annual_revenue_low": <integer or null — technician_count * 150000>,
  "estimated_annual_revenue_high": <integer or null — technician_count * 250000>,
  "confidence": "<low|medium|high> — high if 3+ unique names found, medium if 1-2, low if 0",
  "technician_count_estimate": <integer — number of unique tech names found, or null if none>,
  "reasoning": "<List each unique technician name you found, then explain the math>",
  "key_signals": ["<name 1 from review>", "<name 2 from review>", ...]
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
    console.error('[enrich] Supabase update failed:', patchErr)
    return NextResponse.json({ error: `Failed to save enrichment: ${patchErr.message}` }, { status: 500 })
  }

  return NextResponse.json({
    ...enrichment,
    reviews_fetched: reviews.reviews.length,
    web_intel_length: webIntel.length,
    company: updated,
  })
}
