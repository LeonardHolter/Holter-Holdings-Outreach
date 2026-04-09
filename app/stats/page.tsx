export const dynamic = 'force-dynamic'

import { createClient } from '@/lib/supabase/server'
import type { Company } from '@/types'
import { Nav } from '@/components/Nav'

async function fetchAll(): Promise<Company[]> {
  const supabase = await createClient()
  const all: Company[] = []
  const PAGE = 1000
  let from = 0
  while (true) {
    const { data } = await supabase
      .from('companies')
      .select('amount_of_calls,who_called,loi_sent,added_by')
      .range(from, from + PAGE - 1)
    const rows = (data as Company[]) ?? []
    all.push(...rows)
    if (rows.length < PAGE) break
    from += PAGE
  }
  return all
}

export default async function StatsPage() {
  const companies = await fetchAll()

  const callerMap: Record<string, { calls: number; lois: number }> = {}
  const adderMap: Record<string, number> = {}
  let totalCalls = 0
  let totalLois = 0

  for (const c of companies) {
    const calls = c.amount_of_calls ?? 0
    if (calls > 0) {
      totalCalls += calls
      if (c.loi_sent) totalLois++
      const name = c.who_called ?? 'Unknown'
      if (!callerMap[name]) callerMap[name] = { calls: 0, lois: 0 }
      callerMap[name].calls += calls
      if (c.loi_sent) callerMap[name].lois++
    }

    if (c.added_by) {
      adderMap[c.added_by] = (adderMap[c.added_by] ?? 0) + 1
    }
  }

  const callers = Object.entries(callerMap)
    .map(([name, { calls, lois }]) => ({ name, calls, lois }))
    .sort((a, b) => b.calls - a.calls)

  const adders = Object.entries(adderMap)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)

  const maxCalls = callers[0]?.calls ?? 1
  const overallLoiRate = totalCalls > 0 ? (totalLois / totalCalls * 100).toFixed(2) : '0.00'

  const colorMap: Record<string, string> = {
    leonard: 'bg-blue-500',
    tommaso: 'bg-violet-500',
    john: 'bg-emerald-500',
    sunzim: 'bg-amber-500',
    daniel: 'bg-rose-500',
    ellison: 'bg-cyan-500',
  }

  return (
    <div className="flex flex-col h-[100dvh] overflow-hidden bg-gray-950">
      <Nav />

      <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-6 space-y-6">
        <div>
          <h1 className="text-xl font-bold text-white">Stats</h1>
          <p className="text-sm text-gray-500 mt-0.5">All time</p>
        </div>

        {/* Top KPIs */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <KPI label="Total Calls" value={totalCalls.toLocaleString()} />
          <KPI label="LOIs Sent" value={totalLois.toString()} color="text-purple-400" />
          <KPI label="Calls to LOI" value={`${overallLoiRate}%`} color="text-green-400" sub={`${totalLois} LOI / ${totalCalls} calls`} />
        </div>

        {/* Calls leaderboard */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wide mb-4">Calls by Person</h2>
          <div className="space-y-3">
            {callers.length === 0 ? (
              <p className="text-gray-600 text-sm">No calls yet</p>
            ) : callers.map((c, i) => {
              const loiRate = c.calls > 0 ? (c.lois / c.calls * 100).toFixed(2) : '0.00'
              const barColor = colorMap[c.name.toLowerCase()] ?? 'bg-indigo-500'
              return (
                <div key={c.name} className="flex items-center gap-3">
                  <span className="text-lg w-7 text-center shrink-0">
                    {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : <span className="text-sm text-gray-600 font-bold">#{i + 1}</span>}
                  </span>
                  <span className="text-sm font-medium text-white w-20 shrink-0">{c.name}</span>
                  <div className="flex-1 bg-gray-800 rounded-full h-2 overflow-hidden">
                    <div className={`h-2 rounded-full ${barColor}`} style={{ width: `${(c.calls / maxCalls) * 100}%` }} />
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-sm font-bold tabular-nums text-white w-10 text-right">{c.calls}</span>
                    <span className="text-xs text-gray-500 w-20 text-right">LOI {loiRate}%</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Quick Adds leaderboard */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wide mb-4">Quick Adds by Person</h2>
          <div className="space-y-3">
            {adders.length === 0 ? (
              <p className="text-gray-600 text-sm">No tracked adds yet</p>
            ) : adders.map((a, i) => {
              const barColor = colorMap[a.name.toLowerCase()] ?? 'bg-indigo-500'
              const maxCount = adders[0].count
              return (
                <div key={a.name} className="flex items-center gap-3">
                  <span className="text-lg w-7 text-center shrink-0">
                    {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : <span className="text-sm text-gray-600 font-bold">#{i + 1}</span>}
                  </span>
                  <span className="text-sm font-medium text-white w-20 shrink-0">{a.name}</span>
                  <div className="flex-1 bg-gray-800 rounded-full h-2 overflow-hidden">
                    <div className={`h-2 rounded-full ${barColor}`} style={{ width: `${(a.count / maxCount) * 100}%` }} />
                  </div>
                  <span className="text-sm font-bold tabular-nums text-white w-10 text-right shrink-0">{a.count}</span>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

function KPI({ label, value, sub, color = 'text-white' }: {
  label: string; value: string; sub?: string; color?: string
}) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-4">
      <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">{label}</p>
      <p className={`text-2xl font-bold tabular-nums mt-1 ${color}`}>{value}</p>
      {sub && <p className="text-xs text-gray-500 mt-0.5">{sub}</p>}
    </div>
  )
}
