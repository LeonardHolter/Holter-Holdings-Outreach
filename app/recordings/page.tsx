export const dynamic = 'force-dynamic'

import { query } from '@/lib/db'
import { Nav } from '@/components/Nav'
import { RecordingsList } from '@/components/RecordingsList'
import { SyncRecordingsButton } from '@/components/SyncRecordingsButton'

export interface Recording {
  id: string
  caller_name: string | null
  duration_seconds: number | null
  mime_type: string | null
  called_at: string
  company_name: string | null
  company_id: string | null
}

async function fetchRecordings(): Promise<Recording[]> {
  const rows = await query(`
    SELECT
      r.id,
      r.caller_name,
      r.duration_seconds,
      r.mime_type,
      r.called_at,
      COALESCE(r.company_name_snapshot, c.company_name) AS company_name,
      c.id AS company_id
    FROM call_recordings r
    LEFT JOIN companies c ON c.id = r.company_id
    WHERE r.recording_data IS NOT NULL
      AND (r.duration_seconds IS NULL OR r.duration_seconds >= 60)
    ORDER BY r.called_at DESC
    LIMIT 200
  `)
  return rows as Recording[]
}

export default async function RecordingsPage() {
  const recordings = await fetchRecordings()

  return (
    <div className="flex flex-col h-[100dvh] overflow-hidden bg-gray-950">
      <Nav />
      <div className="flex-1 overflow-auto px-4 py-6">
        <div className="max-w-3xl mx-auto">
          <div className="mb-6 flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-white">Recordings</h1>
              <p className="text-gray-400 text-sm mt-1">{recordings.length} recording{recordings.length !== 1 ? 's' : ''}</p>
            </div>
            <SyncRecordingsButton />
          </div>
          <RecordingsList recordings={recordings} />
        </div>
      </div>
    </div>
  )
}
