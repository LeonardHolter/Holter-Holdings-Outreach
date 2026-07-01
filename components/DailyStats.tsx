'use client'

import { useEffect, useMemo, useState } from 'react'
import { format, parseISO } from 'date-fns'
import type { StatRow } from '@/app/stats/page'

interface DayNote {
  note: string
  caller_name: string | null
  created_at: string
  company_name: string | null
  company_id: string | null
}

const GOAL = 100
const LEONARD_COLOR = '#22c55e' // green
const WILLIAM_COLOR = '#eab308' // yellow
const CALLERS = ['Leonard', 'William'] as const

// Local (not UTC) YYYY-MM-DD, so day boundaries match how calls are logged.
function localDateStr(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

interface Metrics {
  calls: number
  answered: number
  noAnswer: number
  demos: number
  notInterested: number
  callback: number
  wrong: number
  notNeeded: number
  pickupRate: number
  demoRate: number
  notInterestedRate: number
}

function aggregate(rows: StatRow[]): Metrics {
  const sum = (pred: (r: StatRow) => boolean) => rows.filter(pred).reduce((s, r) => s + r.n, 0)
  const calls = rows.reduce((s, r) => s + r.n, 0)
  const noAnswer = sum(r => r.reach_out_response === 'No answer')
  const demos = sum(r => r.reach_out_response === 'Demo booked')
  const notInterested = sum(r => r.reach_out_response === 'Not interested')
  const callback = sum(r => r.reach_out_response === 'Call back later')
  const wrong = sum(r => r.reach_out_response === 'Wrong number')
  const notNeeded = sum(r => r.reach_out_response === 'Not needed')
  const answered = calls - noAnswer
  return {
    calls, answered, noAnswer, demos, notInterested, callback, wrong, notNeeded,
    pickupRate: calls ? answered / calls : 0,
    demoRate: calls ? demos / calls : 0,
    notInterestedRate: calls ? notInterested / calls : 0,
  }
}

const pct = (x: number) => `${Math.round(x * 100)}%`

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function cellBackground(d?: { leonard: number; william: number; total: number }): string | undefined {
  if (!d || d.total === 0) return undefined
  const l = d.leonard > 0, w = d.william > 0
  if (l && w) return `linear-gradient(135deg, ${LEONARD_COLOR} 0 50%, ${WILLIAM_COLOR} 50% 100%)`
  if (l) return LEONARD_COLOR
  if (w) return WILLIAM_COLOR
  return '#4b5563'
}

type Period = 'today' | 'week' | 'all'

export function DailyStats({ rows }: { rows: StatRow[] }) {
  const [period, setPeriod] = useState<Period>('today')
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const [notesState, setNotesState] = useState<{ day: string; notes: DayNote[] } | null>(null)

  useEffect(() => {
    if (!selectedDay) return
    let active = true
    fetch(`/api/notes?date=${selectedDay}`)
      .then(r => (r.ok ? r.json() : []))
      .then((data: DayNote[]) => { if (active) setNotesState({ day: selectedDay, notes: Array.isArray(data) ? data : [] }) })
      .catch(() => { if (active) setNotesState({ day: selectedDay, notes: [] }) })
    return () => { active = false }
  }, [selectedDay])

  const loadingNotes = !!selectedDay && notesState?.day !== selectedDay
  const dayNotes = notesState?.day === selectedDay ? notesState.notes : []

  const { today, weekAgo } = useMemo(() => {
    const t = new Date()
    return { today: localDateStr(t), weekAgo: localDateStr(new Date(t.getTime() - 6 * 86400000)) }
  }, [])

  // Per-day totals (for heatmap + streak)
  const byDate = useMemo(() => {
    const m = new Map<string, { total: number; leonard: number; william: number }>()
    for (const r of rows) {
      const e = m.get(r.date) ?? { total: 0, leonard: 0, william: 0 }
      e.total += r.n
      if (r.who_called === 'Leonard') e.leonard += r.n
      else if (r.who_called === 'William') e.william += r.n
      m.set(r.date, e)
    }
    return m
  }, [rows])

  // Activity streak: consecutive days (ending today, or yesterday if today is
  // still empty) that had at least one call. Uses local dates.
  const streak = useMemo(() => {
    const cur = new Date()
    if (!((byDate.get(localDateStr(cur))?.total ?? 0) > 0)) cur.setDate(cur.getDate() - 1)
    let s = 0
    while ((byDate.get(localDateStr(cur))?.total ?? 0) > 0) {
      s++
      cur.setDate(cur.getDate() - 1)
    }
    return s
  }, [byDate])

  const inPeriod = (date: string) =>
    period === 'all' ? true : period === 'today' ? date === today : date >= weekAgo

  const periodRows = rows.filter(r => inPeriod(r.date))
  const metricsFor = (caller: string) =>
    aggregate(caller === 'Team' ? periodRows : periodRows.filter(r => r.who_called === caller))

  // KPI cards (fixed periods, independent of the tab)
  const todayM = aggregate(rows.filter(r => r.date === today))
  const weekM = aggregate(rows.filter(r => r.date >= weekAgo))
  const allM = aggregate(rows)
  const goalMet = todayM.calls >= GOAL

  // Heatmap grid
  const days = useMemo(() => {
    const arr: string[] = []
    const t = new Date()
    for (let i = 364; i >= 0; i--) {
      const d = new Date(t)
      d.setDate(d.getDate() - i)
      arr.push(localDateStr(d))
    }
    return arr
  }, [])
  const cells: (string | null)[] = [...Array(new Date(days[0]).getDay()).fill(null), ...days]
  while (cells.length % 7 !== 0) cells.push(null)
  const weeks: (string | null)[][] = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))
  const monthLabels: { weekIdx: number; label: string }[] = []
  let lastMonth = -1
  weeks.forEach((week, wi) => {
    for (const d of week) {
      if (!d) continue
      const mo = new Date(d).getMonth()
      if (mo !== lastMonth) { monthLabels.push({ weekIdx: wi, label: MONTHS[mo] }); lastMonth = mo }
      break
    }
  })

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Call Stats</h1>
        <p className="text-gray-400 text-sm mt-1">Goal: {GOAL} calls per day</p>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Kpi label="Today">
          <div className="flex items-end gap-2">
            <span className={`text-3xl font-bold tabular-nums ${goalMet ? 'text-green-400' : 'text-white'}`}>{todayM.calls}</span>
            {goalMet && <span className="mb-1 text-green-400 text-sm font-medium">✓</span>}
          </div>
          {!goalMet && (
            <div className="mt-1">
              <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                <div className="h-full bg-green-500 rounded-full" style={{ width: `${Math.min(100, (todayM.calls / GOAL) * 100)}%` }} />
              </div>
              <span className="text-xs text-gray-600 mt-0.5 block">{Math.max(0, GOAL - todayM.calls)} to go</span>
            </div>
          )}
        </Kpi>
        <Kpi label="Streak">
          <div className="flex items-end gap-2">
            <span className={`text-3xl font-bold tabular-nums ${streak > 0 ? 'text-orange-400' : 'text-white'}`}>{streak}</span>
            <span className="mb-1 text-gray-500 text-sm">{streak === 1 ? 'day' : 'days'}</span>
          </div>
          {streak > 0 && <span className="text-xs text-orange-400/70">🔥 in a row</span>}
        </Kpi>
        <Kpi label="This week">
          <span className="text-3xl font-bold tabular-nums text-white">{weekM.calls}</span>
          <span className="text-xs text-gray-600">{pct(weekM.pickupRate)} pickup</span>
        </Kpi>
        <Kpi label="Pickup rate (all)">
          <span className="text-3xl font-bold tabular-nums text-blue-400">{pct(allM.pickupRate)}</span>
          <span className="text-xs text-gray-600">{allM.demos} demos booked</span>
        </Kpi>
      </div>

      {/* Per-person breakdown with period tabs */}
      <div className="bg-gray-900 rounded-xl p-5">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Breakdown</h2>
          <div className="flex bg-gray-800 rounded-lg p-0.5 text-xs">
            {([['today', 'Today'], ['week', 'This week'], ['all', 'All time']] as [Period, string][]).map(([p, label]) => (
              <button key={p} onClick={() => setPeriod(p)}
                className={`px-3 py-1.5 rounded-md transition-colors ${period === p ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-gray-200'}`}>
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead>
              <tr className="text-xs text-gray-500 uppercase tracking-wider border-b border-gray-800">
                <th className="text-left font-semibold py-2 pr-3">Caller</th>
                <th className="text-right font-semibold py-2 px-3">Calls</th>
                <th className="text-right font-semibold py-2 px-3">Pickup&nbsp;%</th>
                <th className="text-right font-semibold py-2 px-3">Demos</th>
                <th className="text-right font-semibold py-2 px-3">Demo&nbsp;%</th>
                <th className="text-right font-semibold py-2 px-3">No&nbsp;answer</th>
                <th className="text-right font-semibold py-2 px-3">Not&nbsp;int.</th>
                <th className="text-right font-semibold py-2 px-3">Not&nbsp;int.&nbsp;%</th>
                <th className="text-right font-semibold py-2 pl-3">Callbacks</th>
              </tr>
            </thead>
            <tbody>
              {CALLERS.map(caller => {
                const m = metricsFor(caller)
                return (
                  <tr key={caller} className="border-b border-gray-800/60">
                    <td className="py-2.5 pr-3">
                      <span className="flex items-center gap-2 text-gray-200 font-medium">
                        <span className="w-2 h-2 rounded-full" style={{ background: caller === 'Leonard' ? LEONARD_COLOR : WILLIAM_COLOR }} />
                        {caller}
                      </span>
                    </td>
                    <td className="text-right tabular-nums text-white py-2.5 px-3">{m.calls}</td>
                    <td className="text-right tabular-nums text-gray-300 py-2.5 px-3">{m.calls ? pct(m.pickupRate) : '—'}</td>
                    <td className="text-right tabular-nums text-green-400 py-2.5 px-3">{m.demos}</td>
                    <td className="text-right tabular-nums text-gray-300 py-2.5 px-3">{m.calls ? pct(m.demoRate) : '—'}</td>
                    <td className="text-right tabular-nums text-gray-500 py-2.5 px-3">{m.noAnswer}</td>
                    <td className="text-right tabular-nums text-gray-500 py-2.5 px-3">{m.notInterested}</td>
                    <td className="text-right tabular-nums text-red-400/80 py-2.5 px-3">{m.calls ? pct(m.notInterestedRate) : '—'}</td>
                    <td className="text-right tabular-nums text-gray-500 py-2.5 pl-3">{m.callback}</td>
                  </tr>
                )
              })}
              {(() => {
                const m = metricsFor('Team')
                return (
                  <tr className="font-semibold">
                    <td className="py-2.5 pr-3 text-gray-300">Team total</td>
                    <td className="text-right tabular-nums text-white py-2.5 px-3">{m.calls}</td>
                    <td className="text-right tabular-nums text-gray-200 py-2.5 px-3">{m.calls ? pct(m.pickupRate) : '—'}</td>
                    <td className="text-right tabular-nums text-green-400 py-2.5 px-3">{m.demos}</td>
                    <td className="text-right tabular-nums text-gray-200 py-2.5 px-3">{m.calls ? pct(m.demoRate) : '—'}</td>
                    <td className="text-right tabular-nums text-gray-500 py-2.5 px-3">{m.noAnswer}</td>
                    <td className="text-right tabular-nums text-gray-500 py-2.5 px-3">{m.notInterested}</td>
                    <td className="text-right tabular-nums text-red-400/80 py-2.5 px-3">{m.calls ? pct(m.notInterestedRate) : '—'}</td>
                    <td className="text-right tabular-nums text-gray-500 py-2.5 pl-3">{m.callback}</td>
                  </tr>
                )
              })()}
            </tbody>
          </table>
        </div>
      </div>

      {/* Heatmap */}
      <div className="bg-gray-900 rounded-xl p-5 overflow-x-auto">
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Activity — last 365 days</h2>
        <div className="inline-flex gap-1">
          <div className="flex flex-col gap-0.5 mr-1 pt-5">
            {DAYS.map((d, i) => (
              <div key={d} className="h-3 flex items-center">
                {i % 2 === 1 && <span className="text-[9px] text-gray-600 leading-none">{d}</span>}
              </div>
            ))}
          </div>
          <div>
            <div className="flex gap-0.5 mb-1 h-4">
              {weeks.map((_, wi) => {
                const label = monthLabels.find(m => m.weekIdx === wi)
                return <div key={wi} className="w-3 shrink-0">{label && <span className="text-[9px] text-gray-500 leading-none whitespace-nowrap">{label.label}</span>}</div>
              })}
            </div>
            <div className="flex gap-0.5">
              {weeks.map((week, wi) => (
                <div key={wi} className="flex flex-col gap-0.5">
                  {week.map((dateStr, di) => {
                    if (!dateStr) return <div key={di} className="w-3 h-3" />
                    const d = byDate.get(dateStr)
                    const isToday = dateStr === today
                    const bg = cellBackground(d)
                    const label = d ? `${dateStr}: Leonard ${d.leonard}, William ${d.william} (${d.total} total)` : `${dateStr}: no calls`
                    const selected = dateStr === selectedDay
                    return (
                      <button key={dateStr} title={label}
                        onClick={() => setSelectedDay(dateStr)}
                        className={`w-3 h-3 rounded-sm cursor-pointer transition-opacity hover:opacity-75 ${selected ? 'ring-2 ring-white' : ''} ${bg ? '' : isToday ? 'bg-gray-800 ring-1 ring-gray-600' : 'bg-gray-900'}`}
                        style={bg ? { background: bg } : undefined} />
                    )
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-4 mt-4 text-[10px] text-gray-500">
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm" style={{ background: LEONARD_COLOR }} />Leonard</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm" style={{ background: WILLIAM_COLOR }} />William</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm" style={{ background: `linear-gradient(135deg, ${LEONARD_COLOR} 0 50%, ${WILLIAM_COLOR} 50% 100%)` }} />Both</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-gray-900 border border-gray-700" />No calls</span>
        </div>
        <p className="text-[10px] text-gray-600 mt-2">Tip: click any day to see its stats and notes.</p>
      </div>

      {/* Selected-day detail */}
      {selectedDay && (() => {
        const dayRows = rows.filter(r => r.date === selectedDay)
        const dm = aggregate(dayRows)
        return (
          <div className="bg-gray-900 rounded-xl p-5">
            <div className="flex items-center justify-between mb-4 gap-3">
              <h2 className="text-sm font-semibold text-white">
                {format(parseISO(selectedDay), 'EEEE, d MMM yyyy')}
              </h2>
              <button onClick={() => setSelectedDay(null)} className="text-xs text-gray-500 hover:text-gray-300">Close ✕</button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              <DayStat label="Calls" value={String(dm.calls)} />
              <DayStat label="Pickup %" value={dm.calls ? pct(dm.pickupRate) : '—'} />
              <DayStat label="Demos" value={String(dm.demos)} />
              <DayStat label="Not interested" value={String(dm.notInterested)} />
            </div>

            <div className="flex flex-wrap gap-4 text-xs text-gray-500 mb-5">
              {CALLERS.map(c => {
                const m = aggregate(dayRows.filter(r => r.who_called === c))
                return (
                  <span key={c} className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full" style={{ background: c === 'Leonard' ? LEONARD_COLOR : WILLIAM_COLOR }} />
                    {c}: {m.calls} calls{m.demos ? `, ${m.demos} demos` : ''}
                  </span>
                )
              })}
            </div>

            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
              Notes{dayNotes.length ? ` (${dayNotes.length})` : ''}
            </h3>
            {loadingNotes ? (
              <p className="text-xs text-gray-600">Loading…</p>
            ) : dayNotes.length === 0 ? (
              <p className="text-xs text-gray-600">No notes written this day.</p>
            ) : (
              <div className="space-y-2">
                {dayNotes.map((n, i) => (
                  <div key={i} className="bg-gray-950 border border-gray-800 rounded-lg p-3">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="text-sm font-medium text-gray-200 truncate">{n.company_name ?? 'Unknown company'}</span>
                      <span className="text-[10px] text-gray-600 shrink-0">
                        {n.caller_name ? `${n.caller_name} · ` : ''}{format(parseISO(n.created_at), 'HH:mm')}
                      </span>
                    </div>
                    <p className="text-sm text-gray-400 whitespace-pre-wrap">{n.note}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })()}
    </div>
  )
}

function DayStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-gray-950 rounded-lg p-3">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-600 block">{label}</span>
      <span className="text-xl font-bold tabular-nums text-white">{value}</span>
    </div>
  )
}

function Kpi({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="bg-gray-900 rounded-xl p-4 flex flex-col gap-1">
      <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">{label}</span>
      {children}
    </div>
  )
}
