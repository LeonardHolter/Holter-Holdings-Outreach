'use client'

import { useEffect, useState } from 'react'
import { GOAL } from '@/components/DailyStats'
import { avgSecondsPerCall, estimatedFinish, todaysTarget } from '@/lib/pace'
import { CALL_CUTOFF_HOUR, osloHour } from '@/lib/callingHours'

// Slim strip above the dialer: today's count against the caller's own target
// (60, or 120 when THEIR yesterday fell short unrescued — the ±1 debt is
// personal: William can owe 120 while Leonard only needs 60), the current
// pace, and the projected finish time.
//
// The caller comes from the same localStorage key the dialer session uses.
// Same-tab localStorage writes fire no event, so it's re-read on a short
// tick; picking your name in the dialer flips the banner within seconds.
// Until a name is picked the numbers are team-wide.

interface PaceData {
  caller: string | null
  callsToday: number
  yesterday: number
  dayBefore: number
  timestamps: string[]
}

export function PaceBanner() {
  const [caller, setCaller] = useState<string | null>(null)
  const [data, setData] = useState<PaceData | null>(null)

  // Track the dialer's caller selection.
  useEffect(() => {
    const read = () => setCaller(localStorage.getItem('sessionCaller') || null)
    read()
    const id = setInterval(read, 3_000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const url = caller ? `/api/pace?caller=${encodeURIComponent(caller)}` : '/api/pace'
        const res = await fetch(url, { cache: 'no-store' })
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
  }, [caller])

  // Never show one caller's numbers under another caller's name mid-switch.
  if (!data || data.caller !== caller) return null

  const target = todaysTarget(data.yesterday, data.dayBefore)
  const owes = target > GOAL
  const dayOff = target === 0
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
          <span className="text-gray-500">{caller ?? 'Team'}</span>
          <span className={`tabular-nums font-semibold ${done ? 'text-green-400' : 'text-white'}`}>
            {data.callsToday}/{target}
          </span>
          <span className="w-20 h-1.5 bg-gray-800 rounded-full overflow-hidden">
            <span
              className={`block h-full rounded-full ${done ? 'bg-green-400' : 'bg-white'}`}
              style={{ width: `${target > 0 ? Math.min(100, (data.callsToday / target) * 100) : 100}%` }}
            />
          </span>
        </span>

        {owes && !done && (
          <span className="text-amber-300" title={`${caller ?? 'Teamet'} tok ${data.yesterday} samtaler i går. ±1-regelen: to påfølgende dager må summere til ${GOAL * 2}, så i dag trengs ${target} (${data.yesterday} + ${target} = ${GOAL * 2}).`}>
            {target} i dag — skylder fra i går (±1)
          </span>
        )}

        {!owes && !dayOff && target < GOAL && !done && (
          <span className="text-gray-500" title={`${data.yesterday} i går + ${target} i dag = ${GOAL * 2} over to dager.`}>
            bare {target} i dag ({data.yesterday} i går)
          </span>
        )}

        {done && (
          <span className="text-green-400">
            {dayOff ? `✓ fridag opptjent (${data.yesterday} i går)` : '✓ mål nådd'}
          </span>
        )}

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
