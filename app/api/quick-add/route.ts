import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@/lib/supabase/server'

export const maxDuration = 30

const client = new Anthropic()

const SYSTEM_PROMPT = `You are a data extraction assistant. The user will paste raw text copied from Google Maps for a garage door company.
Extract the following fields and return ONLY a valid JSON object — no markdown, no explanation, just the JSON:

{
  "company_name": string,          // Full business name
  "phone_number": string | null,   // Digits only, e.g. "7402893925"
  "state": string | null,          // 2-letter US state code, e.g. "OH"
  "google_reviews": number | null, // Review COUNT (the number in parentheses), not the star rating
  "notes": string | null           // Any extra useful info (address, website, hours) in one line
}

Rules:
- phone_number: strip all non-digits. If not present, return null.
- state: extract from the address line. Return the 2-letter code only.
- google_reviews: this is the INTEGER count inside parentheses, e.g. "(8)" → 8. NOT the star rating.
- notes: include the website and full address if present. Keep it short.
- If a field is not found, return null for that field.`

export async function POST(request: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'ANTHROPIC_API_KEY not set' }, { status: 500 })

  const { text } = await request.json() as { text: string }
  if (!text?.trim()) return NextResponse.json({ error: 'text is required' }, { status: 400 })

  // ── Step 1: parse with Claude ──────────────────────────────────────────────
  let parsed: {
    company_name: string
    phone_number: string | null
    state: string | null
    google_reviews: number | null
    notes: string | null
  }

  try {
    const msg = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 256,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: text.trim() }],
    })

    const raw = msg.content[0].type === 'text' ? msg.content[0].text.trim() : ''
    // Strip any accidental markdown fences
    const clean = raw.replace(/^```[a-z]*\n?/i, '').replace(/```$/i, '').trim()
    parsed = JSON.parse(clean)
  } catch (err) {
    console.error('[quick-add] Claude parse error:', err)
    return NextResponse.json({ error: 'Failed to parse company info from text' }, { status: 422 })
  }

  if (!parsed.company_name) {
    return NextResponse.json({ error: 'Could not extract a company name from the text' }, { status: 422 })
  }

  // ── Step 2: insert into Supabase ──────────────────────────────────────────
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('companies')
    .insert({
      company_name:   parsed.company_name,
      phone_number:   parsed.phone_number,
      state:          parsed.state,
      google_reviews: parsed.google_reviews,
      notes:          parsed.notes,
      reach_out_response: null,
    })
    .select()
    .single()

  if (error) {
    console.error('[quick-add] Supabase insert error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ company: data, parsed })
}
