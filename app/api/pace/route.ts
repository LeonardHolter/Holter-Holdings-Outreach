import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { query } from '@/lib/db'

// Data for the pace banner above the dialer: today's team call count and
// timestamps (for the rolling pace), plus the two previous days' totals so
// the client can work out whether today owes 120 under the ±1 rule.
//
// Counts come from companies.last_reach_out — the same source as the Today
// KPI and the streak on /stats, so the banner can never disagree with the
// page that judges the goal. Timestamps come from call_events, the only
// place per-call times exist.

export const dynamic = 'force-dynamic'

export async function GET() {
  const cookieStore = await cookies()
  if (cookieStore.get('session')?.value !== 'authenticated') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const [daily, events] = await Promise.all([
    query(
      `SELECT last_reach_out::text AS day, COUNT(*)::int AS n
       FROM companies
       WHERE last_reach_out >= CURRENT_DATE - 2
       GROUP BY 1`,
    ),
    query(
      `SELECT created_at
       FROM call_events
       WHERE created_at::date = CURRENT_DATE
       ORDER BY created_at ASC`,
    ),
  ])

  const byDay = new Map(daily.map(r => [String(r.day).slice(0, 10), Number(r.n)]))
  const dayStr = (offset: number) => {
    const d = new Date()
    d.setUTCDate(d.getUTCDate() - offset)
    return d.toISOString().slice(0, 10)
  }

  return NextResponse.json({
    callsToday: byDay.get(dayStr(0)) ?? 0,
    yesterday: byDay.get(dayStr(1)) ?? 0,
    dayBefore: byDay.get(dayStr(2)) ?? 0,
    timestamps: events.map(r => new Date(r.created_at).toISOString()),
  })
}
