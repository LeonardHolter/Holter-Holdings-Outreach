import { NextResponse } from 'next/server'
import { query } from '@/lib/db'

// All-time WON deals per caller, for the leaderboard banner in the nav.
//
// Attribution mirrors the Won list on /demos exactly, so the two never
// disagree: prefer whoever actually booked the demo (latest 'Demo booked'
// call event), fall back to companies.who_called, and finally infer from the
// per-person counters when only one of us ever dialled the company. A win we
// cannot attribute to anyone is simply left uncounted rather than guessed.
//
// The roster is fixed at two because calls_leonard / calls_william are baked
// into the schema; the response stays a sorted array so the UI is
// roster-agnostic and a third caller only needs a migration + one line here.

export const dynamic = 'force-dynamic'

export interface LeaderRow {
  name: string
  wins: number
}

const ROSTER = ['Leonard', 'William']

export async function GET() {
  try {
    const rows = await query(
      `SELECT
         COALESCE(
           b.booked_by,
           c.who_called,
           CASE
             WHEN COALESCE(c.calls_leonard, 0) > 0 AND COALESCE(c.calls_william, 0) = 0 THEN 'Leonard'
             WHEN COALESCE(c.calls_william, 0) > 0 AND COALESCE(c.calls_leonard, 0) = 0 THEN 'William'
           END
         ) AS closed_by,
         COUNT(*)::int AS wins
       FROM companies c
       LEFT JOIN LATERAL (
         SELECT caller_name AS booked_by
         FROM call_events
         WHERE company_id = c.id AND response = 'Demo booked' AND caller_name IS NOT NULL
         ORDER BY created_at DESC
         LIMIT 1
       ) b ON true
       WHERE c.demo_outcome = 'Won'
       GROUP BY 1`,
    )

    // Names come from free-text columns — fold them onto the roster so a
    // stray 'leonard' doesn't split into its own entry.
    const tally = new Map(ROSTER.map(n => [n, 0]))
    for (const r of rows as Record<string, unknown>[]) {
      const raw = typeof r.closed_by === 'string' ? r.closed_by.trim().toLowerCase() : ''
      const name = ROSTER.find(n => n.toLowerCase() === raw)
      if (name) tally.set(name, (tally.get(name) ?? 0) + (Number(r.wins) || 0))
    }

    const leaders: LeaderRow[] = ROSTER.map(name => ({ name, wins: tally.get(name) ?? 0 })).sort(
      (a, b) => b.wins - a.wins,
    )
    return NextResponse.json({ leaders })
  } catch {
    // A banner is decoration — never let it 500 a page load.
    return NextResponse.json({ leaders: [] })
  }
}
