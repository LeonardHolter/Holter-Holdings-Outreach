import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { Company } from '@/types'

interface CallerStats {
  name: string
  calls: number
  lois: number
}

export async function GET() {
  try {
    const supabase = await createClient()
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)

    // Paginate companies to bypass 1000-row cap
    const allCompanies: Pick<Company, 'who_called' | 'amount_of_calls' | 'loi_sent'>[] = []
    const PAGE = 1000
    let from = 0
    while (true) {
      const { data } = await supabase
        .from('companies')
        .select('who_called, amount_of_calls, loi_sent')
        .range(from, from + PAGE - 1)
      const rows = data ?? []
      allCompanies.push(...rows)
      if (rows.length < PAGE) break
      from += PAGE
    }

    const todayRes = await supabase
      .from('call_recordings')
      .select('called_by')
      .not('called_by', 'is', null)
      .gte('called_at', todayStart.toISOString())

    function tallyToday(rows: Array<{ called_by: string | null }> | null): CallerStats[] {
      const counts: Record<string, number> = {}
      for (const row of rows ?? []) {
        const name = (row.called_by ?? '').trim()
        if (!name) continue
        counts[name] = (counts[name] ?? 0) + 1
      }
      return Object.entries(counts)
        .map(([name, calls]) => ({ name, calls, lois: 0 }))
        .sort((a, b) => b.calls - a.calls)
    }

    const callerMap: Record<string, { calls: number; lois: number }> = {}
    let totalCalls = 0
    let totalLois = 0

    for (const c of allCompanies) {
      const calls = c.amount_of_calls ?? 0
      if (calls === 0) continue
      totalCalls += calls
      if (c.loi_sent) totalLois++

      const name = (c.who_called ?? '').trim()
      if (!name) continue
      if (!callerMap[name]) callerMap[name] = { calls: 0, lois: 0 }
      callerMap[name].calls += calls
      if (c.loi_sent) callerMap[name].lois++
    }

    const allTime: CallerStats[] = Object.entries(callerMap)
      .map(([name, { calls, lois }]) => ({ name, calls, lois }))
      .filter(s => s.calls > 0)
      .sort((a, b) => b.calls - a.calls)

    return NextResponse.json({
      today: tallyToday(todayRes.data),
      allTime,
      totalCalls,
      totalLois,
    })
  } catch (err) {
    console.error('[leaderboard]', err)
    return NextResponse.json({ today: [], allTime: [], totalCalls: 0, totalLois: 0 }, { status: 200 })
  }
}
