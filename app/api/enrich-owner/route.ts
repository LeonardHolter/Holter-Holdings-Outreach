import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

export const maxDuration = 60

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
  const anthropic = new Anthropic({ apiKey })

  // Ask Claude to return structured JSON so we never have to guess what it found.
  // web_search_20260209 is server-side — Anthropic executes the searches automatically
  // and returns stop_reason: 'end_turn' in a single API call.
  const userPrompt =
    `Search the web for the owner or principal of the garage door company "${companyName}"${location}. ` +
    `Check ZoomInfo, Yelp, BBB, the company website, and any other sources. ` +
    `When you have finished searching, reply with ONLY this JSON and nothing else:\n` +
    `{"owner": "Full Name"}\n` +
    `If you cannot find a name, reply with:\n` +
    `{"owner": null}`

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 512,
      tools: [{ type: 'web_search_20260209' as const, name: 'web_search' } as unknown as Anthropic.Tool],
      messages: [{ role: 'user', content: userPrompt }],
    })

    console.log(
      `[enrich-owner] stop_reason=${response.stop_reason}`,
      `blocks=${JSON.stringify(response.content.map(b => b.type))}`,
    )

    // Collect all text blocks — the JSON answer is in the last one
    const textBlocks = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map(b => b.text.trim())

    console.log(`[enrich-owner] text blocks:`, textBlocks)

    // Find the JSON object in the last text block (Claude may add preamble on rare occasions)
    const lastText = textBlocks.at(-1) ?? ''
    const jsonMatch = lastText.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      console.warn('[enrich-owner] no JSON found in response')
      return NextResponse.json({ owner: null })
    }

    const parsed = JSON.parse(jsonMatch[0]) as { owner: string | null }
    const owner = parsed.owner?.trim() || null

    console.log(`[enrich-owner] owner="${owner}"`)
    return NextResponse.json({ owner })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[enrich-owner] error:', msg)
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}
