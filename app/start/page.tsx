'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

const CALLERS = ['Leonard', 'Tommaso', 'John', 'Henry'] as const

interface CallerStats {
  name: string
  calls: number
  lois: number
}

interface StatsData {
  today: CallerStats[]
  allTime: CallerStats[]
  totalCalls: number
  totalLois: number
}

const COLOR_MAP: Record<string, string> = {
  leonard: 'bg-blue-500',
  tommaso: 'bg-violet-500',
  john: 'bg-emerald-500',
  henry: 'bg-amber-500',
}

export default function StartPage() {
  const router = useRouter()
  const [selected, setSelected] = useState<string | null>(null)
  const [stats, setStats] = useState<StatsData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/stats/leaderboard')
      .then(r => r.json())
      .then((d: StatsData) => setStats(d))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  function handleNext() {
    if (!selected) return
    localStorage.setItem('sessionCaller', selected)
    router.push('/call')
  }

  const totalCalls = stats?.totalCalls ?? 0
  const totalLois = stats?.totalLois ?? 0
  const loiRate = totalCalls > 0 ? (totalLois / totalCalls * 100).toFixed(2) : '0.00'
  const callers = stats?.allTime ?? []
  const maxCalls = callers[0]?.calls ?? 1

  return (
    <div className="flex flex-col items-center min-h-[100dvh] bg-gray-950 px-4 py-8">
      <div className="w-full max-w-lg space-y-6">

        {/* Header */}
        <div className="text-center space-y-1">
          <h1 className="text-2xl font-bold text-white">Holter Holdings</h1>
          <p className="text-sm text-gray-500">Outreach CRM</p>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-3 gap-3">
          <KPI label="Total Calls" value={loading ? '—' : totalCalls.toLocaleString()} />
          <KPI label="LOIs Sent" value={loading ? '—' : totalLois.toString()} color="text-purple-400" />
          <KPI label="Calls to LOI" value={loading ? '—' : `${loiRate}%`} color="text-green-400" />
        </div>

        {/* Calls leaderboard */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
          <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wide mb-4">Calls by Person</h2>
          {loading ? (
            <div className="space-y-2">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-8 bg-gray-800 rounded-lg animate-pulse" style={{ opacity: 1 - i * 0.2 }} />
              ))}
            </div>
          ) : callers.length === 0 ? (
            <p className="text-gray-600 text-sm text-center py-4">No calls yet</p>
          ) : (
            <div className="space-y-3">
              {callers.map((c, i) => {
                const perLoiRate = c.calls > 0 ? (c.lois / c.calls * 100).toFixed(2) : '0.00'
                const barColor = COLOR_MAP[c.name.toLowerCase()] ?? 'bg-indigo-500'
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
                      <span className="text-xs text-gray-500 w-20 text-right">LOI {perLoiRate}%</span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Caller picker */}
        <div className="space-y-3">
          <p className="text-sm text-gray-400 font-medium text-center">Who are you?</p>
          <div className="grid grid-cols-4 gap-2">
            {CALLERS.map(name => (
              <button
                key={name}
                onClick={() => setSelected(name)}
                className={`py-3 rounded-xl text-sm font-semibold transition-all active:scale-[0.97] ${
                  selected === name
                    ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20 ring-2 ring-blue-500/50'
                    : 'bg-gray-800 text-gray-300 border border-gray-700 hover:border-gray-600 hover:text-white'
                }`}
              >
                {name}
              </button>
            ))}
          </div>
        </div>

        {/* Next button */}
        <button
          onClick={handleNext}
          disabled={!selected}
          className="w-full py-3.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-sm transition-all active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-blue-600/10"
        >
          Let&apos;s go →
        </button>
      </div>
    </div>
  )
}

function KPI({ label, value, color = 'text-white' }: {
  label: string; value: string; color?: string
}) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl px-4 py-4">
      <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">{label}</p>
      <p className={`text-2xl font-bold tabular-nums mt-1 ${color}`}>{value}</p>
    </div>
  )
}
