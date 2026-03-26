import { NextRequest, NextResponse } from 'next/server'

export const maxDuration = 300

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages'

interface AnthropicTextBlock { type: 'text'; text: string }
interface AnthropicResponse {
  content: (AnthropicTextBlock | { type: string })[]
  stop_reason: string
}

async function callAnthropic(
  apiKey: string,
  body: Record<string, unknown>,
): Promise<AnthropicResponse> {
  const res = await fetch(ANTHROPIC_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  })
  const data = await res.json()
  if (!res.ok) {
    throw new Error(`Anthropic ${res.status}: ${data?.error?.message ?? JSON.stringify(data)}`)
  }
  return data as AnthropicResponse
}

function getAllText(content: AnthropicResponse['content']): string {
  return content
    .filter((b): b is AnthropicTextBlock => b.type === 'text')
    .map(b => b.text)
    .join('\n')
}

// Extract a person's name from Claude's natural language response.
// Works with formats like:
//   "Garth Thiessen"
//   "The owner is Garth Thiessen."
//   "Based on my search, the owner is **Garth Thiessen**."
//   "Garth Thiessen — he's the General Manager/Owner of..."
function extractNameFromText(text: string): string | null {
  if (!text) return null

  // First try JSON if Claude followed the format
  const jsonMatch = text.match(/\{[\s\S]*?"owner"\s*:\s*"([^"]+)"[\s\S]*?\}/)
  if (jsonMatch?.[1]) return jsonMatch[1].trim()

  // Strip out common preamble phrases
  const cleaned = text
    .replace(/\*\*/g, '')
    .replace(/^(Based on|According to|From|After|I found|My search|The search|Looking at|Searching)[^,:.]*[,:.]?\s*/gi, '')
    .replace(/^(the|an?)\s+(owner|principal|founder|president|ceo|general manager|manager|proprietor)\s+(of\s+.+?\s+)?(is|was|appears to be|seems to be)\s+/gi, '')
    .trim()

  if (!cleaned) return null

  // Take the first line
  const firstLine = cleaned.split(/\n/)[0].trim()

  // If it looks like a name (2-4 capitalized words), take it
  const nameMatch = firstLine.match(/^([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})/)
  if (nameMatch) {
    const candidate = nameMatch[1].trim()
    // Reject if it's a generic phrase
    if (/^(The|This|That|There|Here|Unfortunately|Sorry|Cannot|Could|Would|However|Based|After|I was)/i.test(candidate)) {
      return null
    }
    return candidate
  }

  // Last resort: if the first line is short enough, just use it
  if (firstLine.length >= 3 && firstLine.length <= 50 && !/[.!?]/.test(firstLine)) {
    return firstLine
  }

  return null
}

// ── Web search approach (accurate, ~15-40 s) ────────────────────────────────
async function searchWithWeb(apiKey: string, companyName: string, location: string): Promise<{ owner: string | null; raw: string }> {
  // Mimic what you'd type on claude.ai — a natural question, not JSON instructions
  const data = await callAnthropic(apiKey, {
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    tools: [{ type: 'web_search_20250305', name: 'web_search' }],
    messages: [{
      role: 'user',
      content:
        `Find the owner of the garage door company "${companyName}"${location}. ` +
        `Search ZoomInfo, Yelp, BBB, and the company's own website. ` +
        `Tell me just their full name.`,
    }],
  })

  const fullText = getAllText(data.content)
  console.log(`[enrich-owner] web-search raw response:\n${fullText.slice(0, 500)}`)
  return { owner: extractNameFromText(fullText), raw: fullText }
}

// ── Knowledge fallback (fast ~2-3 s) ────────────────────────────────────────
async function searchFromKnowledge(apiKey: string, companyName: string, location: string): Promise<{ owner: string | null; raw: string }> {
  const data = await callAnthropic(apiKey, {
    model: 'claude-sonnet-4-6',
    max_tokens: 256,
    messages: [{
      role: 'user',
      content:
        `Who is the owner of the garage door company "${companyName}"${location}? ` +
        `Reply with just their full name, nothing else.`,
    }],
  })

  const fullText = getAllText(data.content)
  console.log(`[enrich-owner] knowledge raw response:\n${fullText.slice(0, 300)}`)
  return { owner: extractNameFromText(fullText), raw: fullText }
}

// ── Route ────────────────────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY not set in Vercel env vars' }, { status: 500 })
  }

  const { companyName, state } = await request.json()
  if (!companyName) {
    return NextResponse.json({ error: 'companyName is required' }, { status: 400 })
  }

  const location = state ? ` in ${state}` : ''

  // Try knowledge first (fast, works on Hobby plan). If it fails, try web search.
  try {
    console.log(`[enrich-owner] knowledge: "${companyName}"${location}`)
    const { owner, raw } = await searchFromKnowledge(apiKey, companyName, location)
    console.log(`[enrich-owner] knowledge result: "${owner}"`)
    if (owner) return NextResponse.json({ owner, method: 'knowledge', raw })
  } catch (err) {
    console.warn(`[enrich-owner] knowledge failed: ${err instanceof Error ? err.message : err}`)
  }

  try {
    console.log(`[enrich-owner] web-search: "${companyName}"${location}`)
    const { owner, raw } = await searchWithWeb(apiKey, companyName, location)
    console.log(`[enrich-owner] web result: "${owner}"`)
    return NextResponse.json({ owner, method: 'web', raw })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[enrich-owner] both failed: ${msg}`)
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}
