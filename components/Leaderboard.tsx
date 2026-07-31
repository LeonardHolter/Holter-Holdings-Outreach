'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import type { LeaderRow } from '@/app/api/leaderboard/route'

// All-time WON deals leaderboard, pinned in the nav on every page.
//
// Refreshes on route change (so navigating updates it) and every 60s (so it
// stays live during a long stretch on /call, where you never navigate).
// Renders nothing until data arrives and nothing on failure — a motivational
// banner must never push the nav around or shout an error at you.

const MEDALS = ['🥇', '🥈', '🥉']

export function Leaderboard() {
  const [leaders, setLeaders] = useState<LeaderRow[] | null>(null)
  const pathname = usePathname()

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const res = await fetch('/api/leaderboard', { cache: 'no-store' })
        const data = await res.json()
        if (!cancelled && Array.isArray(data?.leaders)) setLeaders(data.leaders)
      } catch {
        /* banner is decoration — stay silent */
      }
    }
    load()
    const t = setInterval(load, 60_000)
    return () => {
      cancelled = true
      clearInterval(t)
    }
  }, [pathname])

  if (!leaders || leaders.length === 0) return null

  const top = leaders[0].wins
  const runnerUp = leaders[1]?.wins ?? 0
  const lead = top - runnerUp

  return (
    <div className="shrink-0 border-b border-gray-800 bg-gray-950/80">
      <div className="flex items-center gap-3 px-3 sm:px-4 py-1.5 overflow-x-auto scrollbar-none"
        style={{ WebkitOverflowScrolling: 'touch', scrollbarWidth: 'none' }}>
        <span className="shrink-0 font-mono text-[10px] uppercase tracking-widest text-gray-600">
          All-time wins
        </span>

        {leaders.map((l, i) => {
          const isLeader = i === 0 && lead > 0
          return (
            <span key={l.name} className="shrink-0 flex items-center gap-1.5 text-xs">
              <span aria-hidden>{MEDALS[i] ?? '·'}</span>
              <span className={isLeader ? 'text-white font-semibold' : 'text-gray-400'}>
                {l.name}
              </span>
              <span className={`tabular-nums font-semibold ${isLeader ? 'text-white' : 'text-gray-300'}`}>
                {l.wins.toLocaleString('nb-NO')}
              </span>
            </span>
          )
        })}

        {/* The gap is the whole point of a leaderboard — say it out loud. */}
        {lead > 0 && (
          <span className="shrink-0 text-[11px] text-gray-600">
            +{lead.toLocaleString('nb-NO')} foran
          </span>
        )}
        {lead === 0 && leaders.length > 1 && (
          <span className="shrink-0 text-[11px] text-gray-600">uavgjort</span>
        )}
      </div>
    </div>
  )
}
