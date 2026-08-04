import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { query } from '@/lib/db'

// Data for the pace banner above the dialer: today's call count and
// timestamps (for the rolling pace), plus the two previous days' totals so
// the client can work out whether today owes 120 under the ±1 rule.
//
// The goal is PER CALLER — William can owe 120 while Leonard only needs his
// 60 — so pass ?caller=Name to scope everything to one person. Without it
// the numbers are team-wide.
//
// Counts come from companies.last_reach_out/who_called — the same source as
// the Today KPI and per-person breakdown on /stats, so the banner can never
// disagree with the page that judges the goal. Timestamps come from
// call_events, the only place per-call times exist.

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const cookieStore = await cookies()
  if (cookieStore.get('session')?.value !== 'authenticated') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const caller = req.nextUrl.searchParams.get('caller')?.trim() || null

  const [daily, events] = await Promise.all([
    query(
      `SELECT last_reach_out::text AS day, COUNT(*)::int AS n
       FROM companies
       WHERE last_reach_out >= CURRENT_DATE - 2
         AND ($1::text IS NULL OR who_called = $1)
       GROUP BY 1`,
      [caller],
    ),
    query(
      `SELECT created_at
       FROM call_events
       WHERE created_at::date = CURRENT_DATE
         AND ($1::text IS NULL OR caller_name = $1)
       ORDER BY created_at ASC`,
      [caller],
    ),
  ])

  const byDay = new Map(daily.map(r => [String(r.day).slice(0, 10), Number(r.n)]))
  const dayStr = (offset: number) => {
    const d = new Date()
    d.setUTCDate(d.getUTCDate() - offset)
    return d.toISOString().slice(0, 10)
  }

  return NextResponse.json({
    caller,
    callsToday: byDay.get(dayStr(0)) ?? 0,
    yesterday: byDay.get(dayStr(1)) ?? 0,
    dayBefore: byDay.get(dayStr(2)) ?? 0,
    timestamps: events.map(r => new Date(r.created_at).toISOString()),
  })
}
