export const dynamic = 'force-dynamic'

import { createClient } from '@/lib/supabase/server'
import { format, parseISO } from 'date-fns'
import RecordingsPlayer from '@/components/RecordingsPlayer'
import { Nav } from '@/components/Nav'

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
  // Supabase returns companies as an array from the join; normalise to single object
  return ((data ?? []) as unknown[]).map((r: unknown) => {
    const row = r as RecordingRow & { companies: RecordingRow['companies'] | RecordingRow['companies'][] }
    return {
      ...row,
      companies: Array.isArray(row.companies) ? (row.companies[0] ?? null) : row.companies,
    } as RecordingRow
  })
}

function fmtDuration(s: number | null) {
  if (!s) return null
  const m = Math.floor(s / 60), sec = s % 60
  return `${m}:${sec.toString().padStart(2, '0')}`
}

export default async function RecordingsPage() {
  const rows = await fetchRecordings()

  // Group by caller (called_by), fall back to caller_name, then "Unknown"
  const grouped: Record<string, RecordingRow[]> = {}
  for (const r of rows) {
    const key = r.called_by ?? r.caller_name ?? 'Unknown'
    if (!grouped[key]) grouped[key] = []
    grouped[key].push(r)
  }

  const callers = Object.keys(grouped).sort()

  return (
    <div className="flex flex-col min-h-[100dvh] bg-gray-950">
      <Nav />

      <main className="flex-1 max-w-4xl w-full mx-auto px-4 py-8 space-y-8">
        <div>
          <h1 className="text-2xl font-bold text-white">Recordings</h1>
          <p className="text-gray-500 text-sm mt-1">{rows.length} recording{rows.length !== 1 ? 's' : ''} total</p>
        </div>

        {callers.length === 0 && (
          <div className="text-center py-20 text-gray-600">
            <p className="text-lg">No recordings yet.</p>
            <p className="text-sm mt-1">Recordings appear here after calls end (may take 30–60 s).</p>
          </div>
        )}

        {callers.map(caller => (
          <section key={caller}>
            <div className="flex items-center gap-3 mb-3">
              <div className="w-8 h-8 rounded-full bg-blue-900/50 border border-blue-700/50 flex items-center justify-center text-sm font-bold text-blue-300">
                {caller[0]?.toUpperCase() ?? '?'}
              </div>
              <div>
                <h2 className="text-white font-semibold">{caller}</h2>
                <p className="text-gray-500 text-xs">{grouped[caller].length} recording{grouped[caller].length !== 1 ? 's' : ''}</p>
              </div>
            </div>

            <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden divide-y divide-gray-800">
              {grouped[caller].map(r => {
                const company = r.companies
                const streamUrl = r.recording_url
                  ? `/api/twilio/recordings/stream?url=${encodeURIComponent(r.recording_url)}`
                  : null

                return (
                  <div key={r.id} className="px-4 py-4 space-y-3">
                    {/* Company info row */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-white text-sm font-semibold truncate">
                          {company?.company_name ?? 'Unknown company'}
                          {company?.state && (
                            <span className="text-gray-500 font-normal ml-1.5">{company.state}</span>
                          )}
                        </p>
                        <p className="text-gray-500 text-xs mt-0.5">
                          {format(parseISO(r.called_at), 'MMM d, yyyy · h:mm a')}
                        </p>
                      </div>
                      {fmtDuration(r.duration_seconds) && (
                        <span className="shrink-0 text-xs text-gray-500 bg-gray-800 px-2 py-0.5 rounded-full tabular-nums">
                          {fmtDuration(r.duration_seconds)}
                        </span>
                      )}
                    </div>

                    {/* Audio player — full width */}
                    {streamUrl && <RecordingsPlayer src={streamUrl} />}
                  </div>
                )
              })}
            </div>
          </section>
        ))}
      </main>
    </div>
  )
}
