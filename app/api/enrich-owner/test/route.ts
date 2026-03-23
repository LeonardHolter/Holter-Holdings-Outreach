import { NextResponse } from 'next/server'

export const maxDuration = 60

export async function GET() {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json({ step: 'env', error: 'ANTHROPIC_API_KEY not set' })
  }

  // Step 1: simplest possible API call — no tools, no web search
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 32,
        messages: [{ role: 'user', content: 'Reply with just the word "hello"' }],
      }),
    })

    const data = await res.json()
    if (!res.ok) {
      return NextResponse.json({
        step: 'basic-call',
        status: res.status,
        error: data?.error?.message ?? JSON.stringify(data),
        errorType: data?.error?.type,
        keyPrefix: apiKey.slice(0, 12) + '...',
      })
    }

    const text = data.content?.find((b: { type: string }) => b.type === 'text')?.text ?? ''

    // Step 2: try with web search tool
    const res2 = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 128,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        messages: [{ role: 'user', content: 'Who is the CEO of Apple? Reply with just their name.' }],
      }),
    })

    const data2 = await res2.json()
    if (!res2.ok) {
      return NextResponse.json({
        step: 'web-search-call',
        basicCallWorked: true,
        basicResponse: text,
        status: res2.status,
        error: data2?.error?.message ?? JSON.stringify(data2),
        errorType: data2?.error?.type,
      })
    }

    const text2 = data2.content
      ?.filter((b: { type: string }) => b.type === 'text')
      ?.map((b: { text: string }) => b.text)
      ?.join(' ') ?? ''

    return NextResponse.json({
      step: 'all-passed',
      basicResponse: text,
      webSearchResponse: text2,
      keyPrefix: apiKey.slice(0, 12) + '...',
    })
  } catch (err) {
    return NextResponse.json({
      step: 'exception',
      error: err instanceof Error ? err.message : String(err),
    })
  }
}
