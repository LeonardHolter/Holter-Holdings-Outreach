'use client'

import type { DayData } from '@/app/stats/page'

const GOAL = 100

interface Props {
  data: DayData[]
}

// Build a map from date string → DayData
function buildMap(data: DayData[]): Map<string, DayData> {
  return new Map(data.map(d => [d.date, d]))
}

// Generate last 365 days as YYYY-MM-DD strings (oldest → newest)
function last365Days(): string[] {
  const days: string[] = []
  const today = new Date()
  for (let i = 364; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    days.push(d.toISOString().slice(0, 10))
  }
  return days
}

function toLocalDateStr(d: Date): string {
  return d.toISOString().slice(0, 10)
}

// Compute current streak: consecutive days ending today (or yesterday)
// where total >= GOAL
function computeStreak(map: Map<string, DayData>): number {
  const today = new Date()
  let streak = 0
  const cursor = new Date(today)

  // If today has no calls yet, start checking from yesterday
  const todayStr = toLocalDateStr(today)
  if (!map.has(todayStr) || (map.get(todayStr)!.total < GOAL)) {
    cursor.setDate(cursor.getDate() - 1)
  }

  while (true) {
    const str = toLocalDateStr(cursor)
    const day = map.get(str)
    if (!day || day.total < GOAL) break
    streak++
    cursor.setDate(cursor.getDate() - 1)
  }

  return streak
}

const LEONARD_COLOR = '#22c55e' // green
const WILLIAM_COLOR = '#eab308' // yellow

// Background for a day cell, coloured by who called:
//   green = Leonard, yellow = William, diagonal split = both, gray = nobody.
function cellBackground(d: DayData | undefined): string | undefined {
  if (!d || d.total === 0) return undefined
  const leonard = d.leonard > 0
  const william = d.william > 0
  if (leonard && william) {
    return `linear-gradient(135deg, ${LEONARD_COLOR} 0 50%, ${WILLIAM_COLOR} 50% 100%)`
  }
  if (leonard) return LEONARD_COLOR
  if (william) return WILLIAM_COLOR
  return '#4b5563' // calls with no caller recorded — neutral gray
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function DailyStats({ data }: Props) {
  const map = buildMap(data)
  const days = last365Days()
  const todayStr = toLocalDateStr(new Date())
  const today = map.get(todayStr)
  const todayCount = today?.total ?? 0
  const streak = computeStreak(map)
  const goalMet = todayCount >= GOAL

  // Total all-time (in the 365-day window)
  const totalCalls = data.reduce((s, d) => s + d.total, 0)
  const daysActive = data.filter(d => d.total > 0).length
  const daysGoalMet = data.filter(d => d.total >= GOAL).length

  // Per-caller totals
  const leonardTotal = data.reduce((s, d) => s + d.leonard, 0)
  const williamTotal = data.reduce((s, d) => s + d.william, 0)

  // Build the grid: pad so the first day starts on the correct weekday
  const firstDate = new Date(days[0])
  const startDow = firstDate.getDay() // 0=Sun
  // Total cells = 53 weeks × 7
  const cells: (string | null)[] = [
    ...Array(startDow).fill(null),
    ...days,
  ]
  // Round up to full weeks
  while (cells.length % 7 !== 0) cells.push(null)

  const weeks: (string | null)[][] = []
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(cells.slice(i, i + 7))
  }

  // Month labels: find the first week each month appears in
  const monthLabels: { weekIdx: number; label: string }[] = []
  let lastMonth = -1
  weeks.forEach((week, wi) => {
    for (const d of week) {
      if (!d) continue
      const m = new Date(d).getMonth()
      if (m !== lastMonth) {
        monthLabels.push({ weekIdx: wi, label: MONTHS[m] })
        lastMonth = m
      }
      break
    }
  })

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">Daily Call Stats</h1>
        <p className="text-gray-400 text-sm mt-1">Goal: {GOAL} calls per day</p>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {/* Today */}
        <div className="bg-gray-900 rounded-xl p-4 flex flex-col gap-1">
          <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">Today</span>
          <div className="flex items-end gap-2">
            <span className={`text-3xl font-bold tabular-nums ${goalMet ? 'text-green-400' : 'text-white'}`}>
              {todayCount}
            </span>
            {goalMet && (
              <span className="mb-1 text-green-400 text-sm font-medium">✓ Goal met</span>
            )}
          </div>
          {!goalMet && (
            <div className="mt-1">
              <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-green-500 rounded-full transition-all"
                  style={{ width: `${Math.min(100, (todayCount / GOAL) * 100)}%` }}
                />
              </div>
              <span className="text-xs text-gray-600 mt-0.5 block">{GOAL - todayCount} to go</span>
            </div>
          )}
        </div>

        {/* Streak */}
        <div className="bg-gray-900 rounded-xl p-4 flex flex-col gap-1">
          <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">Streak</span>
          <div className="flex items-end gap-2">
            <span className={`text-3xl font-bold tabular-nums ${streak > 0 ? 'text-orange-400' : 'text-white'}`}>
              {streak}
            </span>
            <span className="mb-1 text-gray-500 text-sm">{streak === 1 ? 'day' : 'days'}</span>
          </div>
          {streak > 0 && (
            <span className="text-xs text-orange-400/70">🔥 Keep it up</span>
          )}
        </div>

        {/* Total calls (365d) */}
        <div className="bg-gray-900 rounded-xl p-4 flex flex-col gap-1">
          <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">Total (365d)</span>
          <span className="text-3xl font-bold tabular-nums text-white">{totalCalls.toLocaleString()}</span>
          <span className="text-xs text-gray-600">{daysActive} active {daysActive === 1 ? 'day' : 'days'}</span>
        </div>

        {/* Goal days */}
        <div className="bg-gray-900 rounded-xl p-4 flex flex-col gap-1">
          <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">Goal days</span>
          <span className="text-3xl font-bold tabular-nums text-green-400">{daysGoalMet}</span>
          <span className="text-xs text-gray-600">days with 100+ calls</span>
        </div>
      </div>

      {/* Per-caller */}
      <div className="bg-gray-900 rounded-xl p-5">
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Caller breakdown (365d)</h2>
        <div className="space-y-3">
          {[
            { name: 'Leonard', count: leonardTotal, color: 'bg-blue-500' },
            { name: 'William', count: williamTotal, color: 'bg-purple-500' },
          ].map(({ name, count, color }) => {
            const pct = totalCalls > 0 ? (count / totalCalls) * 100 : 0
            return (
              <div key={name} className="flex items-center gap-3">
                <span className="text-sm text-gray-300 w-20">{name}</span>
                <div className="flex-1 h-2 bg-gray-800 rounded-full overflow-hidden">
                  <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
                </div>
                <span className="text-sm tabular-nums text-gray-400 w-16 text-right">{count.toLocaleString()}</span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Heatmap */}
      <div className="bg-gray-900 rounded-xl p-5 overflow-x-auto">
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Activity — last 365 days</h2>

        <div className="inline-flex gap-1">
          {/* Day-of-week labels */}
          <div className="flex flex-col gap-0.5 mr-1 pt-5">
            {DAYS.map((d, i) => (
              <div key={d} className="h-3 flex items-center">
                {i % 2 === 1 && <span className="text-[9px] text-gray-600 leading-none">{d}</span>}
              </div>
            ))}
          </div>

          <div>
            {/* Month labels */}
            <div className="flex gap-0.5 mb-1 h-4">
              {weeks.map((_, wi) => {
                const label = monthLabels.find(m => m.weekIdx === wi)
                return (
                  <div key={wi} className="w-3 shrink-0">
                    {label && <span className="text-[9px] text-gray-500 leading-none whitespace-nowrap">{label.label}</span>}
                  </div>
                )
              })}
            </div>

            {/* Grid: rows = day of week, cols = week */}
            <div className="flex gap-0.5">
              {weeks.map((week, wi) => (
                <div key={wi} className="flex flex-col gap-0.5">
                  {week.map((dateStr, di) => {
                    if (!dateStr) return <div key={di} className="w-3 h-3" />
                    const d = map.get(dateStr)
                    const count = d?.total ?? 0
                    const isToday = dateStr === todayStr
                    const bg = cellBackground(d)
                    const label = d
                      ? `${dateStr}: Leonard ${d.leonard}, William ${d.william} (${count} total)`
                      : `${dateStr}: no calls`
                    return (
                      <div
                        key={dateStr}
                        title={label}
                        className={`w-3 h-3 rounded-sm cursor-default transition-opacity hover:opacity-75 ${
                          bg ? '' : isToday ? 'bg-gray-800 ring-1 ring-gray-600' : 'bg-gray-900'
                        }`}
                        style={bg ? { background: bg } : undefined}
                      />
                    )
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Legend */}
        <div className="flex items-center gap-4 mt-4 text-[10px] text-gray-500">
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-sm" style={{ background: LEONARD_COLOR }} />
            Leonard
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-sm" style={{ background: WILLIAM_COLOR }} />
            William
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-sm" style={{ background: `linear-gradient(135deg, ${LEONARD_COLOR} 0 50%, ${WILLIAM_COLOR} 50% 100%)` }} />
            Both
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-sm bg-gray-900 border border-gray-700" />
            No calls
          </span>
        </div>
      </div>
    </div>
  )
}
