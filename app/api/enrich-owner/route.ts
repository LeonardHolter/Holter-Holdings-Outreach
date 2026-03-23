import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

// 300 s = max allowed on Vercel Pro. Ignored on Hobby (10 s hard cap).
export const maxDuration = 300

const anthropic = new Anthropic()

// ── Attempt 1: web search (accurate, slow ~20-60 s) ─────────────────────────
async function searchWithWeb(companyName: string, location: string): Promise<string | null> {
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

  const textBlocks = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map(b => b.text.trim())

  const lastText = textBlocks.at(-1) ?? ''
  const jsonMatch = lastText.match(/\{[\s\S]*\}/)
  if (!jsonMatch) return null
  const parsed = JSON.parse(jsonMatch[0]) as { owner: string | null }
  return parsed.owner?.trim() || null
}

// ── Attempt 2: training-data only (fast, ~2-3 s, less accurate) ─────────────
async function searchFromKnowledge(companyName: string, location: string): Promise<string | null> {
  const prompt =
    `What is the owner or principal's name of the garage door company "${companyName}"${location}? ` +
    `Reply with ONLY this JSON and nothing else:\n` +
    `{"owner":"Full Name"}\n` +
    `If unknown reply with: {"owner":null}`

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 128,
    messages: [{ role: 'user', content: prompt }],
  })

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map(b => b.text.trim())
    .at(-1) ?? ''

  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) return null
  const parsed = JSON.parse(jsonMatch[0]) as { owner: string | null }
  return parsed.owner?.trim() || null
}

// ── Route ────────────────────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.error('[enrich-owner] ANTHROPIC_API_KEY is not set')
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY not set' }, { status: 500 })
  }

  const { companyName, state } = await request.json()
  if (!companyName) {
    return NextResponse.json({ error: 'companyName is required' }, { status: 400 })
  }

  const location = state ? ` in ${state}` : ''

  // Try web search first; fall back to training knowledge if it times out or errors
  try {
    console.log(`[enrich-owner] web search: "${companyName}"${location}`)
    const owner = await searchWithWeb(companyName, location)
    console.log(`[enrich-owner] web search result: "${owner}"`)
    return NextResponse.json({ owner, method: 'web' })
  } catch (webErr) {
    const webMsg = webErr instanceof Error ? webErr.message : String(webErr)
    console.warn(`[enrich-owner] web search failed (${webMsg}), trying knowledge fallback`)

    try {
      const owner = await searchFromKnowledge(companyName, location)
      console.log(`[enrich-owner] knowledge fallback result: "${owner}"`)
      return NextResponse.json({ owner, method: 'knowledge' })
    } catch (knownErr) {
      const knownMsg = knownErr instanceof Error ? knownErr.message : String(knownErr)
      console.error(`[enrich-owner] both attempts failed. web="${webMsg}" knowledge="${knownMsg}"`)
      return NextResponse.json({ error: webMsg }, { status: 502 })
    }
  }
}
