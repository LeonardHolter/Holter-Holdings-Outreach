'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

// Backfills any Twilio dial recordings that are missing from the DB
// (e.g. after a recording-webhook outage), then refreshes the list.
export function SyncRecordingsButton() {
  const [syncing, setSyncing] = useState(false)
  const router = useRouter()

  async function handleSync() {
    setSyncing(true)
    try {
      const res = await fetch('/api/twilio/recordings/sync?days=7', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) {
        toast.error(`Sync failed: ${data.error ?? res.status}`)
        return
      }
      const recovered = (data.imported ?? 0) + (data.audioFilled ?? 0)
      if (recovered > 0) {
        toast.success(`Recovered ${recovered} recording${recovered !== 1 ? 's' : ''} from Twilio`)
        router.refresh()
      } else {
        toast.success(`All ${data.checked} Twilio recordings from the last 7 days are saved`)
      }
      if (data.failed > 0) {
        toast.error(`${data.failed} recording${data.failed !== 1 ? 's' : ''} failed to save — check logs`)
      }
    } catch (err) {
      toast.error(`Sync failed: ${String(err)}`)
    } finally {
      setSyncing(false)
    }
  }

  return (
    <button
      onClick={handleSync}
      disabled={syncing}
      className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-700 bg-gray-900 text-sm font-medium text-gray-300 hover:border-gray-500 hover:text-white transition-colors disabled:opacity-50 touch-manipulation"
    >
      {syncing ? (
        <>
          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
          </svg>
          Syncing…
        </>
      ) : (
        <>
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          Sync from Twilio
        </>
      )}
    </button>
  )
}
