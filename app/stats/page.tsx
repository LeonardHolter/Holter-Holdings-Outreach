export const dynamic = 'force-dynamic'

import { createClient } from '@/lib/supabase/server'
import type { Company } from '@/types'
import { Nav } from '@/components/Nav'
import { Suspense } from 'react'
import PeriodSelector, { type Period } from '@/components/PeriodSelector'

// ── Date helpers ─────────────────────────────────────────────────────────────

function startOf(period: Period): string | null {
  if (period === 'all') return null
  const d = new Date()
  if (period === 'day')   d.setHours(0, 0, 0, 0)
  if (period === 'week')  d.setDate(d.getDate() - 7)
  if (period === 'month') d.setDate(d.getDate() - 30)
  return d.toISOString()
}

// ── Data fetching ─────────────────────────────────────────────────────────────

interface RecordingRow {
  called_by: string | null
  duration_seconds: number | null
}

async function fetchAll(since: string | null): Promise<Company[]> {
  const supabase = await createClient()
  let q = supabase
    .from('companies')
    .select('reach_out_response,who_called,state,google_reviews,amount_of_calls,last_reach_out')
  if (since) q = q.gte('last_reach_out', since.slice(0, 10))
  const { data, error } = await q
  if (error) return []
  return (data as Company[]) ?? []
}

async function fetchAllTime(): Promise<Company[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('companies')
    .select('reach_out_response,state,google_reviews,amount_of_calls')
  return (data as Company[]) ?? []
}

async function fetchRecordingStats(since: string | null): Promise<RecordingRow[]> {
  const supabase = await createClient()
  let q = supabase
    .from('call_recordings')
    .select('called_by, duration_seconds')
    .not('called_by', 'is', null)
  if (since) q = q.gte('called_at', since)
  const { data } = await q
  return (data as RecordingRow[]) ?? []
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtTime(s: number) {
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function StatsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>
}) {
  const { period: rawPeriod } = await searchParams
  const period: Period = (['day', 'week', 'month', 'all'] as Period[]).includes(rawPeriod as Period)
    ? (rawPeriod as Period)
    : 'all'

  const since = startOf(period)

  const [periodCompanies, allTimeCompanies, recordings] = await Promise.all([
    fetchAll(since),
    period === 'all' ? Promise.resolve([] as Company[]) : fetchAllTime(),
    fetchRecordingStats(since),
  ])

  // For "all" period, pipeline totals come from periodCompanies (= full set)
  // For other periods, pipeline totals always come from allTimeCompanies
  const pipeline = period === 'all' ? periodCompanies : allTimeCompanies

  // Activity stats — filtered by period
  const activity = periodCompanies

  const total        = pipeline.length
  const called       = pipeline.filter(c => c.reach_out_response && c.reach_out_response !== 'Not called').length
  const notCalled    = pipeline.filter(c => !c.reach_out_response || c.reach_out_response === 'Not called').length
  const introMeetings      = activity.filter(c => c.reach_out_response === 'Intro-meeting wanted').length
  const notInterested      = activity.filter(c => c.reach_out_response === 'Owner is not interested').length
  const alreadyAcquired    = activity.filter(c => c.reach_out_response === 'Already acquired').length
  const didNotReach        = activity.filter(c => c.reach_out_response === 'Did not reach the Owner').length
  const notGarageDoor      = activity.filter(c => c.reach_out_response === 'Not a garage door service company').length
  const noNumber           = activity.filter(c => c.reach_out_response === 'Number does not exist').length

  const activeCalls  = period === 'all' ? called : activity.length
  const introRate    = activeCalls > 0 ? ((introMeetings / activeCalls) * 100).toFixed(1) : '0.0'
  const totalDialed  = period === 'all'
    ? pipeline.reduce((s, c) => s + (c.amount_of_calls ?? 0), 0)
    : activity.reduce((s, c) => s + (c.amount_of_calls ?? 0), 0)

  const callerColorMap: Record<string, string> = {
    leonard: 'bg-blue-500',
    tommaso: 'bg-violet-500',
    john: 'bg-emerald-500',
    sunzim: 'bg-amber-500',
    daniel: 'bg-rose-500',
    ellison: 'bg-cyan-500',
  }

  const whoCalledMap: Record<string, number> = {}
  const callVolumeMap: Record<string, number> = {}
  const introByCallerMap: Record<string, number> = {}
  activity.forEach(c => {
    if (c.who_called) {
      whoCalledMap[c.who_called] = (whoCalledMap[c.who_called] ?? 0) + 1
      callVolumeMap[c.who_called] = (callVolumeMap[c.who_called] ?? 0) + (c.amount_of_calls ?? 0)
      if (c.reach_out_response === 'Intro-meeting wanted') {
        introByCallerMap[c.who_called] = (introByCallerMap[c.who_called] ?? 0) + 1
      }
    }
  })

  // "Most Calls" should reflect call volume, not just number of company rows touched.
  const callers = Object.entries(callVolumeMap)
    .map(([name, calls]) => ({
      name,
      calls,
      color: callerColorMap[name.toLowerCase()] ?? 'bg-indigo-500',
    }))
    .sort((a, b) => b.calls - a.calls)
  const maxCalls = Math.max(...callers.map(c => c.calls), 1)

  const whoCalledEntries = Object.entries(whoCalledMap).sort((a, b) => b[1] - a[1])

  const leaderboardCalls = [...callers].sort((a, b) => b.calls - a.calls).filter(c => c.calls > 0)
  // Use the SAME call denominator as "Most Calls" to avoid mismatch
  // between leaderboard cards (e.g. 136 vs 260 for the same person).
  const leaderboardIntroRate = Object.entries(whoCalledMap)
    .filter(([, companyCount]) => companyCount >= 50)
    .map(([name, companyCount]) => ({
      name,
      companies: companyCount,
      intros: introByCallerMap[name] ?? 0,
      rate: ((introByCallerMap[name] ?? 0) / companyCount) * 100,
    }))
    .sort((a, b) => b.rate - a.rate)

  // Talk time analytics
  const talkMap: Record<string, { recordedCalls: number; totalSeconds: number }> = {}
  for (const r of recordings) {
    const name = r.called_by!
    if (!talkMap[name]) talkMap[name] = { recordedCalls: 0, totalSeconds: 0 }
    talkMap[name].recordedCalls++
    talkMap[name].totalSeconds += r.duration_seconds ?? 0
  }
  const talkStats = Object.entries(talkMap)
    .map(([name, { recordedCalls, totalSeconds }]) => ({
      name, recordedCalls, totalSeconds,
      avgSeconds: recordedCalls > 0 ? Math.round(totalSeconds / recordedCalls) : 0,
    }))
    .sort((a, b) => b.totalSeconds - a.totalSeconds)
  const maxTalkSeconds = Math.max(...talkStats.map(s => s.totalSeconds), 1)

  // State breakdown (all-time pipeline)
  const stateMap: Record<string, { total: number; called: number; intro: number }> = {}
  pipeline.forEach(c => {
    const s = c.state ?? 'Unknown'
    if (!stateMap[s]) stateMap[s] = { total: 0, called: 0, intro: 0 }
    stateMap[s].total++
    if (c.reach_out_response && c.reach_out_response !== 'Not called') stateMap[s].called++
    if (c.reach_out_response === 'Intro-meeting wanted') stateMap[s].intro++
  })
  const stateEntries = Object.entries(stateMap).sort((a, b) => b[1].total - a[1].total)

  const responseBreakdown = [
    { label: 'Did not reach the Owner',           count: didNotReach,    color: 'bg-gray-500' },
    { label: 'Intro-meeting wanted',              count: introMeetings,  color: 'bg-green-500' },
    { label: 'Owner is not interested',           count: notInterested,  color: 'bg-red-500' },
    { label: 'Already acquired',                  count: alreadyAcquired, color: 'bg-red-600' },
    { label: 'Not a garage door service company', count: notGarageDoor,  color: 'bg-orange-500' },
    { label: 'Number does not exist',             count: noNumber,       color: 'bg-gray-700' },
  ].filter(r => r.count > 0)

  const periodLabel = period === 'day' ? 'today' : period === 'week' ? 'last 7 days' : period === 'month' ? 'last 30 days' : 'all time'

  return (
    <div className="flex flex-col h-[100dvh] overflow-hidden bg-gray-950">
      <Nav />

      <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-6 space-y-6">

        {/* Header + period selector */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-white">Stats</h1>
            <p className="text-sm text-gray-500 mt-0.5 capitalize">Showing activity for {periodLabel}</p>
          </div>
          <Suspense fallback={null}>
            <PeriodSelector current={period} />
          </Suspense>
        </div>

        {/* Top KPIs */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <KPI label="Total Companies"   value={total.toLocaleString()} />
          <KPI label="Called"            value={called.toLocaleString()} sub={`${((called / Math.max(total, 1)) * 100).toFixed(0)}% of total`} />
          <KPI label="Not Yet Called"    value={notCalled.toLocaleString()} color="text-gray-400" />
          <KPI label={period === 'all' ? 'Intro Meetings' : 'Intros (period)'} value={introMeetings.toString()} color="text-green-400" sub={`${introRate}% rate`} />
          <KPI label="Not Interested"    value={notInterested.toString()} color="text-red-400" />
          <KPI label="Total Dialed" value={totalDialed.toLocaleString()} color="text-blue-400" />
        </div>

        {/* Leaderboard */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wide mb-4 flex items-center gap-2">
              <span>📞</span> Most Calls
            </h2>
            <div className="space-y-2">
              {leaderboardCalls.slice(0, 5).map((c, i) => (
                <div key={c.name} className="flex items-center gap-3">
                  <span className="text-lg w-7 text-center shrink-0">
                    {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : <span className="text-sm text-gray-600 font-bold">#{i + 1}</span>}
                  </span>
                  <span className="flex-1 text-sm font-medium text-white">{c.name}</span>
                  <div className="flex items-center gap-2">
                    <div className="w-24 bg-gray-800 rounded-full h-1.5 overflow-hidden">
                      <div className={`h-1.5 rounded-full ${c.color}`} style={{ width: `${(c.calls / (leaderboardCalls[0]?.calls || 1)) * 100}%` }} />
                    </div>
                    <span className="text-sm font-bold tabular-nums text-white w-8 text-right">{c.calls}</span>
                  </div>
                </div>
              ))}
              {leaderboardCalls.length === 0 && <p className="text-gray-600 text-sm">No calls in this period</p>}
            </div>
          </div>

          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wide mb-4 flex items-center gap-2">
              <span>🤝</span> Highest Intro Rate
            </h2>
            <div className="space-y-2">
              {leaderboardIntroRate.slice(0, 5).map((c, i) => (
                <div key={c.name} className="flex items-center gap-3">
                  <span className="text-lg w-7 text-center shrink-0">
                    {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : <span className="text-sm text-gray-600 font-bold">#{i + 1}</span>}
                  </span>
                  <span className="flex-1 text-sm font-medium text-white">{c.name}</span>
                  <div className="flex items-center gap-2">
                    <div className="w-24 bg-gray-800 rounded-full h-1.5 overflow-hidden">
                      <div className="h-1.5 rounded-full bg-green-500" style={{ width: `${(c.rate / (leaderboardIntroRate[0]?.rate || 1)) * 100}%` }} />
                    </div>
                    <span className="text-sm font-bold tabular-nums text-green-400 w-20 text-right">
                      {c.rate.toFixed(1)}%
                      <span className="text-gray-600 font-normal text-xs ml-1">({c.intros}/{c.companies})</span>
                    </span>
                  </div>
                </div>
              ))}
              {leaderboardIntroRate.length === 0 && <p className="text-gray-600 text-sm">Need at least 50 calls per person</p>}
            </div>
          </div>
        </div>

        {/* Talk Time Analytics */}
        {talkStats.length > 0 && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wide mb-1 flex items-center gap-2">
              <span>🎙</span> Talk Time Analytics
            </h2>
            <p className="text-xs text-gray-600 mb-5">Actual conversation time from recorded calls (not all dials are recorded)</p>
            <div className="grid grid-cols-12 gap-2 text-xs text-gray-600 uppercase tracking-wide font-medium mb-3 px-1">
              <span className="col-span-2">Rep</span>
              <span className="col-span-4">Talk time</span>
              <span className="col-span-2 text-right">Total</span>
              <span className="col-span-2 text-right">Calls</span>
              <span className="col-span-2 text-right">Avg/call</span>
            </div>
            <div className="space-y-4">
              {talkStats.map(s => (
                <div key={s.name} className="space-y-1.5">
                  <div className="grid grid-cols-12 gap-2 items-center">
                    <span className="col-span-2 text-sm font-medium text-white truncate">{s.name}</span>
                    <div className="col-span-4 bg-gray-800 rounded-full h-2 overflow-hidden">
                      <div className="h-2 rounded-full bg-teal-500" style={{ width: `${(s.totalSeconds / maxTalkSeconds) * 100}%` }} />
                    </div>
                    <span className="col-span-2 text-sm font-bold tabular-nums text-teal-400 text-right">{fmtTime(s.totalSeconds)}</span>
                    <span className="col-span-2 text-sm tabular-nums text-gray-400 text-right">{s.recordedCalls}</span>
                    <span className="col-span-2 text-sm tabular-nums text-gray-400 text-right">{fmtTime(s.avgSeconds)}</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-5 pt-4 border-t border-gray-800 flex flex-wrap gap-6">
              <div>
                <p className="text-xs text-gray-600 uppercase tracking-wide">Total talk time</p>
                <p className="text-lg font-bold text-white tabular-nums mt-0.5">{fmtTime(talkStats.reduce((s, r) => s + r.totalSeconds, 0))}</p>
              </div>
              <div>
                <p className="text-xs text-gray-600 uppercase tracking-wide">Recorded calls</p>
                <p className="text-lg font-bold text-white tabular-nums mt-0.5">{talkStats.reduce((s, r) => s + r.recordedCalls, 0)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-600 uppercase tracking-wide">Overall avg</p>
                <p className="text-lg font-bold text-white tabular-nums mt-0.5">
                  {(() => {
                    const tot = talkStats.reduce((s, r) => s + r.totalSeconds, 0)
                    const cnt = talkStats.reduce((s, r) => s + r.recordedCalls, 0)
                    return fmtTime(cnt > 0 ? Math.round(tot / cnt) : 0)
                  })()}
                </p>
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          <Card title="Calls by Team Member">
            <div className="space-y-3">
              {callers.map(c => (
                <div key={c.name} className="flex items-center gap-3">
                  <span className="text-sm text-gray-300 w-16 shrink-0">{c.name}</span>
                  <div className="flex-1 bg-gray-800 rounded-full h-2 overflow-hidden">
                    <div className={`h-2 rounded-full ${c.color}`} style={{ width: `${(c.calls / maxCalls) * 100}%` }} />
                  </div>
                  <span className="text-sm font-semibold tabular-nums text-white w-8 text-right">{c.calls}</span>
                </div>
              ))}
            </div>
          </Card>

          <Card title="Companies Called By">
            <div className="space-y-2">
              {whoCalledEntries.length === 0 ? (
                <p className="text-gray-500 text-sm">No data for this period</p>
              ) : whoCalledEntries.map(([name, count]) => {
                const pct = Math.round((count / Math.max(activeCalls, 1)) * 100)
                return (
                  <div key={name} className="flex items-center gap-3">
                    <span className="text-sm text-gray-300 w-20 shrink-0">{name}</span>
                    <div className="flex-1 bg-gray-800 rounded-full h-2 overflow-hidden">
                      <div className="h-2 rounded-full bg-indigo-500" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-sm font-semibold tabular-nums text-white w-16 text-right">{count} <span className="text-gray-500 font-normal text-xs">({pct}%)</span></span>
                  </div>
                )
              })}
            </div>
          </Card>

          <Card title={`Response Breakdown${period !== 'all' ? ' (period)' : ''}`}>
            <div className="space-y-2">
              {responseBreakdown.length === 0 ? (
                <p className="text-gray-500 text-sm">No responses in this period</p>
              ) : responseBreakdown.map(r => (
                <div key={r.label} className="flex items-center gap-3">
                  <div className={`w-2 h-2 rounded-full shrink-0 ${r.color}`} />
                  <span className="text-sm text-gray-300 flex-1 truncate">{r.label}</span>
                  <span className="text-sm font-semibold tabular-nums text-white">{r.count}</span>
                  <span className="text-xs text-gray-500 w-10 text-right">
                    {((r.count / Math.max(total, 1)) * 100).toFixed(1)}%
                  </span>
                </div>
              ))}
            </div>
          </Card>

          <Card title="By State">
            <div className="space-y-2">
              {stateEntries.map(([state, s]) => (
                <div key={state} className="flex items-center gap-3">
                  <span className="text-sm font-mono text-gray-400 w-10 shrink-0">{state}</span>
                  <div className="flex-1 bg-gray-800 rounded-full h-2 overflow-hidden">
                    <div className="h-2 rounded-full bg-sky-500" style={{ width: `${(s.total / Math.max(total, 1)) * 100}%` }} />
                  </div>
                  <div className="flex items-center gap-2 text-sm tabular-nums">
                    <span className="text-white font-semibold w-8 text-right">{s.total}</span>
                    <span className="text-gray-500">|</span>
                    <span className="text-gray-400">{s.called} called</span>
                    {s.intro > 0 && <span className="text-green-400">{s.intro} intro</span>}
                  </div>
                </div>
              ))}
            </div>
          </Card>

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

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
      <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wide mb-4">{title}</h2>
      {children}
    </div>
  )
}
