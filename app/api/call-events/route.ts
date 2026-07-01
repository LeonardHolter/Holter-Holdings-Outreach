import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { query } from '@/lib/db'

// POST /api/call-events — log one call outcome. Unlike `companies`, which only
// holds the latest state, this is an append-only event log used for trend
// stats (dials-per-demo, decision-maker conversion, time-of-day, etc).
export async function POST(req: NextRequest) {
  const cookieStore = await cookies()
  if (cookieStore.get('session')?.value !== 'authenticated') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { company_id, caller_name, response, reached_decision_maker, revenue_at_call, script } = await req.json()
  if (!response) {
    return NextResponse.json({ error: 'response required' }, { status: 400 })
  }

  const rows = await query(
    `INSERT INTO call_events (company_id, caller_name, response, reached_decision_maker, revenue_at_call, script)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, created_at`,
    [company_id ?? null, caller_name ?? null, response, reached_decision_maker ?? null, revenue_at_call ?? null, script?.trim() || null]
  )
  return NextResponse.json(rows[0])
}
