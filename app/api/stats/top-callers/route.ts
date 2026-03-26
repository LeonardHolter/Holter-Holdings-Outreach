import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  try {
    const supabase = await createClient()
    const start = new Date()
    start.setHours(0, 0, 0, 0)

    const { data, error } = await supabase
      .from('call_recordings')
      .select('called_by, called_at')
      .not('called_by', 'is', null)
      .gte('called_at', start.toISOString())

    if (error) throw error

    const counts: Record<string, number> = {}
    for (const row of data ?? []) {
      const name = (row.called_by ?? '').trim()
      if (!name) continue
      counts[name] = (counts[name] ?? 0) + 1
    }

    const top = Object.entries(counts)
      .map(([name, calls]) => ({ name, calls }))
      .sort((a, b) => b.calls - a.calls)
      .slice(0, 3)

    return NextResponse.json({ top })
  } catch (err) {
    console.error('[top-callers]', err)
    return NextResponse.json({ top: [] }, { status: 200 })
  }
}
