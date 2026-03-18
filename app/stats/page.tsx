export const dynamic = 'force-dynamic'

import { createClient } from '@/lib/supabase/server'
import type { Company } from '@/types'
import { Nav } from '@/components/Nav'

interface RecordingRow {
  called_by: string | null
  duration_seconds: number | null
}

async function fetchAll(): Promise<Company[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('companies')
    .select('reach_out_response,who_called,calls_leonard,calls_tommaso,calls_john,calls_sunzim,calls_daniel,calls_ellison,total_dialed,state,google_reviews,amount_of_calls')
  if (error) return []
  return (data as Company[]) ?? []
}

async function fetchRecordingStats(): Promise<RecordingRow[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('call_recordings')
    .select('called_by, duration_seconds')
    .not('called_by', 'is', null)
  return (data as RecordingRow[]) ?? []
}

export default async function StatsPage() {
  const [companies, recordings] = await Promise.all([fetchAll(), fetchRecordingStats()])

  const total = companies.length
  const called = companies.filter(c => c.reach_out_response && c.reach_out_response !== 'Not called').length
  const notCalled = companies.filter(c => !c.reach_out_response || c.reach_out_response === 'Not called').length
  const introMeetings = companies.filter(c => c.reach_out_response === 'Intro-meeting wanted').length
  const notInterested = companies.filter(c => c.reach_out_response === 'Owner is not interested').length
  const alreadyAcquired = companies.filter(c => c.reach_out_response === 'Already acquired').length
  const leftMessage = companies.filter(c => c.reach_out_response === 'Left a message to the owner').length
  const noAnswer = companies.filter(c => c.reach_out_response === 'Did not pick up').length
  const didNotReach = companies.filter(c => c.reach_out_response === 'Did not reach the Owner').length
  const callBack = companies.filter(c => c.reach_out_response === 'Call back on Monday').length
  const notGarageDoor = companies.filter(c => c.reach_out_response === 'Not a garage door service company').length
  const noNumber = companies.filter(c => c.reach_out_response === 'Number does not exist').length

  const introRate = called > 0 ? ((introMeetings / called) * 100).toFixed(1) : '0.0'

  const totalDialed = companies.reduce((s, c) => s + (c.total_dialed ?? 0), 0)

  const callers = [
    { name: 'Leonard',  calls: companies.reduce((s, c) => s + (c.calls_leonard ?? 0), 0),  color: 'bg-blue-500' },
    { name: 'Tommaso',  calls: companies.reduce((s, c) => s + (c.calls_tommaso ?? 0), 0),  color: 'bg-violet-500' },
    { name: 'John',     calls: companies.reduce((s, c) => s + (c.calls_john ?? 0), 0),     color: 'bg-emerald-500' },
    { name: 'Sunzim',   calls: companies.reduce((s, c) => s + (c.calls_sunzim ?? 0), 0),   color: 'bg-amber-500' },
    { name: 'Daniel',   calls: companies.reduce((s, c) => s + (c.calls_daniel ?? 0), 0),   color: 'bg-rose-500' },
    { name: 'Ellison',  calls: companies.reduce((s, c) => s + (c.calls_ellison ?? 0), 0),  color: 'bg-cyan-500' },
  ]
  const maxCalls = Math.max(...callers.map(c => c.calls), 1)

  // Who Called breakdown (from who_called field)
  const whoCalledMap: Record<string, number> = {}
  const introByCallerMap: Record<string, number> = {}
  companies.forEach(c => {
    if (c.who_called) {
      whoCalledMap[c.who_called] = (whoCalledMap[c.who_called] ?? 0) + 1
      if (c.reach_out_response === 'Intro-meeting wanted') {
        introByCallerMap[c.who_called] = (introByCallerMap[c.who_called] ?? 0) + 1
      }
    }
  })
  const whoCalledEntries = Object.entries(whoCalledMap).sort((a, b) => b[1] - a[1])

  // Leaderboard data
  const leaderboardCalls = [...callers].sort((a, b) => b.calls - a.calls).filter(c => c.calls > 0)
  const leaderboardIntroRate = Object.entries(whoCalledMap)
    .filter(([, count]) => count >= 3)
    .map(([name, callCount]) => ({
      name,
      calls: callCount,
      intros: introByCallerMap[name] ?? 0,
      rate: ((introByCallerMap[name] ?? 0) / callCount) * 100,
    }))
    .sort((a, b) => b.rate - a.rate)

  // Talk time analytics — per rep from call_recordings
  const talkMap: Record<string, { recordedCalls: number; totalSeconds: number }> = {}
  for (const r of recordings) {
    const name = r.called_by!
    if (!talkMap[name]) talkMap[name] = { recordedCalls: 0, totalSeconds: 0 }
    talkMap[name].recordedCalls++
    talkMap[name].totalSeconds += r.duration_seconds ?? 0
  }
  // Merge with dial attempt counts (from whoCalledMap = companies.who_called field)
  const talkStats = Object.entries(talkMap)
    .map(([name, { recordedCalls, totalSeconds }]) => ({
      name,
      recordedCalls,
      totalSeconds,
      dialAttempts: whoCalledMap[name] ?? 0,
      avgSeconds: recordedCalls > 0 ? Math.round(totalSeconds / recordedCalls) : 0,
    }))
    .sort((a, b) => b.totalSeconds - a.totalSeconds)

  const maxTalkSeconds = Math.max(...talkStats.map(s => s.totalSeconds), 1)

  function fmtTime(s: number) {
    if (s < 60) return `${s}s`
    if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`
    return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
  }

  // State breakdown
  const stateMap: Record<string, { total: number; called: number; intro: number }> = {}
  companies.forEach(c => {
    const s = c.state ?? 'Unknown'
    if (!stateMap[s]) stateMap[s] = { total: 0, called: 0, intro: 0 }
    stateMap[s].total++
    if (c.reach_out_response && c.reach_out_response !== 'Not called') stateMap[s].called++
    if (c.reach_out_response === 'Intro-meeting wanted') stateMap[s].intro++
  })
  const stateEntries = Object.entries(stateMap).sort((a, b) => b[1].total - a[1].total)

  // Response breakdown
  const responseBreakdown = [
    { label: 'Not called',                       count: notCalled,    color: 'bg-gray-600' },
    { label: 'Did not pick up',                  count: noAnswer,     color: 'bg-gray-500' },
    { label: 'Did not reach the Owner',          count: didNotReach,  color: 'bg-gray-500' },
    { label: 'Left a message to the owner',      count: leftMessage,  color: 'bg-yellow-500' },
    { label: 'Call back on Monday',              count: callBack,     color: 'bg-yellow-400' },
    { label: 'Intro-meeting wanted',             count: introMeetings,color: 'bg-green-500' },
    { label: 'Owner is not interested',          count: notInterested,color: 'bg-red-500' },
    { label: 'Already acquired',                 count: alreadyAcquired, color: 'bg-red-600' },
    { label: 'Not a garage door service company',count: notGarageDoor,color: 'bg-orange-500' },
    { label: 'Number does not exist',            count: noNumber,     color: 'bg-gray-700' },
  ].filter(r => r.count > 0)

  return (
    <div className="flex flex-col h-[100dvh] overflow-hidden bg-gray-950">
      <Nav />

      <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">

        {/* Top KPIs */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <KPI label="Total Companies" value={total.toLocaleString()} />
          <KPI label="Called" value={called.toLocaleString()} sub={`${((called / total) * 100).toFixed(0)}% of total`} />
          <KPI label="Not Yet Called" value={notCalled.toLocaleString()} color="text-gray-400" />
          <KPI label="Intro Meetings" value={introMeetings.toString()} color="text-green-400" sub={`${introRate}% of called`} />
          <KPI label="Not Interested" value={notInterested.toString()} color="text-red-400" />
          <KPI label="Total Dialed" value={totalDialed.toLocaleString()} color="text-blue-400" />
        </div>

        {/* Leaderboard */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

          {/* Most Calls */}
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
                      <div
                        className={`h-1.5 rounded-full ${c.color} transition-all`}
                        style={{ width: `${(c.calls / (leaderboardCalls[0]?.calls || 1)) * 100}%` }}
                      />
                    </div>
                    <span className="text-sm font-bold tabular-nums text-white w-8 text-right">{c.calls}</span>
                  </div>
                </div>
              ))}
              {leaderboardCalls.length === 0 && (
                <p className="text-gray-600 text-sm">No calls logged yet</p>
              )}
            </div>
          </div>

          {/* Highest Intro Rate */}
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
                      <div
                        className="h-1.5 rounded-full bg-green-500 transition-all"
                        style={{ width: `${(c.rate / (leaderboardIntroRate[0]?.rate || 1)) * 100}%` }}
                      />
                    </div>
                    <span className="text-sm font-bold tabular-nums text-green-400 w-16 text-right">
                      {c.rate.toFixed(1)}%
                      <span className="text-gray-600 font-normal text-xs ml-1">({c.intros}/{c.calls})</span>
                    </span>
                  </div>
                </div>
              ))}
              {leaderboardIntroRate.length === 0 && (
                <p className="text-gray-600 text-sm">Need at least 3 calls per person</p>
              )}
            </div>
          </div>

        </div>

        {/* Talk Time Analytics */}
        {talkStats.length > 0 && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wide mb-1 flex items-center gap-2">
              <span>🎙</span> Talk Time Analytics
            </h2>
            <p className="text-xs text-gray-600 mb-5">Actual conversation time from recorded calls vs. total dial attempts</p>

            {/* Column headers */}
            <div className="grid grid-cols-12 gap-2 text-xs text-gray-600 uppercase tracking-wide font-medium mb-3 px-1">
              <span className="col-span-2">Rep</span>
              <span className="col-span-4">Talk time</span>
              <span className="col-span-2 text-right">Total</span>
              <span className="col-span-2 text-right">Calls</span>
              <span className="col-span-2 text-right">Avg/call</span>
            </div>

            <div className="space-y-4">
              {talkStats.map(s => {
                const pct = (s.totalSeconds / maxTalkSeconds) * 100
                return (
                  <div key={s.name} className="space-y-1.5">
                    <div className="grid grid-cols-12 gap-2 items-center">
                      <span className="col-span-2 text-sm font-medium text-white truncate">{s.name}</span>
                      {/* Bar */}
                      <div className="col-span-4 bg-gray-800 rounded-full h-2 overflow-hidden">
                        <div
                          className="h-2 rounded-full bg-teal-500 transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="col-span-2 text-sm font-bold tabular-nums text-teal-400 text-right">{fmtTime(s.totalSeconds)}</span>
                      <span className="col-span-2 text-sm tabular-nums text-gray-400 text-right">{s.recordedCalls} rec.</span>
                      <span className="col-span-2 text-sm tabular-nums text-gray-400 text-right">{fmtTime(s.avgSeconds)}</span>
                    </div>
                    {/* Dial attempt context */}
                    {s.dialAttempts > 0 && (
                      <div className="pl-[calc(16.666%+8px)] flex items-center gap-3 text-xs text-gray-600">
                        <span>{s.dialAttempts} companies reached</span>
                        <span>·</span>
                        <span className={s.recordedCalls / Math.max(s.dialAttempts, 1) > 0.3 ? 'text-green-500' : 'text-gray-500'}>
                          {((s.recordedCalls / Math.max(s.dialAttempts, 1)) * 100).toFixed(0)}% recording rate
                        </span>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            {/* Summary row */}
            <div className="mt-5 pt-4 border-t border-gray-800 flex flex-wrap gap-6">
              <div>
                <p className="text-xs text-gray-600 uppercase tracking-wide">Total talk time</p>
                <p className="text-lg font-bold text-white tabular-nums mt-0.5">
                  {fmtTime(talkStats.reduce((s, r) => s + r.totalSeconds, 0))}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-600 uppercase tracking-wide">Recorded calls</p>
                <p className="text-lg font-bold text-white tabular-nums mt-0.5">
                  {talkStats.reduce((s, r) => s + r.recordedCalls, 0)}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-600 uppercase tracking-wide">Overall avg</p>
                <p className="text-lg font-bold text-white tabular-nums mt-0.5">
                  {(() => {
                    const total = talkStats.reduce((s, r) => s + r.totalSeconds, 0)
                    const count = talkStats.reduce((s, r) => s + r.recordedCalls, 0)
                    return fmtTime(count > 0 ? Math.round(total / count) : 0)
                  })()}
                </p>
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* Calls by team member */}
          <Card title="Calls by Team Member">
            <div className="space-y-3">
              {callers.map(c => (
                <div key={c.name} className="flex items-center gap-3">
                  <span className="text-sm text-gray-300 w-16 shrink-0">{c.name}</span>
                  <div className="flex-1 bg-gray-800 rounded-full h-2 overflow-hidden">
                    <div
                      className={`h-2 rounded-full ${c.color} transition-all`}
                      style={{ width: `${(c.calls / maxCalls) * 100}%` }}
                    />
                  </div>
                  <span className="text-sm font-semibold tabular-nums text-white w-8 text-right">{c.calls}</span>
                </div>
              ))}
            </div>
          </Card>

          {/* Who Called breakdown (rows attributed) */}
          <Card title="Companies Called By">
            <div className="space-y-2">
              {whoCalledEntries.length === 0 ? (
                <p className="text-gray-500 text-sm">No data</p>
              ) : (
                whoCalledEntries.map(([name, count]) => {
                  const pct = Math.round((count / called) * 100)
                  return (
                    <div key={name} className="flex items-center gap-3">
                      <span className="text-sm text-gray-300 w-20 shrink-0">{name}</span>
                      <div className="flex-1 bg-gray-800 rounded-full h-2 overflow-hidden">
                        <div className="h-2 rounded-full bg-indigo-500" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-sm font-semibold tabular-nums text-white w-16 text-right">{count} <span className="text-gray-500 font-normal text-xs">({pct}%)</span></span>
                    </div>
                  )
                })
              )}
            </div>
          </Card>

          {/* Response breakdown */}
          <Card title="Response Breakdown">
            <div className="space-y-2">
              {responseBreakdown.map(r => (
                <div key={r.label} className="flex items-center gap-3">
                  <div className={`w-2 h-2 rounded-full shrink-0 ${r.color}`} />
                  <span className="text-sm text-gray-300 flex-1 truncate">{r.label}</span>
                  <span className="text-sm font-semibold tabular-nums text-white">{r.count}</span>
                  <span className="text-xs text-gray-500 w-10 text-right">
                    {((r.count / total) * 100).toFixed(1)}%
                  </span>
                </div>
              ))}
            </div>
          </Card>

          {/* State breakdown */}
          <Card title="By State">
            <div className="space-y-2">
              {stateEntries.map(([state, s]) => (
                <div key={state} className="flex items-center gap-3">
                  <span className="text-sm font-mono text-gray-400 w-10 shrink-0">{state}</span>
                  <div className="flex-1 bg-gray-800 rounded-full h-2 overflow-hidden">
                    <div className="h-2 rounded-full bg-sky-500" style={{ width: `${(s.total / total) * 100}%` }} />
                  </div>
                  <div className="flex items-center gap-2 text-sm tabular-nums">
                    <span className="text-white font-semibold w-8 text-right">{s.total}</span>
                    <span className="text-gray-500">|</span>
                    <span className="text-gray-400">{s.called} called</span>
                    {s.intro > 0 && (
                      <span className="text-green-400">{s.intro} intro</span>
                    )}
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
  label: string
  value: string
  sub?: string
  color?: string
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
