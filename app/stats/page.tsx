export const dynamic = 'force-dynamic'

import { query } from '@/lib/db'
import { Nav } from '@/components/Nav'
import { DailyStats } from '@/components/DailyStats'

export interface DayData {
  date: string   // 'YYYY-MM-DD'
  total: number
  leonard: number
  william: number
}

async function fetchCallData(): Promise<DayData[]> {
  const rows = await query(`
    SELECT
      DATE(last_reach_out) AS date,
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE who_called = 'Leonard') AS leonard,
      COUNT(*) FILTER (WHERE who_called = 'William') AS william
    FROM companies
    WHERE last_reach_out IS NOT NULL
      AND last_reach_out >= CURRENT_DATE - INTERVAL '364 days'
    GROUP BY DATE(last_reach_out)
    ORDER BY date ASC
  `)

  return rows.map(r => ({
    date: String(r.date).slice(0, 10),
    total: Number(r.total),
    leonard: Number(r.leonard),
    william: Number(r.william),
  }))
}

export default async function StatsPage() {
  const data = await fetchCallData()

  return (
    <div className="flex flex-col h-[100dvh] overflow-hidden bg-gray-950">
      <Nav />
      <div className="flex-1 overflow-auto px-4 py-6">
        <DailyStats data={data} />
      </div>
    </div>
  )
}
