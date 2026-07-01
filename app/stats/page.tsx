export const dynamic = 'force-dynamic'

import { query } from '@/lib/db'
import { Nav } from '@/components/Nav'
import { DailyStats } from '@/components/DailyStats'

// One row per (day, caller, outcome). The component derives all daily / weekly
// / overall + per-person metrics from these.
export interface StatRow {
  date: string // 'YYYY-MM-DD'
  who_called: string | null
  reach_out_response: string | null
  n: number
}

// One row per logged call. Unlike StatRow (derived from companies' latest
// state), this is a true event log — it powers dials-per-demo, decision-maker
// conversion, time-of-day, callback conversion, and revenue-tier performance.
export interface CallEvent {
  company_id: string | null
  caller_name: string | null
  response: string
  reached_decision_maker: boolean | null
  revenue_at_call: number | null
  created_at: string // ISO timestamp
}

export interface DemoOutcomeCount {
  demo_outcome: string | null
  n: number
}

async function fetchStatRows(): Promise<StatRow[]> {
  const rows = await query(`
    SELECT
      DATE(last_reach_out) AS date,
      who_called,
      reach_out_response,
      COUNT(*)::int AS n
    FROM companies
    WHERE last_reach_out IS NOT NULL
      AND last_reach_out >= CURRENT_DATE - INTERVAL '364 days'
    GROUP BY DATE(last_reach_out), who_called, reach_out_response
  `)
  return rows.map(r => ({
    date: String(r.date).slice(0, 10),
    who_called: r.who_called,
    reach_out_response: r.reach_out_response,
    n: Number(r.n),
  }))
}

async function fetchCallEvents(): Promise<CallEvent[]> {
  const rows = await query(`
    SELECT company_id, caller_name, response, reached_decision_maker, revenue_at_call, created_at
    FROM call_events
    ORDER BY created_at ASC
  `)
  return rows.map(r => ({
    company_id: r.company_id,
    caller_name: r.caller_name,
    response: r.response,
    reached_decision_maker: r.reached_decision_maker,
    revenue_at_call: r.revenue_at_call != null ? Number(r.revenue_at_call) : null,
    created_at: new Date(r.created_at).toISOString(),
  }))
}

async function fetchDemoOutcomes(): Promise<DemoOutcomeCount[]> {
  const rows = await query(`
    SELECT demo_outcome, COUNT(*)::int AS n
    FROM companies
    WHERE reach_out_response = 'Demo booked'
    GROUP BY demo_outcome
  `)
  return rows.map(r => ({ demo_outcome: r.demo_outcome, n: Number(r.n) }))
}

export default async function StatsPage() {
  const [rows, events, demoOutcomes] = await Promise.all([
    fetchStatRows(),
    fetchCallEvents(),
    fetchDemoOutcomes(),
  ])

  return (
    <div className="flex flex-col h-[100dvh] overflow-hidden bg-gray-950">
      <Nav />
      <div className="flex-1 overflow-auto px-4 py-6">
        <DailyStats rows={rows} events={events} demoOutcomes={demoOutcomes} />
      </div>
    </div>
  )
}
