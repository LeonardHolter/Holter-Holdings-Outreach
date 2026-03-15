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

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 256,
      tools: [{ type: 'web_search_20260209' as const, name: 'web_search' }],
      messages: [{
        role: 'user',
        content: `Who is the owner of the garage door company "${companyName}"${location}? Reply with ONLY their full name, nothing else.`,
      }],
    })

    let name = ''
    for (const block of response.content) {
      if (block.type === 'text') { name = block.text.trim(); break }
    }

    name = name.split(/\n/)[0].replace(/\*\*/g, '').trim()

    const bad =
      !name ||
      name.length < 2 ||
      name.length > 100 ||
      /unknown|not find|could not|unable|cannot|no (information|owner|record|result|data)/i.test(name)

    if (bad) {
      return NextResponse.json({ owner: null })
    }

    const owner = name.split(/ and |,/i)[0].trim()
    return NextResponse.json({ owner })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[enrich-owner] Anthropic error:', msg)
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}
