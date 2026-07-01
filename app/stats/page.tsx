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

export default async function StatsPage() {
  const rows = await fetchStatRows()

  return (
    <div className="flex flex-col h-[100dvh] overflow-hidden bg-gray-950">
      <Nav />
      <div className="flex-1 overflow-auto px-4 py-6">
        <DailyStats rows={rows} />
      </div>
    </div>
  )
}
