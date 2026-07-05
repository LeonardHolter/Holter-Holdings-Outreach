export const dynamic = 'force-dynamic'

import { query } from '@/lib/db'
import { Nav } from '@/components/Nav'
import DemoCard, { type DemoCompany } from '@/components/DemoCard'

async function fetchBookedDemos(): Promise<DemoCompany[]> {
  // Resolved demos (Won/Lost) drop off the active list once an outcome is set.
  // Each demo carries its booking-call recording (the most recent playable
  // recording; sub-minute clips are hidden app-wide) and the date the demo
  // was booked (latest 'Demo booked' call event) to anchor the touchpoint
  // cadence.
  const rows = await query(
    `SELECT c.*,
            r.id          AS recording_id,
            r.caller_name AS recording_caller,
            r.duration_seconds AS recording_duration,
            r.called_at   AS recording_at,
            b.booked_at   AS booked_at
     FROM companies c
     LEFT JOIN LATERAL (
       SELECT id, caller_name, duration_seconds, called_at
       FROM call_recordings
       WHERE company_id = c.id
         AND recording_data IS NOT NULL
         AND (duration_seconds IS NULL OR duration_seconds >= 60)
       ORDER BY called_at DESC
       LIMIT 1
     ) r ON true
     LEFT JOIN LATERAL (
       SELECT MAX(created_at) AS booked_at
       FROM call_events
       WHERE company_id = c.id AND response = 'Demo booked'
     ) b ON true
     WHERE c.reach_out_response = 'Demo booked'
       AND (c.demo_outcome IS NULL OR c.demo_outcome NOT IN ('Won', 'Lost'))
     ORDER BY c.next_reach_out ASC NULLS LAST`
  )
  // pg returns TIMESTAMPTZ columns as JS Date objects — normalize to ISO
  // strings so client components can parse them safely.
  const toIso = (v: unknown) => (v instanceof Date ? v.toISOString() : (v as string | null))
  return (rows as Record<string, unknown>[]).map(r => ({
    ...r,
    booked_at: toIso(r.booked_at),
    recording_at: toIso(r.recording_at),
  })) as DemoCompany[]
}

// Completed touchpoints for the listed demos, keyed by company id.
// The table is created lazily by the touchpoints API — tolerate it not
// existing yet so the page never breaks.
async function fetchTouchpoints(companyIds: string[]): Promise<Record<string, Record<string, string>>> {
  if (companyIds.length === 0) return {}
  try {
    const rows = await query(
      `SELECT company_id, touchpoint, completed_at
       FROM demo_touchpoints
       WHERE company_id = ANY($1::uuid[])`,
      [companyIds]
    )
    const map: Record<string, Record<string, string>> = {}
    for (const r of rows as { company_id: string; touchpoint: string; completed_at: string | Date }[]) {
      ;(map[r.company_id] ??= {})[r.touchpoint] =
        r.completed_at instanceof Date ? r.completed_at.toISOString() : r.completed_at
    }
    return map
  } catch {
    return {}
  }
}

export default async function DemosPage() {
  const demos = await fetchBookedDemos()
  const touchpoints = await fetchTouchpoints(demos.map(d => d.id))

  return (
    <div className="flex flex-col h-[100dvh] overflow-hidden bg-gray-950">
      <Nav />

      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="max-w-3xl mx-auto space-y-6">

          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold text-white">Booked Demos</h1>
              <p className="text-sm text-gray-500 mt-0.5">
                {demos.length} demo{demos.length !== 1 ? 's' : ''} scheduled
              </p>
            </div>
            <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-gray-500">
              <span className="px-1.5 py-0.5 rounded bg-white text-black font-bold">Overdue</span>
              <span className="px-1.5 py-0.5 rounded border border-white text-white">Today</span>
              <span className="px-1.5 py-0.5 rounded border border-gray-700">Upcoming</span>
            </div>
          </div>

          {demos.length === 0 ? (
            <div className="text-center py-16">
              <div className="w-16 h-16 rounded-full bg-gray-800 border border-gray-700 flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </div>
              <h2 className="text-lg font-semibold text-white">No demos booked yet</h2>
              <p className="text-sm text-gray-500 mt-1">Companies with &quot;Demo booked&quot; outcome will appear here</p>
            </div>
          ) : (
            <div className="space-y-3">
              {demos.map(c => (
                <DemoCard key={c.id} company={c} touchpoints={touchpoints[c.id] ?? {}} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
