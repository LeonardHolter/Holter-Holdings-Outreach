'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

const CALLERS = ['Leonard', 'Tommaso', 'John'] as const

interface CallerStats {
  name: string
  calls: number
}

const MEDALS = ['🥇', '🥈', '🥉']

function LeaderboardSection({
  title,
  data,
  loading,
}: {
  title: string
  data: CallerStats[]
  loading: boolean
}) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
      <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">{title}</h3>
      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-10 bg-gray-800 rounded-lg animate-pulse" style={{ opacity: 1 - i * 0.2 }} />
          ))}
        </div>
      ) : data.length === 0 ? (
        <p className="text-sm text-gray-600 py-4 text-center">No calls recorded yet</p>
      ) : (
        <div className="space-y-1.5">
          {data.map((entry, i) => (
            <div
              key={entry.name}
              className={`flex items-center justify-between px-3.5 py-2.5 rounded-xl transition-colors ${
                i === 0
                  ? 'bg-yellow-900/20 border border-yellow-700/30'
                  : 'bg-gray-800/50'
              }`}
            >
              <div className="flex items-center gap-3">
                <span className="text-lg w-7 text-center">{MEDALS[i] ?? `#${i + 1}`}</span>
                <span className={`font-medium ${i === 0 ? 'text-white' : 'text-gray-300'}`}>{entry.name}</span>
              </div>
              <span className={`tabular-nums font-semibold ${i === 0 ? 'text-yellow-400' : 'text-gray-400'}`}>
                {entry.calls}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function StartPage() {
  const router = useRouter()
  const [selected, setSelected] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null
    const saved = localStorage.getItem('sessionCaller')
    return saved && CALLERS.includes(saved as (typeof CALLERS)[number]) ? saved : null
  })
  const [today, setToday] = useState<CallerStats[]>([])
  const [allTime, setAllTime] = useState<CallerStats[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/stats/leaderboard')
      .then(r => r.json())
      .then((d: { today: CallerStats[]; allTime: CallerStats[] }) => {
        setToday(d.today ?? [])
        setAllTime(d.allTime ?? [])
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  function handleNext() {
    if (!selected) return
    localStorage.setItem('sessionCaller', selected)
    router.push('/pipeline')
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-[100dvh] bg-gray-950 px-4 py-8">
      <div className="w-full max-w-md space-y-6">

        {/* Header */}
        <div className="text-center space-y-1">
          <h1 className="text-2xl font-bold text-white">Holter Holdings</h1>
          <p className="text-sm text-gray-500">Outreach CRM</p>
        </div>

        {/* Caller picker */}
        <div className="space-y-3">
          <p className="text-sm text-gray-400 font-medium text-center">Who are you?</p>
          <div className="grid grid-cols-3 gap-2">
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

        {/* Leaderboards */}
        <div className="space-y-3">
          <LeaderboardSection title="Today" data={today} loading={loading} />
          <LeaderboardSection title="All Time" data={allTime} loading={loading} />
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
