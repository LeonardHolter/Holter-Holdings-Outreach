import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

export const maxDuration = 60

const TOOLS: Anthropic.Tool[] = [
  { type: 'web_search_20260209' as const, name: 'web_search' } as unknown as Anthropic.Tool,
]

function extractName(content: Anthropic.ContentBlock[]): string {
  // Collect ALL text blocks — the final one is the actual answer,
  // earlier ones are often just preamble like "I'll search for this..."
  const textBlocks = content.filter(b => b.type === 'text').map(b => (b as Anthropic.TextBlock).text.trim())
  const raw = textBlocks.at(-1) ?? ''

  // Take only the first line, strip markdown bold, trim whitespace
  return raw.split(/\n/)[0].replace(/\*\*/g, '').trim()
}

const BAD = /unknown|not find|could not|unable|cannot|i (was unable|could not|don't|do not)|no (information|owner|record|result|data)|i found|i searched|searching|let me|here is|the owner|based on/i

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

  const userPrompt = `Find the owner or principal of the garage door company "${companyName}"${location}.
Check ZoomInfo, Yelp, and the Better Business Bureau (BBB) — search each one.
Reply with ONLY the owner's full name. No titles, no company name, no explanation, no sentence. Just the name.`

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const messages: any[] = [{ role: 'user', content: userPrompt }]

    // Allow up to 5 rounds so tool calls get properly resolved
    for (let round = 0; round < 5; round++) {
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 256,
        tools: TOOLS,
        messages,
      })

      console.log(`[enrich-owner] round=${round} stop_reason=${response.stop_reason} blocks=${JSON.stringify(response.content.map(b => b.type))}`)

      if (response.stop_reason === 'end_turn') {
        const name = extractName(response.content)
        console.log(`[enrich-owner] extracted name="${name}"`)

        const bad =
          !name ||
          name.length < 2 ||
          name.length > 80 ||
          BAD.test(name)

        if (bad) {
          console.log(`[enrich-owner] name rejected as bad`)
          return NextResponse.json({ owner: null })
        }

        // Handle "Name1 and Name2" or "Name1, Name2" — keep first
        const owner = name.split(/ and |,/i)[0].trim()
        return NextResponse.json({ owner })
      }

      if (response.stop_reason === 'tool_use') {
        // Push the assistant turn and synthetic tool results so Claude can continue
        messages.push({ role: 'assistant', content: response.content })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const toolResults: any[] = response.content
          .filter(b => b.type === 'tool_use')
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .map((b: any) => ({
            type: 'tool_result',
            tool_use_id: b.id,
            content: '(search executed by Anthropic)',
          }))
        if (toolResults.length) messages.push({ role: 'user', content: toolResults })
        continue
      }

      // Unexpected stop reason — break out
      break
    }

    console.warn('[enrich-owner] no end_turn reached')
    return NextResponse.json({ owner: null })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[enrich-owner] Anthropic error:', msg)
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}
