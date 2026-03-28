import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

interface CallerStats {
  name: string
  calls: number
}

export async function GET() {
  try {
    const supabase = await createClient()
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)

    const [todayRes, allTimeRes] = await Promise.all([
      supabase
        .from('call_recordings')
        .select('called_by')
        .not('called_by', 'is', null)
        .gte('called_at', todayStart.toISOString()),
      supabase
        .from('call_recordings')
        .select('called_by')
        .not('called_by', 'is', null),
    ])

    function tally(rows: Array<{ called_by: string | null }> | null): CallerStats[] {
      const counts: Record<string, number> = {}
      for (const row of rows ?? []) {
        const name = (row.called_by ?? '').trim()
        if (!name) continue
        counts[name] = (counts[name] ?? 0) + 1
      }
      return Object.entries(counts)
        .map(([name, calls]) => ({ name, calls }))
        .sort((a, b) => b.calls - a.calls)
    }

    return NextResponse.json({
      today: tally(todayRes.data),
      allTime: tally(allTimeRes.data),
    })
  } catch (err) {
    console.error('[leaderboard]', err)
    return NextResponse.json({ today: [], allTime: [] }, { status: 200 })
  }
}
