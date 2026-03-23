import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

// 300 s = max allowed on Vercel Pro. Ignored on Hobby (10 s hard cap).
export const maxDuration = 300

// ── Attempt 1: web search (accurate, slow ~20-60 s) ─────────────────────────
async function searchWithWeb(
  anthropic: Anthropic,
  companyName: string,
  location: string,
): Promise<string | null> {
  const prompt =
    `Search the web for the owner or principal of the garage door company "${companyName}"${location}. ` +
    `Check ZoomInfo, Yelp, BBB, the company website, and any other sources. ` +
    `When done, reply with ONLY this JSON and nothing else:\n` +
    `{"owner":"Full Name"}\n` +
    `If you cannot find a name reply with: {"owner":null}`

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 512,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tools: [{ type: 'web_search_20260209', name: 'web_search' } as any],
    messages: [{ role: 'user', content: prompt }],
  })

  const lastText = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map(b => b.text.trim())
    .at(-1) ?? ''

  const jsonMatch = lastText.match(/\{[\s\S]*\}/)
  if (!jsonMatch) return null
  return (JSON.parse(jsonMatch[0]) as { owner: string | null }).owner?.trim() || null
}

// ── Attempt 2: training knowledge only (fast ~2-3 s, less accurate) ──────────
async function searchFromKnowledge(
  anthropic: Anthropic,
  companyName: string,
  location: string,
): Promise<string | null> {
  const prompt =
    `What is the owner or principal's full name of the garage door company "${companyName}"${location}? ` +
    `Reply with ONLY this JSON and nothing else:\n` +
    `{"owner":"Full Name"}\n` +
    `If you don't know reply with: {"owner":null}`

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 128,
    messages: [{ role: 'user', content: prompt }],
  })

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map(b => b.text.trim())
    .at(-1) ?? ''

  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) return null
  return (JSON.parse(jsonMatch[0]) as { owner: string | null }).owner?.trim() || null
}

// ── Route ────────────────────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.error('[enrich-owner] ANTHROPIC_API_KEY is not set')
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY not set in Vercel env vars' }, { status: 500 })
  }

  const { companyName, state } = await request.json()
  if (!companyName) {
    return NextResponse.json({ error: 'companyName is required' }, { status: 400 })
  }

  // Create client inside handler so a missing API key never crashes the module
  const anthropic = new Anthropic({ apiKey })
  const location = state ? ` in ${state}` : ''

  // Try web search first; fall back to training knowledge if it errors or times out
  try {
    console.log(`[enrich-owner] web-search: "${companyName}"${location}`)
    const owner = await searchWithWeb(anthropic, companyName, location)
    console.log(`[enrich-owner] web-search result: "${owner}"`)
    return NextResponse.json({ owner, method: 'web' })
  } catch (webErr) {
    const webMsg = webErr instanceof Error ? webErr.message : String(webErr)
    console.warn(`[enrich-owner] web-search failed: ${webMsg}`)

    try {
      console.log(`[enrich-owner] knowledge fallback: "${companyName}"${location}`)
      const owner = await searchFromKnowledge(anthropic, companyName, location)
      console.log(`[enrich-owner] knowledge result: "${owner}"`)
      return NextResponse.json({ owner, method: 'knowledge' })
    } catch (knownErr) {
      const knownMsg = knownErr instanceof Error ? knownErr.message : String(knownErr)
      console.error(`[enrich-owner] both failed — web: "${webMsg}" knowledge: "${knownMsg}"`)
      // Return the actual error so you can see it in the browser console
      return NextResponse.json({ error: knownMsg, webError: webMsg }, { status: 502 })
    }
  }
}
