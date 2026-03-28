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
        .from('companies')
        .select('who_called, amount_of_calls')
        .not('who_called', 'is', null),
    ])

    function tallyToday(rows: Array<{ called_by: string | null }> | null): CallerStats[] {
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

    // Match exactly how /stats calculates "Most Calls": sum amount_of_calls per who_called
    const callVolumeMap: Record<string, number> = {}
    for (const row of (allTimeRes.data ?? []) as Array<{ who_called: string | null; amount_of_calls: number }>) {
      const name = (row.who_called ?? '').trim()
      if (!name) continue
      callVolumeMap[name] = (callVolumeMap[name] ?? 0) + (row.amount_of_calls ?? 0)
    }
    const allTime: CallerStats[] = Object.entries(callVolumeMap)
      .map(([name, calls]) => ({ name, calls }))
      .filter(s => s.calls > 0)
      .sort((a, b) => b.calls - a.calls)

    return NextResponse.json({
      today: tallyToday(todayRes.data),
      allTime,
    })
  } catch (err) {
    console.error('[leaderboard]', err)
    return NextResponse.json({ today: [], allTime: [] }, { status: 200 })
  }
}
