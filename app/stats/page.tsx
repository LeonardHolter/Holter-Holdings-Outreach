export const dynamic = 'force-dynamic'

import { query } from '@/lib/db'
import { Nav } from '@/components/Nav'
import { DailyStats } from '@/components/DailyStats'
import { winsByCaller, type LeaderRow } from '@/lib/winsByCaller'

// One row per (day, caller, outcome). The component derives all daily / weekly
// / overall + per-person metrics from these.
export interface StatRow {
  date: string // 'YYYY-MM-DD'
  who_called: string | null
  reach_out_response: string | null
  demo_outcome: string | null
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
  /** Company's industry (from the companies join); null for deleted
   *  companies or before the industry migration has run. */
  industry: string | null
  created_at: string // ISO timestamp
}

export interface DemoOutcomeCount {
  demo_outcome: string | null
  n: number
}

export interface IndustryWinCount {
  industry: string | null
  n: number
}

async function fetchStatRows(): Promise<StatRow[]> {
  const rows = await query(`
    SELECT
      DATE(last_reach_out) AS date,
      who_called,
      reach_out_response,
      demo_outcome,
      COUNT(*)::int AS n
    FROM companies
    WHERE last_reach_out IS NOT NULL
      AND last_reach_out >= CURRENT_DATE - INTERVAL '364 days'
    GROUP BY DATE(last_reach_out), who_called, reach_out_response, demo_outcome
  `)
  return rows.map(r => ({
    date: String(r.date).slice(0, 10),
    who_called: r.who_called,
    reach_out_response: r.reach_out_response,
    demo_outcome: r.demo_outcome,
    n: Number(r.n),
  }))
}

async function fetchCallEvents(): Promise<CallEvent[]> {
  // Industry lives on companies, not the event log — events made before the
  // industry migration (or on since-deleted companies) resolve to NULL. The
  // fallback query keeps /stats alive if the industry column doesn't exist
  // yet, so the code can deploy ahead of the migration.
  let rows
  try {
    rows = await query(`
      SELECT e.company_id, e.caller_name, e.response, e.reached_decision_maker,
             e.revenue_at_call, e.created_at, c.industry
      FROM call_events e
      LEFT JOIN companies c ON c.id = e.company_id
      ORDER BY e.created_at ASC
    `)
  } catch {
    rows = await query(`
      SELECT company_id, caller_name, response, reached_decision_maker, revenue_at_call, created_at
      FROM call_events
      ORDER BY created_at ASC
    `)
  }
  return rows.map(r => ({
    company_id: r.company_id,
    caller_name: r.caller_name,
    response: r.response,
    reached_decision_maker: r.reached_decision_maker,
    revenue_at_call: r.revenue_at_call != null ? Number(r.revenue_at_call) : null,
    industry: (r.industry as string | null) ?? null,
    created_at: new Date(r.created_at).toISOString(),
  }))
}

async function fetchIndustryWins(): Promise<IndustryWinCount[]> {
  // Wins live on companies (demo_outcome), not the event log. Tolerate the
  // industry column not existing so /stats deploys ahead of the migration.
  try {
    const rows = await query(`
      SELECT industry, COUNT(*)::int AS n
      FROM companies
      WHERE demo_outcome = 'Won'
      GROUP BY industry
    `)
    return rows.map(r => ({ industry: r.industry as string | null, n: Number(r.n) }))
  } catch {
    return []
  }
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
  const [rows, events, demoOutcomes, industryWins, callerWins] = await Promise.all([
    fetchStatRows(),
    fetchCallEvents(),
    fetchDemoOutcomes(),
    fetchIndustryWins(),
    winsByCaller().catch((): LeaderRow[] => []),
  ])

  return (
    <div className="flex flex-col h-[100dvh] overflow-hidden bg-gray-950">
      <Nav />
      <div className="flex-1 overflow-auto px-4 py-6">
        <DailyStats rows={rows} events={events} demoOutcomes={demoOutcomes} industryWins={industryWins} callerWins={callerWins} />
      </div>
    </div>
  )
}
