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
// Counts come from call_events, the immutable one-row-per-call ledger (the
// same source as /stats). They must NOT come from companies.last_reach_out/
// who_called: that's the company's LATEST state, so every re-call rewrites
// history — the previous caller's count drops and a company dialed twice
// counts once. Days are bucketed in Europe/Oslo, matching the dates the
// dialer writes.

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const cookieStore = await cookies()
  if (cookieStore.get('session')?.value !== 'authenticated') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const caller = req.nextUrl.searchParams.get('caller')?.trim() || null

  const [daily, events] = await Promise.all([
    query(
      `SELECT (created_at AT TIME ZONE 'Europe/Oslo')::date::text AS day, COUNT(*)::int AS n
       FROM call_events
       WHERE created_at >= NOW() - INTERVAL '4 days'
         AND ($1::text IS NULL OR caller_name = $1)
       GROUP BY 1`,
      [caller],
    ),
    query(
      `SELECT created_at
       FROM call_events
       WHERE (created_at AT TIME ZONE 'Europe/Oslo')::date = (NOW() AT TIME ZONE 'Europe/Oslo')::date
         AND ($1::text IS NULL OR caller_name = $1)
       ORDER BY created_at ASC`,
      [caller],
    ),
  ])

  const byDay = new Map(daily.map(r => [String(r.day).slice(0, 10), Number(r.n)]))
  // Day strings must be Oslo-local to line up with the SQL bucketing above —
  // the server itself runs in UTC.
  const dayStr = (offset: number) => {
    const d = new Date(Date.now() - offset * 86400000)
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Oslo' }).format(d)
  }

  return NextResponse.json({
    caller,
    callsToday: byDay.get(dayStr(0)) ?? 0,
    yesterday: byDay.get(dayStr(1)) ?? 0,
    dayBefore: byDay.get(dayStr(2)) ?? 0,
    timestamps: events.map(r => new Date(r.created_at).toISOString()),
  })
}
