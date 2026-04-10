import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const supabase = await createClient()

    // Supabase JS doesn't support raw GROUP BY, so fetch distinct states
    // with counts using an RPC or a workaround. The simplest approach:
    // fetch all scraped companies' states and count client-side.
    // For large datasets this is still fast since we only select one column.
    const counts: Record<string, number> = {}
    const PAGE = 1000
    let from = 0

    while (true) {
      const { data, error } = await supabase
        .from('companies')
        .select('state')
        .not('google_place_id', 'is', null)
        .range(from, from + PAGE - 1)

      if (error) throw error
      const rows = data ?? []
      for (const row of rows) {
        const st = row.state
        if (st) counts[st] = (counts[st] ?? 0) + 1
      }
      if (rows.length < PAGE) break
      from += PAGE
    }

    return NextResponse.json(counts)
  } catch (err) {
    console.error('[scrape/counts]', err)
    return NextResponse.json({}, { status: 200 })
  }
}
