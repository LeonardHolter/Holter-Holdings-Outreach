'use client'

import { useState } from 'react'
import RecordingsPlayer from './RecordingsPlayer'
import { format, parseISO } from 'date-fns'

interface RecordingRow {
  id: string
  company_name: string | null
  state: string | null
  called_at: string
  duration_seconds: number | null
  streamUrl: string | null
}

interface Props {
  caller: string
  recordings: RecordingRow[]
  totalSeconds: number
  color: string
}

function fmtDuration(s: number | null): string | null {
  if (!s) return null
  const m = Math.floor(s / 60), sec = s % 60
  return `${m}:${sec.toString().padStart(2, '0')}`
}

function fmtTalkTime(s: number): string {
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
}

function durationColor(s: number | null): string {
  if (!s) return 'bg-gray-800 text-gray-500'
  if (s >= 120) return 'bg-green-950/60 border border-green-800/50 text-green-400'
  if (s >= 45)  return 'bg-yellow-950/60 border border-yellow-800/50 text-yellow-400'
  return 'bg-gray-800 border border-gray-700 text-gray-400'
}

const CALLER_COLORS: Record<string, string> = {
  leonard: 'bg-blue-900/60 border-blue-700/50 text-blue-300',
  tommaso: 'bg-violet-900/60 border-violet-700/50 text-violet-300',
  john:    'bg-emerald-900/60 border-emerald-700/50 text-emerald-300',
  sunzim:  'bg-amber-900/60 border-amber-700/50 text-amber-300',
  daniel:  'bg-rose-900/60 border-rose-700/50 text-rose-300',
  ellison: 'bg-cyan-900/60 border-cyan-700/50 text-cyan-300',
}

function callerColor(name: string): string {
  return CALLER_COLORS[name.toLowerCase()] ?? 'bg-gray-800 border-gray-700 text-gray-300'
}

export default function CallerSection({ caller, recordings, totalSeconds }: Props) {
  const [open, setOpen] = useState(true)
  const colorClass = callerColor(caller)

  return (
    <section>
      {/* Section header — click to collapse */}
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-3 mb-3 group text-left"
      >
        <div className={`w-9 h-9 rounded-full border flex items-center justify-center text-sm font-bold shrink-0 ${colorClass}`}>
          {caller[0]?.toUpperCase() ?? '?'}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-white font-semibold text-sm group-hover:text-gray-200 transition-colors">{caller}</p>
          <p className="text-gray-500 text-xs mt-0.5">
            {recordings.length} recording{recordings.length !== 1 ? 's' : ''}
            {totalSeconds > 0 && <span> · {fmtTalkTime(totalSeconds)} total</span>}
          </p>
        </div>
        <svg
          className={`w-4 h-4 text-gray-600 shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden divide-y divide-gray-800/80">
          {recordings.map((r, idx) => (
            <div key={r.id} className="px-5 py-4 space-y-3">
              {/* Row info */}
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-gray-600 tabular-nums w-5 shrink-0">{idx + 1}.</span>
                    <p className="text-white text-sm font-semibold truncate">
                      {r.company_name ?? 'Unknown company'}
                    </p>
                    {r.state && (
                      <span className="text-xs text-gray-500 bg-gray-800 px-2 py-0.5 rounded-full shrink-0">
                        {r.state}
                      </span>
                    )}
                  </div>
                  <p className="text-gray-500 text-xs mt-1 pl-7">
                    {format(parseISO(r.called_at), 'MMM d, yyyy · h:mm a')}
                  </p>
                </div>
                {r.duration_seconds && (
                  <span className={`shrink-0 text-xs px-2.5 py-1 rounded-full tabular-nums font-medium ${durationColor(r.duration_seconds)}`}>
                    {fmtDuration(r.duration_seconds)}
                  </span>
                )}
              </div>

              {/* Player */}
              {r.streamUrl && (
                <div className="pl-7">
                  <RecordingsPlayer src={r.streamUrl} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
