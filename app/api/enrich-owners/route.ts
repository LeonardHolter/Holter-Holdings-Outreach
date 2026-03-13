import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@/lib/supabase/server'

export const maxDuration = 60

export async function GET() {
  const supabase = await createClient()

  // Reset previous "Not found" entries so they get retried
  await supabase
    .from('companies')
    .update({ owners_name: null })
    .eq('owners_name', 'Not found')

  const { count } = await supabase
    .from('companies')
    .select('id', { count: 'exact', head: true })
    .or('owners_name.is.null,owners_name.eq.')

  return NextResponse.json({ missing: count ?? 0 })
}

export async function POST() {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY is not set' }, { status: 500 })
  }

  const supabase = await createClient()

  const { data: companies, error } = await supabase
    .from('companies')
    .select('id, company_name, state')
    .or('owners_name.is.null,owners_name.eq.')
    .limit(1)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!companies || companies.length === 0) {
    return NextResponse.json({ done: true, remaining: 0 })
  }

  const company = companies[0]
  const location = company.state ? ` in ${company.state}` : ''

  try {
    const anthropic = new Anthropic({ apiKey })

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 128,
      tools: [{ type: 'web_search_20250305' as const, name: 'web_search' }],
      messages: [{
        role: 'user',
        content: `who is the owner of ${company.company_name}${location}? Reply with ONLY the full name.`,
      }],
    })

    let name = ''
    for (const block of response.content) {
      if (block.type === 'text') { name = block.text.trim(); break }
    }

    // Clean up: take only the first name if multiple are returned
    name = name.split(/\n/)[0].trim()
    // Remove markdown bold markers etc
    name = name.replace(/\*\*/g, '').trim()

    const bad =
      !name ||
      name.length < 2 ||
      name.length > 100 ||
      /unknown|not find|could not|unable|cannot|no (information|owner|record|result|data)/i.test(name)

    if (bad) {
      await supabase.from('companies').update({ owners_name: 'Not found' }).eq('id', company.id)
    } else {
      // If multiple names (e.g. "Josh LaBelle and Mark Northfield"), take the first
      const firstName = name.split(/ and |,/i)[0].trim()
      await supabase.from('companies').update({ owners_name: firstName }).eq('id', company.id)
    }

    const { count: remaining } = await supabase
      .from('companies')
      .select('id', { count: 'exact', head: true })
      .or('owners_name.is.null,owners_name.eq.')

    return NextResponse.json({
      company: company.company_name,
      owner: bad ? null : name.split(/ and |,/i)[0].trim(),
      remaining: remaining ?? 0,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('Enrich failed:', company.company_name, msg)
    return NextResponse.json(
      { error: `Claude API failed for ${company.company_name}: ${msg}` },
      { status: 502 }
    )
  }
}
