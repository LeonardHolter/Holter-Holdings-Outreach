'use client'

import { useEffect, useState } from 'react'
import { GOAL } from '@/components/DailyStats'
import { avgSecondsPerCall, estimatedFinish, todaysTarget } from '@/lib/pace'
import { CALL_CUTOFF_HOUR, osloHour } from '@/lib/callingHours'

// Slim strip above the dialer: today's count against the real target (60, or
// 120 when yesterday's miss is unrescued — the ±1 debt), the current pace,
// and the projected finish time. Refreshes every 45s and after focus, so it
// tracks a live session without anyone reloading.

interface PaceData {
  callsToday: number
  yesterday: number
  dayBefore: number
  timestamps: string[]
}

export function PaceBanner() {
  const [data, setData] = useState<PaceData | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const res = await fetch('/api/pace', { cache: 'no-store' })
        if (!res.ok) return
        const d = await res.json()
        if (!cancelled) setData(d)
      } catch {
        /* the dialer works fine without a pace banner — stay quiet */
      }
    }
    load()
    const id = setInterval(load, 45_000)
    const onFocus = () => load()
    window.addEventListener('focus', onFocus)
    return () => {
      cancelled = true
      clearInterval(id)
      window.removeEventListener('focus', onFocus)
    }
  }, [])

  if (!data) return null

  const target = todaysTarget(data.yesterday, data.dayBefore)
  const owes = target > GOAL
  const done = data.callsToday >= target
  const perCall = avgSecondsPerCall(data.timestamps)
  const eta = estimatedFinish(new Date(), data.callsToday, target, perCall)
  const etaStr = eta
    ? eta.toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Oslo' })
    : null
  const etaAfterCutoff = eta != null && osloHour(eta) >= CALL_CUTOFF_HOUR

  return (
    <div className="shrink-0 border-b border-gray-800 bg-gray-950/80">
      <div className="flex items-center gap-x-4 gap-y-1 flex-wrap px-3 sm:px-4 py-1.5 text-xs">
        <span className="flex items-center gap-2">
          <span className={`tabular-nums font-semibold ${done ? 'text-green-400' : 'text-white'}`}>
            {data.callsToday}/{target}
          </span>
          <span className="w-20 h-1.5 bg-gray-800 rounded-full overflow-hidden">
            <span
              className={`block h-full rounded-full ${done ? 'bg-green-400' : 'bg-white'}`}
              style={{ width: `${Math.min(100, (data.callsToday / target) * 100)}%` }}
            />
          </span>
        </span>

        {owes && !done && (
          <span className="text-amber-300" title={`I går ble det ${data.yesterday} samtaler — under ${GOAL}, og dagen før nådde ikke ${GOAL * 2}. Etter ±1-regelen redder ${GOAL * 2} i dag streaken.`}>
            {GOAL * 2} i dag — skylder fra i går (±1)
          </span>
        )}

        {done && <span className="text-green-400">✓ mål nådd</span>}

        {!done && perCall != null && (
          <span className="text-gray-500 tabular-nums">~{(perCall / 60).toFixed(1)} min/samtale</span>
        )}

        {!done && etaStr && (
          <span className={etaAfterCutoff ? 'text-amber-300' : 'text-gray-400'}>
            ferdig ca. <span className="tabular-nums font-medium">{etaStr}</span>
            {etaAfterCutoff && ` — etter ringetid (${CALL_CUTOFF_HOUR}:00)!`}
          </span>
        )}

        {!done && perCall == null && data.callsToday > 0 && (
          <span className="text-gray-600">estimat kommer etter noen samtaler</span>
        )}
      </div>
    </div>
  )
}
