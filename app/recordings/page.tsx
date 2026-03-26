export const dynamic = 'force-dynamic'

import { createClient } from '@/lib/supabase/server'
import { Nav } from '@/components/Nav'
import CallerSection from '@/components/CallerSection'

interface RecordingRow {
  id: string
  call_sid: string
  caller_name: string | null
  recording_url: string | null
  duration_seconds: number | null
  called_at: string
  called_by: string | null
  companies: { company_name: string; state: string | null } | null
}

async function fetchRecordings(): Promise<RecordingRow[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('call_recordings')
    .select('id, call_sid, caller_name, recording_url, duration_seconds, called_at, called_by, companies(company_name, state)')
    .not('recording_url', 'is', null)
    .order('called_at', { ascending: false })
    .limit(500)
  return ((data ?? []) as unknown[]).map((r: unknown) => {
    const row = r as RecordingRow & { companies: RecordingRow['companies'] | RecordingRow['companies'][] }
    return {
      ...row,
      companies: Array.isArray(row.companies) ? (row.companies[0] ?? null) : row.companies,
    } as RecordingRow
  })
}

function fmtTalkTime(s: number): string {
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
}

export default async function RecordingsPage() {
  const rows = await fetchRecordings()

  // Group by caller
  const grouped: Record<string, RecordingRow[]> = {}
  for (const r of rows) {
    const key = r.called_by ?? r.caller_name ?? 'Unknown'
    if (!grouped[key]) grouped[key] = []
    grouped[key].push(r)
  }

  // Sort callers by newest recording first
  const callers = Object.keys(grouped).sort((a, b) => {
    const aNewest = grouped[a][0]?.called_at ?? ''
    const bNewest = grouped[b][0]?.called_at ?? ''
    return bNewest.localeCompare(aNewest)
  })

  const totalSeconds = rows.reduce((s, r) => s + (r.duration_seconds ?? 0), 0)
  const totalWithDuration = rows.filter(r => r.duration_seconds && r.duration_seconds > 0).length
  const avgSeconds = totalWithDuration > 0 ? Math.round(totalSeconds / totalWithDuration) : 0

  function fmtAvg(s: number) {
    if (s < 60) return `${s}s`
    return `${Math.floor(s / 60)}m ${s % 60}s`
  }

  return (
    <div className="flex flex-col min-h-[100dvh] bg-gray-950">
      <Nav />

      <main className="flex-1 max-w-3xl w-full mx-auto px-4 sm:px-6 py-8 space-y-8">

        {/* Page header */}
        <div className="space-y-4">
          <div>
            <h1 className="text-2xl font-bold text-white">Call Recordings</h1>
            <p className="text-gray-500 text-sm mt-1">
              {rows.length} recording{rows.length !== 1 ? 's' : ''} across {callers.length} caller{callers.length !== 1 ? 's' : ''}
            </p>
          </div>

          {/* Summary stats */}
          {rows.length > 0 && (
            <div className="grid grid-cols-3 gap-3">
              <Stat label="Total recordings" value={rows.length.toString()} />
              <Stat label="Total talk time"  value={fmtTalkTime(totalSeconds)} />
              <Stat label="Avg call length"  value={avgSeconds > 0 ? fmtAvg(avgSeconds) : '—'} />
            </div>
          )}
        </div>

        {/* Empty state */}
        {callers.length === 0 && (
          <div className="text-center py-24 text-gray-600">
            <div className="text-4xl mb-4">🎙</div>
            <p className="text-lg font-medium text-gray-500">No recordings yet</p>
            <p className="text-sm mt-2">Recordings appear 30–60 s after a call ends.</p>
          </div>
        )}

        {/* Caller sections */}
        {callers.map(caller => {
          const callerRows = grouped[caller]
          const callerSeconds = callerRows.reduce((s, r) => s + (r.duration_seconds ?? 0), 0)

          // Ensure each caller section also shows newest recordings first
          const recordings = [...callerRows]
            .sort((a, b) => b.called_at.localeCompare(a.called_at))
            .map(r => ({
            id: r.id,
            company_name: r.companies?.company_name ?? null,
            state: r.companies?.state ?? null,
            called_at: r.called_at,
            duration_seconds: r.duration_seconds,
            streamUrl: r.recording_url
              ? `/api/twilio/recordings/stream?url=${encodeURIComponent(r.recording_url)}`
              : null,
            }))

          return (
            <CallerSection
              key={caller}
              caller={caller}
              recordings={recordings}
              totalSeconds={callerSeconds}
              color=""
            />
          )
        })}

      </main>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-3">
      <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">{label}</p>
      <p className="text-xl font-bold text-white tabular-nums mt-1">{value}</p>
    </div>
  )
}
