'use client'

import { useState } from 'react'
import { toast } from 'sonner'

interface NumberEntry {
  number: string
  dialCount: number
  dailyCap: number
}

interface SpamResult {
  isSpam: boolean
  reportCount: number
  lastReported: string | null
  error?: string
}

const CALLERS = ['Leonard', 'Tommaso', 'John', 'Henry']

function dayOfYear() {
  const now = new Date()
  const start = new Date(now.getFullYear(), 0, 0)
  return Math.floor((now.getTime() - start.getTime()) / 86_400_000)
}

function assignedCallers(numIndex: number, numCount: number): string[] {
  return CALLERS.filter((_, ci) => (ci + dayOfYear()) % numCount === numIndex)
}

export default function NumberHealthClient({ initial }: { initial: NumberEntry[] }) {
  const [entries] = useState<NumberEntry[]>(initial)
  const [spamData, setSpamData]     = useState<Record<string, SpamResult>>({})
  const [checking, setChecking]     = useState(false)

  async function runSpamCheck() {
    setChecking(true)
    try {
      const res = await fetch('/api/number-health')
      if (!res.ok) { toast.error('Spam check failed'); return }
      const data: (SpamResult & { raw: string })[] = await res.json()
      const map: Record<string, SpamResult> = {}
      for (const d of data) map[d.raw] = d
      setSpamData(map)
      const flagged = data.filter(d => d.isSpam || d.reportCount > 0)
      if (flagged.length === 0) toast.success('All numbers are clean ✓')
      else toast.warning(`${flagged.length} number${flagged.length > 1 ? 's' : ''} flagged`)
    } catch { toast.error('Spam check failed') }
    finally { setChecking(false) }
  }

  const allChecked = entries.every(e => spamData[e.number] !== undefined)
  const anyFlagged = Object.values(spamData).some(s => s.isSpam || s.reportCount > 0)

  return (
    <div className="space-y-4">

      {/* Status summary */}
      {allChecked && (
        <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${
          anyFlagged
            ? 'border-red-800 bg-red-950/30 text-red-300'
            : 'border-green-800 bg-green-950/30 text-green-300'
        }`}>
          <span className="text-xl">{anyFlagged ? '⚠️' : '✅'}</span>
          <span className="text-sm font-medium">
            {anyFlagged ? 'One or more numbers are flagged as spam' : 'All numbers are clean — no spam reports'}
          </span>
        </div>
      )}

      {/* Number cards */}
      <div className="space-y-3">
        {entries.map((entry, i) => {
          const pct     = Math.min((entry.dialCount / entry.dailyCap) * 100, 100)
          const warning = pct >= 75
          const danger  = pct >= 95
          const barColor = danger ? 'bg-red-500' : warning ? 'bg-yellow-500' : 'bg-green-500'
          const dialLabel = danger ? 'At cap' : warning ? 'Near cap' : 'Healthy'
          const spam    = spamData[entry.number]
          const callers = assignedCallers(i, entries.length)

          return (
            <div key={entry.number} className="bg-gray-900 border border-gray-800 rounded-2xl p-5 space-y-4">
              {/* Header row */}
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-white font-mono font-semibold text-lg">{entry.number}</p>
                  <p className="text-gray-500 text-xs mt-0.5">
                    Today&apos;s callers: {callers.length > 0 ? callers.join(', ') : '—'}
                  </p>
                </div>
                {/* Spam badge */}
                {spam && !spam.error && (
                  spam.isSpam || spam.reportCount > 0 ? (
                    <span className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-semibold bg-red-950/60 border border-red-700 text-red-300">
                      ⚠ {spam.reportCount} report{spam.reportCount !== 1 ? 's' : ''}
                    </span>
                  ) : (
                    <span className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-semibold bg-green-950/60 border border-green-800 text-green-400">
                      ✓ Clean
                    </span>
                  )
                )}
                {spam?.error && (
                  <span className="shrink-0 text-xs text-gray-600 px-3 py-1.5">Check failed</span>
                )}
                {!spam && !checking && (
                  <span className="shrink-0 text-xs text-gray-700 px-3 py-1.5">Not checked</span>
                )}
                {checking && !spam && (
                  <span className="shrink-0 flex items-center gap-1.5 text-xs text-gray-500 px-3 py-1.5">
                    <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                    </svg>
                    Checking…
                  </span>
                )}
              </div>

              {/* Dial usage */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-500">Dials today</span>
                  <span className={danger ? 'text-red-400 font-semibold' : warning ? 'text-yellow-400 font-semibold' : 'text-gray-400'}>
                    {entry.dialCount} / {entry.dailyCap} · {dialLabel}
                  </span>
                </div>
                <div className="w-full h-2 bg-gray-800 rounded-full overflow-hidden">
                  <div className={`h-2 rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
                </div>
              </div>

              {/* Last reported */}
              {spam?.lastReported && (
                <p className="text-xs text-gray-500">Last reported: {spam.lastReported}</p>
              )}
            </div>
          )
        })}
      </div>

      {/* Spam check button */}
      <button onClick={runSpamCheck} disabled={checking}
        className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-gray-700 bg-gray-900 hover:bg-gray-800 text-gray-300 text-sm font-medium transition-colors disabled:opacity-50 touch-manipulation">
        {checking ? (
          <><svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
          </svg>Checking spam status…</>
        ) : (
          <><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/>
          </svg>Run spam check on all numbers</>
        )}
      </button>

      <p className="text-xs text-gray-600 text-center">
        Rotation shifts daily · 80 dials/number cap · data from SkipCalls
      </p>
    </div>
  )
}
