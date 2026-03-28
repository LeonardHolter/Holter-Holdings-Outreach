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
        .select('calls_leonard, calls_tommaso, calls_john')
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

    const allTimeColumns: Array<{ key: string; name: string }> = [
      { key: 'calls_leonard', name: 'Leonard' },
      { key: 'calls_tommaso', name: 'Tommaso' },
      { key: 'calls_john', name: 'John' },
    ]
    const allTime: CallerStats[] = allTimeColumns
      .map(({ key, name }) => ({
        name,
        calls: (allTimeRes.data ?? []).reduce(
          (sum: number, row: Record<string, number>) => sum + (row[key] ?? 0), 0
        ),
      }))
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
