'use client'

import { useEffect, useMemo, useState } from 'react'
import { Info } from './Info'
import { format, parseISO } from 'date-fns'
import type { StatRow, CallEvent, DemoOutcomeCount } from '@/app/stats/page'
import { UNDER_CONSIDERATION } from '@/types'

interface DayNote {
  id?: string
  note: string
  caller_name: string | null
  created_at: string
  company_name?: string | null
  company_id?: string | null
}

export const GOAL = 60
const LEONARD_COLOR = '#ffffff' // white — monochrome theme
const WILLIAM_COLOR = '#7a7a7a' // mid gray — monochrome theme
const CALLERS = ['Leonard', 'William'] as const

// Local (not UTC) YYYY-MM-DD, so day boundaries match how calls are logged.
function localDateStr(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Shift a YYYY-MM-DD day string by whole days, staying in local time so it
 *  agrees with localDateStr across DST. */
function shiftDay(day: string, by: number): string {
  const [y, m, d] = day.split('-').map(Number)
  const x = new Date(y, m - 1, d)
  x.setDate(x.getDate() + by)
  return localDateStr(x)
}

/**
 * Streak of consecutive days that made the daily goal, counting back from
 * today — under the ±1 rule.
 *
 * The ±1 rule: 120 calls over two consecutive days, distributed however you
 * like. A day counts if it hit 60 on its own, or if it and an adjacent day
 * sum to 120 — so 8 yesterday + 112 today works, and 120 one day buys the
 * next (or previous) day off. The buffer is exactly one day: a shortfall
 * can only borrow from its immediate neighbours.
 *
 * Today never counts against you: an unfinished day that hasn't reached the
 * goal yet just isn't part of the streak, so counting starts at yesterday
 * instead of resetting to zero. (Tomorrow can still rescue today later — the
 * streak is recomputed from the data every time, so it repairs itself.)
 *
 * The walk stops at the first day anyone ever logged a call. Without that
 * floor a 120-day would rescue the empty day before it, and a first day of
 * 120 would hand you a streak day from before the team existed.
 */
export function callStreak(totals: Map<string, number>, today: string, goal = GOAL): number {
  const at = (d: string) => totals.get(d) ?? 0
  const qualifies = (d: string) =>
    at(d) >= goal ||
    at(d) + at(shiftDay(d, -1)) >= goal * 2 ||
    at(d) + at(shiftDay(d, 1)) >= goal * 2

  // YYYY-MM-DD sorts lexicographically, so this is the earliest logged day.
  const firstLogged = [...totals.keys()].sort()[0]
  if (!firstLogged) return 0

  let cur = qualifies(today) ? today : shiftDay(today, -1)
  let streak = 0
  while (cur >= firstLogged && qualifies(cur)) {
    streak++
    cur = shiftDay(cur, -1)
  }
  return streak
}

interface Metrics {
  calls: number
  answered: number
  noAnswer: number
  demos: number
  won: number
  notInterested: number
  callback: number
  wrong: number
  notNeeded: number
  pickupRate: number
  demoRate: number
  wonRate: number
  notInterestedRate: number
}

export function aggregate(rows: StatRow[]): Metrics {
  const sum = (pred: (r: StatRow) => boolean) => rows.filter(pred).reduce((s, r) => s + r.n, 0)
  const calls = rows.reduce((s, r) => s + r.n, 0)
  const noAnswer = sum(r => r.reach_out_response === 'No answer')
  const demos = sum(r => r.reach_out_response === 'Demo booked')
  const won = sum(r => r.demo_outcome === 'Won')
  const notInterested = sum(r => r.reach_out_response === 'Not interested')
  const callback = sum(r => r.reach_out_response === 'Call back later')
  const wrong = sum(r => r.reach_out_response === 'Wrong number')
  const notNeeded = sum(r => r.reach_out_response === 'Not needed')
  const answered = calls - noAnswer
  return {
    calls, answered, noAnswer, demos, won, notInterested, callback, wrong, notNeeded,
    // Pickup is the ONLY rate measured against every dial — it is the metric
    // that asks "did anyone answer". Everything below describes what happened
    // IN a conversation, so it divides by `answered`: a phone nobody picked up
    // can't book a demo or say "not interested", and counting those attempts in
    // the denominator just dilutes every conversion number by your pickup rate.
    pickupRate: calls ? answered / calls : 0,
    demoRate: answered ? demos / answered : 0,
    wonRate: answered ? won / answered : 0,
    notInterestedRate: answered ? notInterested / answered : 0,
  }
}

const pct = (x: number) => `${Math.round(x * 100)}%`
// Pickup shown as "60% (430)": the rate alone hides whether it came from 5
// calls or 500, which is the difference between noise and a real signal.
const pctOf = (rate: number, n: number) => `${pct(rate)} (${n})`
// Conversion rates show the whole fraction — "4.7% (12/258)" — so the
// denominator is verifiable on the page rather than only claimed in a tooltip.
const pctFrac = (rate: number, num: number, den: number) => `${pct1(rate)} (${num}/${den})`
const pctFrac0 = (rate: number, num: number, den: number) => `${pct(rate)} (${num}/${den})`
// One-decimal variant, for low-magnitude rates (e.g. Demo %) where rounding
// to a whole number hides the difference between e.g. 1.2% and 1.8%.
const pct1 = (x: number) => `${(x * 100).toFixed(1)}%`

// --- Event-log-derived metrics (call_events) --------------------------------
// Unlike StatRow (a company's latest state), call_events has one row per
// logged call, so these can measure trends: dials-per-demo, decision-maker
// conversion, time-of-day pickup, callback conversion, revenue-tier performance.

interface EventMetrics {
  dials: number
  answered: number
  demos: number
  dialsPerDemo: number | null
  dmReached: number
  dmReachedRate: number | null
  dmToDemoRate: number | null
}

/** An event counts as answered unless it was explicitly logged "No answer".
 *  Same rule everywhere a conversation-rate denominator is needed. */
const isAnswered = (e: CallEvent) => Boolean(e.response) && e.response !== 'No answer'

export function aggregateEvents(events: CallEvent[]): EventMetrics {
  const dials = events.length
  const answered = events.filter(isAnswered).length
  const demos = events.filter(e => e.response === 'Demo booked').length
  const dm = events.filter(e => e.reached_decision_maker === true)
  const dmDemos = dm.filter(e => e.response === 'Demo booked').length
  return {
    dials,
    answered,
    demos,
    // Dials/demo is deliberately per DIAL — it answers "how much dialling does
    // one demo cost me", which is a volume question, not a conversion one.
    dialsPerDemo: demos > 0 ? dials / demos : null,
    dmReached: dm.length,
    // Reaching a decision-maker requires someone to pick up, so this is a
    // conversation rate like the rest.
    dmReachedRate: answered ? dm.length / answered : null,
    dmToDemoRate: dm.length ? dmDemos / dm.length : null,
  }
}

const REVENUE_TIERS = ['Under 1M', '1–5M', '5–10M', '10–15M', '15–25M', 'Over 25M', 'Unknown'] as const
type RevenueTier = (typeof REVENUE_TIERS)[number]

// Revenue is stored in thousands (15000 = 15M NOK). Finer-grained than the
// lib/db.ts PRIORITY_ORDER_BY tiers so the sub-15M bulk of leads isn't one bucket.
function revenueTier(rev: number | null): RevenueTier {
  if (rev == null) return 'Unknown'
  if (rev < 1000) return 'Under 1M'
  if (rev < 5000) return '1–5M'
  if (rev < 10000) return '5–10M'
  if (rev < 15000) return '10–15M'
  if (rev <= 25000) return '15–25M'
  return 'Over 25M'
}

export function revenueTierPerf(events: CallEvent[]) {
  return REVENUE_TIERS.map(tier => {
    const evs = events.filter(e => revenueTier(e.revenue_at_call) === tier)
    const dials = evs.length
    const answered = evs.filter(isAnswered).length
    const demos = evs.filter(e => e.response === 'Demo booked').length
    // Per ANSWERED call, so a tier that simply picks up more often doesn't
    // look like a tier that converts better.
    return { tier, dials, answered, demos, demoRate: answered ? demos / answered : null }
  }).filter(t => t.dials > 0)
}

// Which industry converts best. Same shape and same answered-based demo rate
// as the revenue tiers, plus pickup — with a fresh vertical the first question
// is "do they even answer", which the demo rate alone can't show.
export function industryPerf(events: CallEvent[]) {
  const byIndustry = new Map<string, CallEvent[]>()
  for (const e of events) {
    const key = e.industry ?? 'Ukjent'
    const arr = byIndustry.get(key) ?? []
    arr.push(e)
    byIndustry.set(key, arr)
  }
  return [...byIndustry.entries()]
    .map(([industry, evs]) => {
      const dials = evs.length
      const answered = evs.filter(isAnswered).length
      const demos = evs.filter(e => e.response === 'Demo booked').length
      return {
        industry,
        dials,
        answered,
        demos,
        pickupRate: dials ? answered / dials : null,
        demoRate: answered ? demos / answered : null,
      }
    })
    // Best performer on top; rank by demo rate, break ties on pickup so two
    // industries without demos yet still order meaningfully.
    .sort((a, b) => (b.demoRate ?? 0) - (a.demoRate ?? 0) || (b.pickupRate ?? 0) - (a.pickupRate ?? 0))
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function cellBackground(d?: { leonard: number; william: number; total: number }): string | undefined {
  if (!d || d.total === 0) return undefined
  const l = d.leonard > 0, w = d.william > 0
  if (l && w) return `linear-gradient(135deg, ${LEONARD_COLOR} 0 50%, ${WILLIAM_COLOR} 50% 100%)`
  if (l) return LEONARD_COLOR
  if (w) return WILLIAM_COLOR
  return '#3a3a3a'
}

type Period = 'today' | 'week' | 'all'

interface Props {
  rows: StatRow[]
  events: CallEvent[]
  demoOutcomes: DemoOutcomeCount[]
}

export function DailyStats({ rows, events, demoOutcomes }: Props) {
  // Default to all-time: the Breakdown answers "how are we doing", and on a
  // quiet morning a 'today' default shows an empty table that reads like the
  // data is broken.
  const [period, setPeriod] = useState<Period>('all')
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const [notesState, setNotesState] = useState<{ day: string; company: DayNote[]; dayNotes: DayNote[] } | null>(null)
  const [noteDraft, setNoteDraft] = useState('')
  const [savingNote, setSavingNote] = useState(false)

  useEffect(() => {
    if (!selectedDay) return
    let active = true
    fetch(`/api/notes?date=${selectedDay}`)
      .then(r => (r.ok ? r.json() : { company: [], day: [] }))
      .then(data => { if (active) setNotesState({ day: selectedDay, company: data.company ?? [], dayNotes: data.day ?? [] }) })
      .catch(() => { if (active) setNotesState({ day: selectedDay, company: [], dayNotes: [] }) })
    return () => { active = false }
  }, [selectedDay])

  const loadingNotes = !!selectedDay && notesState?.day !== selectedDay
  const companyNotes = notesState?.day === selectedDay ? notesState.company : []
  const myDayNotes = notesState?.day === selectedDay ? notesState.dayNotes : []

  async function addDayNote() {
    const text = noteDraft.trim()
    if (!selectedDay || !text) return
    setSavingNote(true)
    try {
      const caller = localStorage.getItem('sessionCaller') || null
      const res = await fetch('/api/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: selectedDay, note: text, caller_name: caller }),
      })
      if (res.ok) {
        const saved: DayNote = await res.json()
        setNotesState(s => (s && s.day === selectedDay ? { ...s, dayNotes: [saved, ...s.dayNotes] } : s))
        setNoteDraft('')
      }
    } finally {
      setSavingNote(false)
    }
  }

  async function deleteDayNote(id?: string) {
    if (!id) return
    setNotesState(s => (s ? { ...s, dayNotes: s.dayNotes.filter(n => n.id !== id) } : s))
    await fetch(`/api/notes?id=${id}`, { method: 'DELETE' }).catch(() => {})
  }

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

  // Goal streak under the ±1 rule — see callStreak.
  const dailyTotals = useMemo(
    () => new Map([...byDate].map(([d, v]) => [d, v.total])),
    [byDate],
  )
  const streak = useMemo(() => callStreak(dailyTotals, today), [dailyTotals, today])

  // Was today's shortfall covered by yesterday's surplus (the two-day 120),
  // rather than by hitting the goal outright? Worth saying out loud — it's
  // the difference between a streak you earned today and one yesterday is
  // holding up.
  const todayRescued = useMemo(() => {
    const t = dailyTotals.get(today) ?? 0
    return t < GOAL && t + (dailyTotals.get(shiftDay(today, -1)) ?? 0) >= GOAL * 2
  }, [dailyTotals, today])

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

  // Event-log-derived metrics, filtered by the same period tab as Breakdown.
  const periodEvents = useMemo(
    () => events.filter(e => inPeriod(localDateStr(new Date(e.created_at)))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [events, period, today, weekAgo]
  )
  const tierPerf = useMemo(() => revenueTierPerf(periodEvents), [periodEvents])
  const industries = useMemo(() => industryPerf(periodEvents), [periodEvents])

  // Demo outcomes (all-time — demos are too sparse to slice by period).
  const demoStats = useMemo(() => {
    const map = new Map(demoOutcomes.map(d => [d.demo_outcome, d.n]))
    const held = map.get('Held') ?? 0
    const noShow = map.get('No-show') ?? 0
    const won = map.get('Won') ?? 0
    const lost = map.get('Lost') ?? 0
    // Parked on /lead-behandling: the demo happened, the decision hasn't. Kept
    // out of both rates — it is neither a settled show nor a settled outcome —
    // but counted in totalBooked so the funnel still adds up.
    const considering = map.get(UNDER_CONSIDERATION) ?? 0
    const pending = map.get(null) ?? 0
    const resolvedShow = held + noShow
    const resolvedOutcome = won + lost
    return {
      held, noShow, won, lost, considering, pending,
      totalBooked: held + noShow + won + lost + considering + pending,
      showRate: resolvedShow ? held / resolvedShow : null,
      winRate: resolvedOutcome ? won / resolvedOutcome : null,
    }
  }, [demoOutcomes])

  // Callback conversion (all-time): of companies ever marked "Call back
  // later", how many later got a "Demo booked" event? Needs full event
  // history per company, so it's not period-tabbed.
  const callbackConversion = useMemo(() => {
    const byCompany = new Map<string, CallEvent[]>()
    for (const e of events) {
      if (!e.company_id) continue
      const arr = byCompany.get(e.company_id) ?? []
      arr.push(e)
      byCompany.set(e.company_id, arr)
    }
    let hadCallback = 0
    let converted = 0
    for (const evs of byCompany.values()) {
      const cbIdx = evs.findIndex(e => e.response === 'Call back later')
      if (cbIdx === -1) continue
      hadCallback++
      if (evs.slice(cbIdx + 1).some(e => e.response === 'Demo booked')) converted++
    }
    return { hadCallback, converted, rate: hadCallback ? converted / hadCallback : null }
  }, [events])

  // Best time to call (all-time): pickup rate by local hour of day.
  const hourly = useMemo(() => {
    const buckets = new Map<number, { dials: number; answered: number }>()
    for (const e of events) {
      const h = new Date(e.created_at).getHours()
      const b = buckets.get(h) ?? { dials: 0, answered: 0 }
      b.dials++
      if (e.response !== 'No answer') b.answered++
      buckets.set(h, b)
    }
    return Array.from(buckets.entries())
      .map(([hour, v]) => ({ hour, dials: v.dials, pickupRate: v.dials ? v.answered / v.dials : 0 }))
      .sort((a, b) => a.hour - b.hour)
  }, [events])

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
        <p className="text-gray-400 text-sm mt-1">
          Goal: {GOAL} calls per day
          <span className="text-gray-600"> · or {GOAL * 2} spread over two consecutive days (±1)</span>
        </p>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        <Kpi label="Today" info={`Calls you logged today (Oslo time). Every saved outcome counts as one call — a re-dial of the same company counts again. Goal is ${GOAL}/day.`}>
          <div className="flex items-end gap-2">
            <span className="text-3xl font-bold tabular-nums text-white">{todayM.calls}</span>
            {goalMet && <span className="mb-1 text-white text-sm font-medium">✓ goal</span>}
          </div>
          {!goalMet && (
            <div className="mt-1">
              <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                <div className="h-full bg-white rounded-full" style={{ width: `${Math.min(100, (todayM.calls / GOAL) * 100)}%` }} />
              </div>
              <span className="text-xs text-gray-600 mt-0.5 block">{Math.max(0, GOAL - todayM.calls)} to go</span>
            </div>
          )}
        </Kpi>
        <Kpi label="Streak" info={`Consecutive days that made the ${GOAL}-call goal, counting back from today. The ±1 rule: ${GOAL * 2} over two consecutive days, distributed however you like — 8 one day and ${GOAL * 2 - 8} the next works, and ${GOAL * 2} in one day buys the day before or after off. The buffer is exactly one day: a shortfall can only borrow from its immediate neighbours. Today never counts against you: an unfinished day just isn't in the streak yet.`}>
          <div className="flex items-end gap-2">
            <span className={`text-3xl font-bold tabular-nums ${streak > 0 ? 'text-orange-400' : 'text-white'}`}>{streak}</span>
            <span className="mb-1 text-gray-500 text-sm">{streak === 1 ? 'day' : 'days'}</span>
          </div>
          {streak > 0 && (
            <span className="text-xs text-orange-400/70">
              {todayRescued ? '±1 rule saved today' : '🔥 in a row'}
            </span>
          )}
        </Kpi>
        <Kpi label="This week" info="Calls logged in the last 7 days. The line underneath is pickup: answered ÷ calls, with the answered count in brackets.">
          <span className="text-3xl font-bold tabular-nums text-white">{weekM.calls}</span>
          <span className="text-xs text-gray-600">{pct(weekM.pickupRate)} pickup ({weekM.answered})</span>
        </Kpi>
        <Kpi label="Won rate (all)" info="Deals won ÷ ANSWERED calls, all time. Divided by answered rather than total dials — nobody buys off a phone that never got picked up, so counting those would just dilute the number by your pickup rate.">
          <span className="text-3xl font-bold tabular-nums text-green-400">{allM.answered ? pct1(allM.wonRate) : '—'}</span>
          <span className="text-xs text-gray-600">{allM.won} won ÷ {allM.answered} answered</span>
        </Kpi>
        <Kpi label="Demo won rate (all)" info="Demos marked Won ÷ demos with a decided outcome (Won + Lost), all time. Demos still awaiting an outcome are excluded so a full pipeline doesn't drag the number down.">
          <span className="text-3xl font-bold tabular-nums text-green-400">{demoStats.winRate != null ? pct(demoStats.winRate) : '—'}</span>
          <span className="text-xs text-gray-600">{demoStats.won} of {demoStats.won + demoStats.lost} decided</span>
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
                <th className="text-right font-semibold py-2 px-3">Calls<Info text="Calls logged in the selected period. One per saved outcome; re-dialling the same company counts again." /></th>
                <th className="text-right font-semibold py-2 px-3">Pickup&nbsp;%<Info text="Answered ÷ calls. The only rate here measured against every dial — it is the metric that asks whether anyone picked up. Bracketed number is the answered count." /></th>
                <th className="text-right font-semibold py-2 px-3">Demos<Info text="Calls whose outcome was “Demo booked” in the period." /></th>
                <th className="text-right font-semibold py-2 px-3">Demo&nbsp;%<Info text="Demos ÷ ANSWERED calls. Divided by answered, not total dials: an unanswered phone cannot book a demo, so including it would only dilute the rate by your pickup rate." /></th>
                <th className="text-right font-semibold py-2 px-3">Won&nbsp;%<Info text="Calls whose demo was later marked Won ÷ ANSWERED calls. Same answered-based denominator as Demo %, so the two are directly comparable." /></th>
                <th className="text-right font-semibold py-2 px-3">No&nbsp;answer<Info text="Calls whose outcome was “No answer” — nobody picked up." /></th>
                <th className="text-right font-semibold py-2 px-3">Not&nbsp;int.<Info text="Calls whose outcome was “Not interested”." /></th>
                <th className="text-right font-semibold py-2 px-3">Not&nbsp;int.&nbsp;%<Info text="Not interested ÷ ANSWERED calls. Only someone who picked up can decline, so dials that never connected are excluded." /></th>
                <th className="text-right font-semibold py-2 pl-3">Callbacks<Info text="Calls whose outcome was “Call back later” — still open, not lost." /></th>
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
                    <td className="text-right tabular-nums text-gray-300 py-2.5 px-3">{m.calls ? pctOf(m.pickupRate, m.answered) : '—'}</td>
                    <td className="text-right tabular-nums text-green-400 py-2.5 px-3">{m.demos}</td>
                    <td className="text-right tabular-nums text-gray-300 py-2.5 px-3">{m.answered ? pctFrac(m.demoRate, m.demos, m.answered) : '—'}</td>
                    <td className="text-right tabular-nums text-green-400 py-2.5 px-3">{m.answered ? pctFrac(m.wonRate, m.won, m.answered) : '—'}</td>
                    <td className="text-right tabular-nums text-gray-500 py-2.5 px-3">{m.noAnswer}</td>
                    <td className="text-right tabular-nums text-gray-500 py-2.5 px-3">{m.notInterested}</td>
                    <td className="text-right tabular-nums text-red-400/80 py-2.5 px-3">{m.answered ? pctFrac0(m.notInterestedRate, m.notInterested, m.answered) : '—'}</td>
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
                    <td className="text-right tabular-nums text-gray-200 py-2.5 px-3">{m.calls ? pctOf(m.pickupRate, m.answered) : '—'}</td>
                    <td className="text-right tabular-nums text-green-400 py-2.5 px-3">{m.demos}</td>
                    <td className="text-right tabular-nums text-gray-200 py-2.5 px-3">{m.answered ? pctFrac(m.demoRate, m.demos, m.answered) : '—'}</td>
                    <td className="text-right tabular-nums text-green-300 py-2.5 px-3">{m.answered ? pctFrac(m.wonRate, m.won, m.answered) : '—'}</td>
                    <td className="text-right tabular-nums text-gray-500 py-2.5 px-3">{m.noAnswer}</td>
                    <td className="text-right tabular-nums text-gray-500 py-2.5 px-3">{m.notInterested}</td>
                    <td className="text-right tabular-nums text-red-400/80 py-2.5 px-3">{m.answered ? pctFrac0(m.notInterestedRate, m.notInterested, m.answered) : '—'}</td>
                    <td className="text-right tabular-nums text-gray-500 py-2.5 pl-3">{m.callback}</td>
                  </tr>
                )
              })()}
            </tbody>
          </table>
        </div>
      </div>

      {/* Sales performance: dials/demo, decision-maker conversion */}
      <div className="bg-gray-900 rounded-xl p-5">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Sales Performance</h2>
          <span className="text-[10px] text-gray-600">{period === 'today' ? 'Today' : period === 'week' ? 'This week' : 'All time'}</span>
        </div>
        {events.length === 0 ? (
          <p className="text-xs text-gray-600">No logged calls yet — these numbers start filling in as you use the dialer.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[520px]">
              <thead>
                <tr className="text-xs text-gray-500 uppercase tracking-wider border-b border-gray-800">
                  <th className="text-left font-semibold py-2 pr-3">Caller</th>
                  <th className="text-right font-semibold py-2 px-3">Dials&nbsp;/&nbsp;Demo<Info text="Total dials ÷ demos booked. Deliberately per DIAL, not per answered call — it answers &quot;how much dialling does one demo cost me&quot;, which is a volume question. Lower is better." /></th>
                  <th className="text-right font-semibold py-2 px-3">Reached&nbsp;DM&nbsp;%<Info text="Calls where you toggled &quot;Reached decision-maker&quot; ÷ ANSWERED calls. You can only reach a decision-maker in a conversation, so unanswered dials are excluded. Only counts calls logged since that toggle shipped." /></th>
                  <th className="text-right font-semibold py-2 pl-3">DM&nbsp;→&nbsp;Demo&nbsp;%<Info text="Demos booked ÷ calls where you reached the decision-maker. Measures your pitch once you have the right person on the line — the pure closing number." /></th>
                </tr>
              </thead>
              <tbody>
                {CALLERS.map(caller => {
                  const em = aggregateEvents(periodEvents.filter(e => e.caller_name === caller))
                  return (
                    <tr key={caller} className="border-b border-gray-800/60">
                      <td className="py-2.5 pr-3">
                        <span className="flex items-center gap-2 text-gray-200 font-medium">
                          <span className="w-2 h-2 rounded-full" style={{ background: caller === 'Leonard' ? LEONARD_COLOR : WILLIAM_COLOR }} />
                          {caller}
                        </span>
                      </td>
                      <td className="text-right tabular-nums text-white py-2.5 px-3">{em.dialsPerDemo != null ? em.dialsPerDemo.toFixed(0) : '—'}</td>
                      <td className="text-right tabular-nums text-blue-400 py-2.5 px-3">{em.dmReachedRate != null ? pctFrac0(em.dmReachedRate, em.dmReached, em.answered) : '—'}</td>
                      <td className="text-right tabular-nums text-green-400 py-2.5 pl-3">{em.dmToDemoRate != null ? pct(em.dmToDemoRate) : '—'}</td>
                    </tr>
                  )
                })}
                {(() => {
                  const em = aggregateEvents(periodEvents)
                  return (
                    <tr className="font-semibold">
                      <td className="py-2.5 pr-3 text-gray-300">Team total</td>
                      <td className="text-right tabular-nums text-white py-2.5 px-3">{em.dialsPerDemo != null ? em.dialsPerDemo.toFixed(0) : '—'}</td>
                      <td className="text-right tabular-nums text-blue-300 py-2.5 px-3">{em.dmReachedRate != null ? pctFrac0(em.dmReachedRate, em.dmReached, em.answered) : '—'}</td>
                      <td className="text-right tabular-nums text-green-300 py-2.5 pl-3">{em.dmToDemoRate != null ? pct(em.dmToDemoRate) : '—'}</td>
                    </tr>
                  )
                })()}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-[10px] text-gray-600 mt-3">
          &quot;Reached DM&quot; = you toggled &quot;Reached decision-maker&quot; on the call. Only calls logged since this feature shipped are counted.
        </p>
      </div>

      {/* Demo performance + callback conversion */}
      <div className="grid sm:grid-cols-2 gap-4">
        <div className="bg-gray-900 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">
            Demo Performance (all time)
            <Info text="What happens after a demo is booked: whether it was held, and whether it was won. Independent of the call metrics above — these count demos, not calls." />
          </h2>
          <div className="grid grid-cols-3 gap-3">
            <DayStat label="Show rate" info="Demos held ÷ demos that resolved either way (held + no-show). Demos still in the future are excluded, so a full calendar doesn't drag it down." value={demoStats.showRate != null ? pct(demoStats.showRate) : '—'} />
            <DayStat label="Win rate" info="Demos marked Won ÷ demos with a decided outcome (Won + Lost). Demos awaiting an outcome are excluded." value={demoStats.winRate != null ? pct(demoStats.winRate) : '—'} />
            <DayStat label="Won / answered" info="Deals won ÷ answered calls (all time). The bottom line: of every conversation you actually had, how many ended as a paying customer. Divided by answered rather than dials so it doesn't sink just because pickup was low." value={allM.answered ? pct1(demoStats.won / allM.answered) : '—'} />
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1 mt-3 text-xs text-gray-500">
            <span>{demoStats.held} held</span>
            <span>{demoStats.noShow} no-show</span>
            <span>{demoStats.won} won</span>
            <span>{demoStats.lost} lost</span>
            {demoStats.considering > 0 && (
              <span className="text-amber-300/80">{demoStats.considering} under behandling</span>
            )}
            {demoStats.pending > 0 && <span>{demoStats.pending} pending outcome</span>}
          </div>
          {demoStats.totalBooked === 0 && <p className="text-xs text-gray-600 mt-2">No demos booked yet.</p>}
        </div>

        <div className="bg-gray-900 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Callback Conversion (all time)</h2>
          <DayStat label="Callbacks → Demo" info="Of the companies ever marked “Call back later”, the share that later became a booked demo. Measures whether chasing callbacks is worth the time." value={callbackConversion.rate != null ? pct(callbackConversion.rate) : '—'} />
          <p className="text-xs text-gray-600 mt-2">
            {callbackConversion.hadCallback === 0
              ? 'No callbacks logged yet.'
              : `${callbackConversion.converted} of ${callbackConversion.hadCallback} companies marked "Call back later" later became a demo.`}
          </p>
        </div>
      </div>

      {/* Industry performance — which vertical is worth the dials */}
      <div className="bg-gray-900 rounded-xl p-5">
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">
          Performance by Industry
          <Info text="One row per industry (Bilverksted, Rørlegger, …), ranked best first by demo rate. Demo % is demos ÷ ANSWERED calls — same denominator as everywhere else — and pickup is answered ÷ dials, since with a new vertical the first question is whether anyone answers at all. 'Ukjent' collects calls to companies made before industries were tagged or since deleted. Follows the period tabs above." />
        </h2>
        {industries.length === 0 ? (
          <p className="text-xs text-gray-600">Not enough data yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[480px]">
              <thead>
                <tr className="text-xs text-gray-500 uppercase tracking-wider border-b border-gray-800">
                  <th className="text-left font-semibold py-2 pr-3">Industry</th>
                  <th className="text-right font-semibold py-2 px-3">Dials</th>
                  <th className="text-right font-semibold py-2 px-3">Pickup&nbsp;%</th>
                  <th className="text-right font-semibold py-2 px-3">Demos</th>
                  <th className="text-right font-semibold py-2 pl-3">Demo&nbsp;%</th>
                </tr>
              </thead>
              <tbody>
                {industries.map((ind, i) => (
                  <tr key={ind.industry} className="border-b border-gray-800/50">
                    <td className="py-2.5 pr-3 text-white">
                      {i === 0 && industries.length > 1 && ind.demos > 0 && <span className="mr-1.5" aria-hidden>🏆</span>}
                      {ind.industry}
                    </td>
                    <td className="text-right tabular-nums text-gray-300 py-2.5 px-3">{ind.dials}</td>
                    <td className="text-right tabular-nums text-gray-300 py-2.5 px-3">
                      {ind.pickupRate != null ? pct(ind.pickupRate) : '—'}
                      <span className="text-gray-600"> ({ind.answered})</span>
                    </td>
                    <td className="text-right tabular-nums text-gray-300 py-2.5 px-3">{ind.demos}</td>
                    <td className="text-right tabular-nums text-green-400 py-2.5 pl-3">
                      {ind.demoRate != null ? pctFrac(ind.demoRate, ind.demos, ind.answered) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Revenue-tier performance + best time to call */}
      <div className="grid sm:grid-cols-2 gap-4">
        <div className="bg-gray-900 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">
            Performance by Revenue Tier
            <Info text="Demo rate per revenue band, using the company's revenue at the time of the call. Bar and percentage are demos ÷ ANSWERED calls in that band, so a band that simply answers more often doesn't look like it converts better. The fraction is demos/answered." />
          </h2>
          {tierPerf.length === 0 ? (
            <p className="text-xs text-gray-600">Not enough data yet.</p>
          ) : (
            <div className="space-y-2">
              {tierPerf.map(t => (
                <div key={t.tier} className="flex items-center gap-3 text-sm">
                  <span className="w-16 text-gray-400 text-xs shrink-0">{t.tier}</span>
                  <div className="flex-1 h-2 bg-gray-800 rounded-full overflow-hidden">
                    <div className="h-full bg-white rounded-full" style={{ width: `${Math.min(100, (t.demoRate ?? 0) * 100)}%` }} />
                  </div>
                  <span className="text-xs text-gray-500 w-24 text-right tabular-nums">{t.demos}/{t.answered} · {t.demoRate != null ? pct(t.demoRate) : '—'}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-gray-900 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">
            Best Time to Call (all time)
            <Info text="Pickup rate by hour of day (your local time), from logged calls. Bar and percentage are answered ÷ dials in that hour. Hours with very few dials are noisy — check the dial count beside each bar before trusting it." />
          </h2>
          {hourly.length === 0 ? (
            <p className="text-xs text-gray-600">Not enough data yet.</p>
          ) : (
            <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
              {hourly.map(h => (
                <div key={h.hour} className="flex items-center gap-3 text-sm">
                  <span className="w-12 text-gray-400 text-xs shrink-0 tabular-nums">{String(h.hour).padStart(2, '0')}:00</span>
                  <div className="flex-1 h-2 bg-gray-800 rounded-full overflow-hidden">
                    <div className="h-full bg-white rounded-full" style={{ width: `${h.pickupRate * 100}%` }} />
                  </div>
                  <span className="text-xs text-gray-500 w-24 text-right tabular-nums">{h.dials} dials · {pct(h.pickupRate)}</span>
                </div>
              ))}
            </div>
          )}
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
              <DayStat label="Pickup %" value={dm.calls ? pctOf(dm.pickupRate, dm.answered) : '—'} />
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

            {/* Your own note for the day (tactics, reflections, etc.) */}
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">My notes for this day</h3>
            <div className="flex items-start gap-2 mb-3">
              <textarea
                value={noteDraft}
                onChange={e => setNoteDraft(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) addDayNote() }}
                placeholder="What tactic did you use today? Anything worth remembering…"
                rows={2}
                className="flex-1 bg-gray-950 border border-gray-800 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-white resize-y"
              />
              <button
                onClick={addDayNote}
                disabled={savingNote || !noteDraft.trim()}
                className="px-3 py-2 bg-white hover:bg-gray-200 disabled:opacity-40 disabled:cursor-not-allowed text-black text-sm rounded-lg transition-colors shrink-0"
              >
                {savingNote ? 'Saving…' : 'Add'}
              </button>
            </div>
            {myDayNotes.length > 0 && (
              <div className="space-y-2 mb-5">
                {myDayNotes.map(n => (
                  <div key={n.id} className="bg-blue-950/20 border border-blue-900/40 rounded-lg p-3">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-blue-400">
                        {n.caller_name ? `${n.caller_name} · ` : ''}{format(parseISO(n.created_at), 'HH:mm')}
                      </span>
                      <button onClick={() => deleteDayNote(n.id)} className="text-[10px] text-gray-600 hover:text-red-400 shrink-0">Delete</button>
                    </div>
                    <p className="text-sm text-gray-300 whitespace-pre-wrap">{n.note}</p>
                  </div>
                ))}
              </div>
            )}

            {/* Notes attached to companies called this day */}
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
              Call notes{companyNotes.length ? ` (${companyNotes.length})` : ''}
            </h3>
            {loadingNotes ? (
              <p className="text-xs text-gray-600">Loading…</p>
            ) : companyNotes.length === 0 ? (
              <p className="text-xs text-gray-600">No call notes this day.</p>
            ) : (
              <div className="space-y-2">
                {companyNotes.map((n, i) => (
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

function DayStat({ label, value, info }: { label: string; value: string; info?: string }) {
  return (
    <div className="bg-gray-950 rounded-lg p-3">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-600 block">
        {label}{info && <Info text={info} />}
      </span>
      <span className="text-xl font-bold tabular-nums text-white">{value}</span>
    </div>
  )
}

function Kpi({ label, info, children }: { label: string; info?: string; children: React.ReactNode }) {
  return (
    <div className="bg-gray-900 rounded-xl p-4 flex flex-col gap-1">
      <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
        {label}{info && <Info text={info} />}
      </span>
      {children}
    </div>
  )
}
