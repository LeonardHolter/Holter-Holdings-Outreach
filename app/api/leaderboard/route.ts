import { NextResponse } from 'next/server'
import { query } from '@/lib/db'

// All-time call counts per caller, for the leaderboard banner in the nav.
//
// Source is companies.calls_leonard / calls_william — the per-person counters
// CallingSession increments on every saved outcome. Chosen over call_events
// (which is one row per call, but was added later so it misses early history)
// and over who_called (which only remembers the LAST caller of each company,
// so it would misattribute every re-dial).
//
// The two columns are baked into the schema, so this is a two-person query by
// necessity; the response is a sorted array so the UI stays roster-agnostic
// and a third caller only needs a migration + one line here.

export const dynamic = 'force-dynamic'

export interface LeaderRow {
  name: string
  calls: number
}

export async function GET() {
  try {
    const rows = await query(
      `SELECT
         COALESCE(SUM(calls_leonard), 0)::int AS leonard,
         COALESCE(SUM(calls_william), 0)::int AS william
       FROM companies`,
    )
    const r = rows[0] ?? { leonard: 0, william: 0 }
    const leaders: LeaderRow[] = [
      { name: 'Leonard', calls: Number(r.leonard) || 0 },
      { name: 'William', calls: Number(r.william) || 0 },
    ].sort((a, b) => b.calls - a.calls)
    return NextResponse.json({ leaders })
  } catch {
    // A banner is decoration — never let it 500 a page load.
    return NextResponse.json({ leaders: [] })
  }
}
