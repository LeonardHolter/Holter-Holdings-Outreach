'use client'

import { useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import type { Recording } from '@/app/recordings/page'

function fmtDuration(sec: number | null): string {
  if (sec == null) return '—'
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export function RecordingsList({ recordings }: { recordings: Recording[] }) {
  const [playing, setPlaying] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [list, setList] = useState(recordings)

  async function handleDelete(id: string) {
    if (!confirm('Delete this recording?')) return
    setDeleting(id)
    try {
      const res = await fetch(`/api/recordings/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed')
      setList(l => l.filter(r => r.id !== id))
      if (playing === id) setPlaying(null)
    } catch {
      alert('Failed to delete recording')
    } finally {
      setDeleting(null)
    }
  }

  if (list.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3 text-center">
        <div className="w-14 h-14 rounded-full bg-gray-900 flex items-center justify-center">
          <svg className="w-6 h-6 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
          </svg>
        </div>
        <p className="text-gray-500 text-sm">No recordings yet.</p>
        <p className="text-gray-600 text-xs">Start a recording from the Calling page.</p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {list.map(rec => (
        <div
          key={rec.id}
          className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3 transition-colors hover:border-gray-700"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-medium text-white truncate">
                {rec.company_name ?? 'Unknown company'}
              </p>
              <div className="flex items-center gap-2 mt-0.5 text-xs text-gray-500">
                {rec.caller_name && <span>{rec.caller_name}</span>}
                {rec.caller_name && <span>·</span>}
                <span>{formatDistanceToNow(new Date(rec.called_at), { addSuffix: true })}</span>
                <span>·</span>
                <span>{fmtDuration(rec.duration_seconds)}</span>
              </div>
            </div>
            <button
              onClick={() => handleDelete(rec.id)}
              disabled={deleting === rec.id}
              className="shrink-0 p-1.5 text-gray-600 hover:text-red-400 transition-colors rounded"
              title="Delete recording"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          </div>

          {playing === rec.id ? (
            <audio
              autoPlay
              controls
              className="w-full h-9"
              src={`/api/recordings/${rec.id}/audio`}
              onEnded={() => setPlaying(null)}
            />
          ) : (
            <button
              onClick={() => setPlaying(rec.id)}
              className="flex items-center gap-2 px-3 py-2 bg-gray-800 hover:bg-gray-700 text-white text-sm rounded-lg transition-colors w-full"
            >
              <svg className="w-4 h-4 text-green-400 shrink-0" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
              Play recording
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
