'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { addDays, format, parseISO, isPast, isToday, startOfDay } from 'date-fns'
import { toast } from 'sonner'
import type { Company } from '@/types'
import { DEMO_OUTCOMES, DEMO_TOUCHPOINTS } from '@/types'

function demoOutcomeStyle(o: string): string {
  if (o === 'Won') return 'border-white bg-white text-black font-bold'
  if (o === 'Lost') return 'border-gray-700 bg-gray-900 text-gray-500 line-through'
  if (o === 'No-show') return 'border-gray-600 bg-gray-900 text-gray-400'
  if (o === 'Held') return 'border-gray-300 bg-gray-800 text-white'
  return 'border-gray-700 bg-gray-800 text-gray-400'
}

function formatDate(d: string | null) {
  if (!d) return null
  try { return format(parseISO(d), 'MMM d, yyyy') } catch { return d }
}

function NextReachOutBadge({ date }: { date: string | null }) {
  if (!date) return <span className="text-gray-600 text-sm">—</span>
  const parsed = parseISO(date)
  const overdue = isPast(parsed) && !isToday(parsed)
  const today   = isToday(parsed)
  if (overdue) return (
    <span className="font-mono text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded bg-white text-black whitespace-nowrap">
      Overdue · {formatDate(date)}
    </span>
  )
  if (today) return (
    <span className="font-mono text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded border border-white text-white whitespace-nowrap">
      Today
    </span>
  )
  return (
    <span className="font-mono text-xs text-gray-400 whitespace-nowrap">{formatDate(date)}</span>
  )
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="font-mono text-[10px] text-gray-500 uppercase tracking-widest font-medium mb-0.5">{label}</p>
      {children}
    </div>
  )
}

interface Note {
  id: string
  note: string
  caller_name: string | null
  created_at: string
}

interface Recording {
  id: string
  caller_name: string | null
  duration_seconds: number | null
  mime_type: string
  called_at: string
}

// Company row joined with its booking-call recording (latest playable
// recording for the company) and the booking date, resolved server-side
// on the demos page.
export interface DemoCompany extends Company {
  recording_id: string | null
  recording_caller: string | null
  recording_duration: number | null
  recording_at: string | null
  booked_at: string | null
}

function fmtDuration(s: number | null): string | null {
  if (s == null) return null
  return `${Math.floor(s / 60)}m ${s % 60}s`
}

export default function DemoCard({
  company: initial,
  touchpoints: initialTouchpoints = {},
}: {
  company: DemoCompany
  touchpoints?: Record<string, string>
}) {
  const [c, setC]           = useState(initial)
  const [saving, setSaving] = useState(false)
  const [expanded, setExpanded] = useState(false)

  const [notes, setNotes] = useState<Note[]>([])
  const [notesLoaded, setNotesLoaded] = useState(false)
  const [loadingNotes, setLoadingNotes] = useState(false)
  const [newNote, setNewNote] = useState('')
  const [submittingNote, setSubmittingNote] = useState(false)
  const noteInputRef = useRef<HTMLTextAreaElement>(null)

  const [recordings, setRecordings] = useState<Recording[]>([])
  const [recordingsLoaded, setRecordingsLoaded] = useState(false)
  const [loadingRecordings, setLoadingRecordings] = useState(false)

  // Touchpoint cadence — key → completed_at ISO timestamp
  const [tps, setTps] = useState<Record<string, string>>(initialTouchpoints)
  const [tpSaving, setTpSaving] = useState<string | null>(null)

  async function toggleTouchpoint(key: string) {
    const wasDone = !!tps[key]
    const prev = tps
    setTpSaving(key)
    setTps(cur => {
      const next = { ...cur }
      if (wasDone) delete next[key]
      else next[key] = new Date().toISOString()
      return next
    })
    try {
      const caller = typeof window !== 'undefined' ? localStorage.getItem('sessionCaller') : null
      const res = await fetch(`/api/companies/${c.id}/touchpoints`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ touchpoint: key, done: !wasDone, caller_name: caller }),
      })
      if (!res.ok) throw new Error()
    } catch {
      setTps(prev)
      toast.error('Failed to save touchpoint')
    } finally {
      setTpSaving(null)
    }
  }

  // Due window for a touchpoint, anchored to the booking call (falls back to
  // the last call date for demos booked before call events existed).
  const anchor = c.booked_at ?? c.last_reach_out
  function tpWindow(from: number, to: number): { label: string; open: boolean } | null {
    if (!anchor) return null
    const start = startOfDay(addDays(parseISO(anchor), from))
    const end = startOfDay(addDays(parseISO(anchor), to))
    const label = from === to
      ? format(start, 'MMM d')
      : `${format(start, 'MMM d')}–${format(end, 'd')}`
    // "open" = the window has started (touchpoint is due or overdue)
    return { label, open: isToday(start) || isPast(start) }
  }

  const loadNotes = useCallback(async () => {
    setLoadingNotes(true)
    try {
      const res = await fetch(`/api/companies/${c.id}/notes`)
      if (!res.ok) throw new Error()
      setNotes(await res.json())
    } catch {
      toast.error('Failed to load comments')
    } finally {
      setLoadingNotes(false)
      setNotesLoaded(true)
    }
  }, [c.id])

  const loadRecordings = useCallback(async () => {
    setLoadingRecordings(true)
    try {
      const res = await fetch(`/api/companies/${c.id}/recordings`)
      if (!res.ok) throw new Error()
      setRecordings(await res.json())
    } catch {
      toast.error('Failed to load recordings')
    } finally {
      setLoadingRecordings(false)
      setRecordingsLoaded(true)
    }
  }, [c.id])

  useEffect(() => {
    if (expanded && !notesLoaded) loadNotes()
  }, [expanded, notesLoaded, loadNotes])

  useEffect(() => {
    if (expanded && !recordingsLoaded) loadRecordings()
  }, [expanded, recordingsLoaded, loadRecordings])

  const nextDate = c.next_reach_out ? parseISO(c.next_reach_out) : null
  const overdue  = nextDate && isPast(nextDate) && !isToday(nextDate)
  const today    = nextDate && isToday(nextDate)

  async function patch(fields: Partial<Company>) {
    setSaving(true)
    try {
      const res = await fetch(`/api/companies/${c.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fields),
      })
      if (!res.ok) throw new Error('Save failed')
      setC(prev => ({ ...prev, ...fields }))
    } catch {
      toast.error('Failed to save')
    } finally {
      setSaving(false)
    }
  }

  async function submitNote() {
    if (!newNote.trim()) return
    setSubmittingNote(true)
    try {
      const caller = typeof window !== 'undefined' ? localStorage.getItem('sessionCaller') : null
      const res = await fetch(`/api/companies/${c.id}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: newNote.trim(), caller_name: caller }),
      })
      if (!res.ok) throw new Error()
      const created: Note = await res.json()
      setNotes(prev => [created, ...prev])
      setNewNote('')
      toast.success('Comment added')
    } catch {
      toast.error('Failed to add comment')
    } finally {
      setSubmittingNote(false)
    }
  }

  return (
    <div className={`border rounded-xl transition-all overflow-hidden ${
      overdue ? 'bg-gray-900 border-gray-300'
      : today ? 'bg-gray-900 border-gray-500'
      :         'bg-gray-900 border-gray-800'
    }`}>

      <div className="flex items-center gap-3 p-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold truncate text-white">{c.company_name}</h2>
          <div className="flex items-center gap-2 mt-0.5">
            {c.state && <span className="text-xs text-gray-500 font-medium">{c.state}</span>}
            <span className="font-mono text-[10px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded border border-gray-600 text-gray-300">Demo booked</span>
            {c.demo_outcome && (
              <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded border ${demoOutcomeStyle(c.demo_outcome)}`}>{c.demo_outcome}</span>
            )}
          </div>
        </div>
        <NextReachOutBadge date={c.next_reach_out} />
        <button
          onClick={() => setExpanded(!expanded)}
          className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg border border-gray-700 bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white transition-colors"
        >
          <svg className={`w-4 h-4 transition-transform ${expanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>

      {/* Booking-call recording — attached to every card */}
      {c.recording_id && (
        <div className="flex items-center gap-3 px-4 pb-4 -mt-1">
          <span className="shrink-0 flex items-center gap-1.5 font-mono text-[10px] font-bold uppercase tracking-widest text-gray-400">
            <span className="w-2 h-2 rounded-full border-2 border-current" />
            Rec
          </span>
          <audio
            controls
            preload="none"
            src={`/api/recordings/${c.recording_id}/audio`}
            className="flex-1 min-w-0 h-8"
          />
          <span className="shrink-0 font-mono text-[10px] text-gray-500 whitespace-nowrap">
            {c.recording_caller ?? '—'}
            {c.recording_duration != null ? ` · ${fmtDuration(c.recording_duration)}` : ''}
          </span>
        </div>
      )}

      {/* Touchpoint cadence — done = filled, due/overdue = white outline */}
      <div className="px-4 pb-4">
        <p className="font-mono text-[10px] text-gray-500 uppercase tracking-widest font-medium mb-1.5">Touchpoints</p>
        <div className="grid grid-cols-5 gap-1.5">
          {DEMO_TOUCHPOINTS.map(tp => {
            const doneAt = tps[tp.key]
            const win = tpWindow(tp.from, tp.to)
            const due = !doneAt && !!win?.open
            return (
              <button
                key={tp.key}
                disabled={tpSaving === tp.key}
                onClick={() => toggleTouchpoint(tp.key)}
                title={doneAt ? 'Done — click to undo' : 'Click to mark done'}
                className={`rounded-lg border px-1 py-1.5 text-center transition-colors disabled:opacity-40 ${
                  doneAt ? 'border-white bg-white text-black'
                  : due  ? 'border-white text-white'
                  :        'border-gray-700 text-gray-500 hover:border-gray-500 hover:text-gray-300'
                }`}
              >
                <span className="block font-mono text-[9px] font-bold uppercase tracking-wider whitespace-nowrap">{tp.label}</span>
                <span className={`block text-[10px] mt-0.5 tabular-nums ${doneAt ? 'text-gray-600' : due ? 'text-gray-300' : 'text-gray-600'}`}>
                  {doneAt ? `✓ ${format(parseISO(doneAt), 'MMM d')}` : win?.label ?? '—'}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {expanded && (
        <div className="px-5 pb-5 space-y-4 border-t border-gray-800">
          <div className="grid grid-cols-2 gap-x-4 gap-y-3 pt-4">
            <Detail label="Contact">
              <span className="text-sm text-white">{c.owners_name || '—'}</span>
            </Detail>

            <Detail label="Phone">
              {c.phone_number ? (
                <div className="flex items-center gap-2">
                  <a href={`tel:${c.phone_number}`} className="text-sm text-blue-400 hover:text-blue-300 transition-colors font-medium">
                    {c.phone_number}
                  </a>
                  <a href={`/call?dial=${encodeURIComponent(c.phone_number)}`}
                    className="text-[10px] px-1.5 py-0.5 rounded bg-green-900/50 border border-green-800 text-green-400 hover:bg-green-900/80 transition-colors">
                    Call
                  </a>
                </div>
              ) : (
                <span className="text-sm text-gray-600">—</span>
              )}
            </Detail>

            <Detail label="Email">
              {c.email ? (
                <a href={`mailto:${c.email}`} className="text-sm text-blue-400 hover:text-blue-300 transition-colors">
                  {c.email}
                </a>
              ) : (
                <span className="text-sm text-gray-600">—</span>
              )}
            </Detail>

            <Detail label="Website">
              {c.website ? (
                <a href={c.website.startsWith('http') ? c.website : `https://${c.website}`}
                  target="_blank" rel="noopener noreferrer"
                  className="text-sm text-blue-400 hover:text-blue-300 transition-colors truncate block">
                  {c.website.replace(/^https?:\/\//, '')}
                </a>
              ) : (
                <span className="text-sm text-gray-600">—</span>
              )}
            </Detail>

            <Detail label="Last Contact">
              <span className="text-sm text-gray-300">{formatDate(c.last_reach_out) ?? '—'}</span>
            </Detail>

            <Detail label="Next Follow-up">
              <NextReachOutBadge date={c.next_reach_out} />
            </Detail>

            {c.who_called && (
              <Detail label="Called By">
                <span className="text-sm text-gray-300">{c.who_called}</span>
              </Detail>
            )}

            <Detail label="Times Called">
              <span className="text-sm text-gray-300">{c.amount_of_calls ?? 0}</span>
            </Detail>
          </div>

          {c.notes && (
            <div className="pt-1 border-t border-gray-800">
              <p className="text-xs text-gray-500 uppercase tracking-wide font-medium mb-1">Notes</p>
              <p className="text-sm text-gray-300 whitespace-pre-wrap leading-relaxed">{c.notes}</p>
            </div>
          )}

          {/* Full recording history for this company */}
          {recordings.length > 0 && (
            <div className="pt-2 border-t border-gray-800">
              <p className="text-xs text-gray-500 uppercase tracking-wide font-medium mb-2">All recordings</p>
              <div className="space-y-2">
                {recordings.map(rec => (
                  <div key={rec.id} className="bg-gray-800/50 border border-gray-700 rounded-lg p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-gray-300">{rec.caller_name ?? 'Unknown'}</span>
                      <span className="text-[10px] text-gray-600">{format(parseISO(rec.called_at), 'MMM d, h:mm a')}</span>
                    </div>
                    {rec.duration_seconds && (
                      <span className="text-xs text-gray-500">{Math.round(rec.duration_seconds / 60)}m {rec.duration_seconds % 60}s</span>
                    )}
                    <audio
                      controls
                      src={`/api/recordings/${rec.id}/audio`}
                      className="w-full h-6 rounded bg-gray-900 [&::-webkit-media-controls-panel]:bg-gray-800"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {loadingRecordings && (
            <div className="pt-2 border-t border-gray-800">
              <p className="text-xs text-gray-500">Loading recordings...</p>
            </div>
          )}

          {/* Demo outcome — set once the demo has happened */}
          <div className="pt-2 border-t border-gray-800">
            <p className="text-xs text-gray-500 uppercase tracking-wide font-medium mb-2">Demo Outcome</p>
            <div className="grid grid-cols-4 gap-1.5">
              {DEMO_OUTCOMES.map(o => (
                <button
                  key={o}
                  disabled={saving}
                  onClick={() => patch({ demo_outcome: c.demo_outcome === o ? null : o })}
                  className={`text-center px-2 py-1.5 rounded-lg border text-xs transition-colors disabled:opacity-40 ${
                    c.demo_outcome === o ? demoOutcomeStyle(o) : 'border-gray-700 bg-gray-800 text-gray-400 hover:border-gray-600 hover:text-gray-300'
                  }`}
                >{o}</button>
              ))}
            </div>
          </div>

          {/* Next follow-up date setter */}
          <div className="pt-2 border-t border-gray-800">
            <p className="text-xs text-gray-500 uppercase tracking-wide font-medium mb-2">Set Follow-up Date</p>
            <input
              type="date"
              value={c.next_reach_out ?? ''}
              onChange={e => patch({ next_reach_out: e.target.value || null })}
              disabled={saving}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-white [color-scheme:dark] disabled:opacity-40"
            />
          </div>

          {/* Comments */}
          <div className="pt-2 border-t border-gray-800 space-y-3">
            <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">Comments</p>

            <div className="flex gap-2">
              <textarea
                ref={noteInputRef}
                value={newNote}
                onChange={e => setNewNote(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitNote() } }}
                rows={1}
                placeholder="Add a comment..."
                className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 resize-none focus:outline-none focus:border-white"
              />
              <button
                onClick={submitNote}
                disabled={submittingNote || !newNote.trim()}
                className="shrink-0 px-3 py-2 rounded-lg bg-white hover:bg-gray-200 text-black text-sm font-medium transition-all disabled:opacity-40"
              >
                {submittingNote ? '...' : 'Post'}
              </button>
            </div>

            {loadingNotes ? (
              <p className="text-xs text-gray-500">Loading comments...</p>
            ) : notes.length === 0 ? (
              <p className="text-xs text-gray-600">No comments yet</p>
            ) : (
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {notes.map(n => (
                  <div key={n.id} className="bg-gray-800/50 border border-gray-800 rounded-lg px-3 py-2">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="text-xs font-medium text-gray-300">{n.caller_name ?? 'Unknown'}</span>
                      <span className="text-[10px] text-gray-600">{format(parseISO(n.created_at), 'MMM d, h:mm a')}</span>
                    </div>
                    <p className="text-sm text-gray-300 whitespace-pre-wrap">{n.note}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
