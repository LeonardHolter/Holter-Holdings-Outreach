import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@/lib/supabase/server'

const BATCH_SIZE = 10

// GET — how many companies are still missing an owner
export async function GET() {
  const supabase = await createClient()
  const { count } = await supabase
    .from('companies')
    .select('id', { count: 'exact', head: true })
    .or('owners_name.is.null,owners_name.eq.')

  return NextResponse.json({ missing: count ?? 0 })
}

// POST — enrich one batch of BATCH_SIZE companies
export async function POST() {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY is not set' }, { status: 500 })
  }

  const supabase = await createClient()
  const anthropic = new Anthropic({ apiKey })

  // Fetch next batch of companies missing an owner
  const { data: companies, error } = await supabase
    .from('companies')
    .select('id, company_name, state')
    .or('owners_name.is.null,owners_name.eq.')
    .limit(BATCH_SIZE)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!companies || companies.length === 0) {
    return NextResponse.json({ processed: 0, found: 0, remaining: 0, results: [] })
  }

  const results: { company: string; owner: string | null; status: string }[] = []

  for (const company of companies) {
    try {
      const location = company.state ? ` in ${company.state}` : ''
      const prompt =
        `Search for the current owner or founder of "${company.company_name}", a garage door company${location}. ` +
        `Reply with ONLY the person's full name (e.g. "John Smith"). ` +
        `If you cannot find a specific owner name, reply with exactly: UNKNOWN`

      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 256,
        tools: [{ type: 'web_search_20250305' as const, name: 'web_search' }],
        messages: [{ role: 'user', content: prompt }],
      })

      // Extract the final text block Claude produces after searching
      let ownerName = 'UNKNOWN'
      for (const block of response.content) {
        if (block.type === 'text') {
          ownerName = block.text.trim()
          break
        }
      }

      const isValid =
        ownerName !== 'UNKNOWN' &&
        ownerName.length > 1 &&
        ownerName.length < 80 &&
        !ownerName.toLowerCase().includes('i could not') &&
        !ownerName.toLowerCase().includes('i was unable') &&
        !ownerName.toLowerCase().includes('not find') &&
        !ownerName.toLowerCase().includes('no information')

      if (isValid) {
        await supabase
          .from('companies')
          .update({ owners_name: ownerName })
          .eq('id', company.id)
        results.push({ company: company.company_name, owner: ownerName, status: 'found' })
      } else {
        // Mark with a placeholder so we don't re-query it every run
        await supabase
          .from('companies')
          .update({ owners_name: 'Not found' })
          .eq('id', company.id)
        results.push({ company: company.company_name, owner: null, status: 'not_found' })
      }
    } catch {
      results.push({ company: company.company_name, owner: null, status: 'error' })
    }

    // Brief pause between requests to respect rate limits
    await new Promise(r => setTimeout(r, 300))
  }

  // Count how many still remain after this batch
  const { count: remaining } = await supabase
    .from('companies')
    .select('id', { count: 'exact', head: true })
    .or('owners_name.is.null,owners_name.eq.')

  return NextResponse.json({
    processed: results.length,
    found: results.filter(r => r.status === 'found').length,
    remaining: remaining ?? 0,
    results,
  })
}
