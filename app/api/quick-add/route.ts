import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@/lib/supabase/server'

export const maxDuration = 30

interface Parsed {
  company_name: string
  phone_number: string | null
  state: string | null
  google_reviews: number | null
}

// ── Regex fallback parser ─────────────────────────────────────────────────────
// Handles the standard Google Maps copy-paste format reliably without an API call.
function regexParse(text: string): Parsed | null {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  if (lines.length === 0) return null

  // Company name = first non-empty line
  const company_name = lines[0]

  // Phone: (740) 289-3925 or 740-289-3925 or similar
  const phoneMatch = text.match(/\(?\d{3}\)?[\s.\\-]\d{3}[\s.\\-]\d{4}/)
  const phone_number = phoneMatch ? phoneMatch[0].replace(/\D/g, '') : null

  // State: 2-letter abbreviation from an address line (e.g. ", OH 45661")
  const stateMatch = text.match(/,\s*([A-Z]{2})\s+\d{5}/)
  const state = stateMatch ? stateMatch[1] : null

  // Review count: integer in parentheses that follows a decimal rating
  // Pattern: "3.4\n(8)" or "3.4 (8)"
  const reviewMatch = text.match(/\d+\.\d+\s*\n?\s*\((\d+)\)/)
  const google_reviews = reviewMatch ? parseInt(reviewMatch[1], 10) : null

  return { company_name, phone_number, state, google_reviews }
}

// ── Claude parser ─────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are a data extraction assistant. The user will paste raw text copied from Google Maps for a garage door company.
Extract the following fields and return ONLY a valid JSON object — no markdown, no explanation, just the JSON:

{
  "company_name": string,
  "phone_number": string | null,
  "state": string | null,
  "google_reviews": number | null
}

Rules:
- phone_number: digits only, e.g. "7402893925". Null if not present.
- state: 2-letter US code from the address, e.g. "OH". Null if not found.
- google_reviews: INTEGER count in parentheses e.g. "(8)" → 8. NOT the star rating.
- If a field is not found return null.`

async function claudeParse(text: string, apiKey: string): Promise<Parsed> {
  const client = new Anthropic({ apiKey })
  const msg = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 256,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: text.trim() }],
  })
  const raw = msg.content[0].type === 'text' ? msg.content[0].text.trim() : ''
  const jsonMatch = raw.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error(`No JSON in response: ${raw.slice(0, 100)}`)
  return JSON.parse(jsonMatch[0]) as Parsed
}

// ── Route ─────────────────────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  const { text } = await request.json() as { text: string }
  if (!text?.trim()) return NextResponse.json({ error: 'text is required' }, { status: 400 })

  const apiKey = process.env.ANTHROPIC_API_KEY
  let parsed: Parsed | null = null
  let method = 'regex'

  // Try Claude first, fall back to regex if anything goes wrong
  if (apiKey) {
    try {
      parsed = await claudeParse(text.trim(), apiKey)
      method = 'claude'
    } catch (err) {
      console.warn('[quick-add] Claude failed, falling back to regex:', String(err))
    }
  }

  if (!parsed || !parsed.company_name) {
    parsed = regexParse(text.trim())
    method = 'regex'
  }

  if (!parsed?.company_name) {
    return NextResponse.json({ error: 'Could not extract a company name. Make sure you pasted a full Google Maps listing.' }, { status: 422 })
  }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('companies')
    .insert({
      company_name:       parsed.company_name,
      phone_number:       parsed.phone_number,
      state:              parsed.state,
      google_reviews:     parsed.google_reviews,
      reach_out_response: null,
    })
    .select()
    .single()

  if (error) {
    console.error('[quick-add] Supabase insert error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ company: data, parsed, method })
}
