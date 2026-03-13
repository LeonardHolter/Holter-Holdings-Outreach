import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@/lib/supabase/server'

// Process one company per request to stay well within serverless timeout
export const maxDuration = 60

// GET — how many companies are still missing an owner
export async function GET() {
  const supabase = await createClient()
  const { count } = await supabase
    .from('companies')
    .select('id', { count: 'exact', head: true })
    .or('owners_name.is.null,owners_name.eq.,owners_name.eq.Not found')

  return NextResponse.json({ missing: count ?? 0 })
}

// POST — look up the owner for ONE company at a time
export async function POST() {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY is not set' }, { status: 500 })
  }

  const supabase = await createClient()

  // Grab one company that still needs an owner
  const { data: companies, error } = await supabase
    .from('companies')
    .select('id, company_name, state')
    .or('owners_name.is.null,owners_name.eq.,owners_name.eq.Not found')
    .limit(1)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!companies || companies.length === 0) {
    return NextResponse.json({ processed: 0, found: 0, remaining: 0, results: [] })
  }

  const company = companies[0]
  const anthropic = new Anthropic({ apiKey })

  const location = company.state ? ` in ${company.state}` : ''
  const prompt =
    `Who is the owner of "${company.company_name}"${location}? ` +
    `It is a garage door service company. ` +
    `Reply with only the owner's full name. If you cannot find it, reply with exactly: UNKNOWN`

  const result = await (async () => {
    try {
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 128,
        tools: [{ type: 'web_search_20260209' as const, name: 'web_search' }],
        messages: [{ role: 'user', content: prompt }],
      })

      let raw = 'UNKNOWN'
      for (const block of response.content) {
        if (block.type === 'text') { raw = block.text.trim(); break }
      }

      const isValid =
        raw.length > 1 &&
        raw.length < 80 &&
        raw !== 'UNKNOWN' &&
        !/i (could not|was unable|cannot|don't|do not)|not find|no (information|record|result|owner|data)|unknown/i.test(raw)

      if (isValid) {
        const name = raw.split(/\n|,| and /i)[0].trim()
        await supabase.from('companies').update({ owners_name: name }).eq('id', company.id)
        return { owner: name, status: 'found' as const }
      }

      await supabase.from('companies').update({ owners_name: 'Not found' }).eq('id', company.id)
      return { owner: null, status: 'not_found' as const }
    } catch (err) {
      console.error('Enrichment error for', company.company_name, err)
      return { owner: null, status: 'error' as const }
    }
  })()

  // Count remaining
  const { count: remaining } = await supabase
    .from('companies')
    .select('id', { count: 'exact', head: true })
    .or('owners_name.is.null,owners_name.eq.,owners_name.eq.Not found')

  return NextResponse.json({
    processed: 1,
    found: result.status === 'found' ? 1 : 0,
    remaining: remaining ?? 0,
    results: [{ company: company.company_name, owner: result.owner, status: result.status }],
  })
}
