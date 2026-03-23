import { NextRequest, NextResponse } from 'next/server'

export const maxDuration = 300

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages'

interface AnthropicTextBlock {
  type: 'text'
  text: string
}

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
    const msg = data?.error?.message ?? JSON.stringify(data)
    throw new Error(`Anthropic ${res.status}: ${msg}`)
  }
  return data as AnthropicResponse
}

function extractOwnerFromJson(blocks: AnthropicResponse['content']): string | null {
  const textBlocks = blocks.filter((b): b is AnthropicTextBlock => b.type === 'text')
  const lastText = textBlocks.at(-1)?.text?.trim() ?? ''
  const match = lastText.match(/\{[\s\S]*\}/)
  if (!match) return null
  try {
    return (JSON.parse(match[0]) as { owner: string | null }).owner?.trim() || null
  } catch {
    return null
  }
}

// ── Attempt 1: web search (accurate, ~20-60 s) ──────────────────────────────
async function searchWithWeb(apiKey: string, companyName: string, location: string): Promise<string | null> {
  const prompt =
    `Search the web for the owner or principal of the garage door company "${companyName}"${location}. ` +
    `Check ZoomInfo, Yelp, BBB, the company website, and any other sources. ` +
    `When done, reply with ONLY this JSON and nothing else:\n` +
    `{"owner":"Full Name"}\n` +
    `If you cannot find a name reply with: {"owner":null}`

  const data = await callAnthropic(apiKey, {
    model: 'claude-sonnet-4-6',
    max_tokens: 512,
    tools: [{ type: 'web_search_20250305', name: 'web_search' }],
    messages: [{ role: 'user', content: prompt }],
  })

  return extractOwnerFromJson(data.content)
}

// ── Attempt 2: training knowledge only (fast ~2-3 s) ────────────────────────
async function searchFromKnowledge(apiKey: string, companyName: string, location: string): Promise<string | null> {
  const prompt =
    `What is the owner or principal's full name of the garage door company "${companyName}"${location}? ` +
    `Reply with ONLY this JSON and nothing else:\n` +
    `{"owner":"Full Name"}\n` +
    `If you don't know reply with: {"owner":null}`

  const data = await callAnthropic(apiKey, {
    model: 'claude-sonnet-4-6',
    max_tokens: 128,
    messages: [{ role: 'user', content: prompt }],
  })

  return extractOwnerFromJson(data.content)
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

  // Try web search first; fall back to knowledge if it fails
  try {
    console.log(`[enrich-owner] web-search: "${companyName}"${location}`)
    const owner = await searchWithWeb(apiKey, companyName, location)
    console.log(`[enrich-owner] web-search result: "${owner}"`)
    return NextResponse.json({ owner, method: 'web' })
  } catch (webErr) {
    const webMsg = webErr instanceof Error ? webErr.message : String(webErr)
    console.warn(`[enrich-owner] web-search failed: ${webMsg}`)

    try {
      console.log(`[enrich-owner] knowledge fallback: "${companyName}"${location}`)
      const owner = await searchFromKnowledge(apiKey, companyName, location)
      console.log(`[enrich-owner] knowledge result: "${owner}"`)
      return NextResponse.json({ owner, method: 'knowledge' })
    } catch (knownErr) {
      const knownMsg = knownErr instanceof Error ? knownErr.message : String(knownErr)
      console.error(`[enrich-owner] both failed — web: "${webMsg}" knowledge: "${knownMsg}"`)
      return NextResponse.json({ error: knownMsg, webError: webMsg }, { status: 502 })
    }
  }
}
