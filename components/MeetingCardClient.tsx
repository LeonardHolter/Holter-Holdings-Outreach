'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { format, parseISO, isPast, isToday } from 'date-fns'
import { toast } from 'sonner'
import type { Company } from '@/types'
import RecordingsPlayer from './RecordingsPlayer'

function formatDate(d: string | null) {
  if (!d) return null
  try { return format(parseISO(d), 'MMM d, yyyy') } catch { return d }
}

function NextReachOutBadge({ date }: { date: string | null }) {
  if (!date) return <span className="text-gray-600 text-sm">—</span>
  const parsed = parseISO(date)
  const overdue = isPast(parsed) && !isToday(parsed)
  const today   = isToday(parsed)
  return (
    <span className={`text-xs font-medium ${overdue ? 'text-red-400' : today ? 'text-yellow-400' : 'text-green-400'}`}>
      {overdue && '⚠ '}{formatDate(date)}
    </span>
  )
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-gray-600 uppercase tracking-wide font-medium mb-0.5">{label}</p>
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

export default function MeetingCardClient({ company: initial }: { company: Company }) {
  const [c, setC]           = useState(initial)
  const [saving, setSaving] = useState(false)
  const [copied, setCopied] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [loadingRecordings, setLoadingRecordings] = useState(false)
  const [recordings, setRecordings] = useState<Array<{
    id: string
    called_at: string
    duration_seconds: number | null
    streamUrl: string | null
    called_by: string | null
  }>>([])
  const [showRecordings, setShowRecordings] = useState(false)

  // Comments state
  const [notes, setNotes] = useState<Note[]>([])
  const [notesLoaded, setNotesLoaded] = useState(false)
  const [loadingNotes, setLoadingNotes] = useState(false)
  const [newNote, setNewNote] = useState('')
  const [submittingNote, setSubmittingNote] = useState(false)
  const noteInputRef = useRef<HTMLTextAreaElement>(null)
  const [analyzing, setAnalyzing] = useState(false)

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

  useEffect(() => {
    if (expanded && !notesLoaded) loadNotes()
  }, [expanded, notesLoaded, loadNotes])

  function copyForAndre() {
    const statePart = c.state ? ` (${c.state})` : ''
    const ownerPart = c.owners_name ? `, Owner: ${c.owners_name}` : ''
    const notesPart = c.notes ? `, ${c.notes}` : ''
    const text = `${c.company_name}${statePart}: ${c.phone_number ?? '—'}${ownerPart}${notesPart}`
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

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

  async function setPriority(priority: 'high' | 'low' | null) {
    await patch({ meeting_priority: priority })
    if (priority) toast.success(`Set to ${priority} priority`)
    else toast.success('Priority cleared')
  }

  async function handleReceivedNda() {
    await patch({ reach_out_response: 'NDA received' })
    toast.success('Moved to CIM page')
  }

  async function loadRecordings() {
    if (loadingRecordings) return
    setLoadingRecordings(true)
    try {
      const res = await fetch(`/api/twilio/recordings/${c.id}`)
      if (!res.ok) throw new Error('Failed to load recordings')
      const data = await res.json() as Array<{
        id: string
        called_at: string
        duration_seconds: number | null
        recording_url: string | null
        called_by: string | null
      }>
      setRecordings(
        (data ?? []).map(r => ({
          id: r.id,
          called_at: r.called_at,
          duration_seconds: r.duration_seconds,
          called_by: r.called_by,
          streamUrl: r.recording_url
            ? `/api/twilio/recordings/stream?url=${encodeURIComponent(r.recording_url)}`
            : null,
        }))
      )
    } catch {
      toast.error('Failed to load recordings')
    } finally {
      setLoadingRecordings(false)
    }
  }

  const followUpCalls = c.follow_up_calls ?? 0
  const followUpEmails = c.follow_up_emails ?? 0
  const followUpTotal = followUpCalls + followUpEmails

  async function bumpFollowUp(kind: 'call' | 'email', delta: 1 | -1) {
    const nextCalls = kind === 'call' ? Math.max(0, followUpCalls + delta) : followUpCalls
    const nextEmails = kind === 'email' ? Math.max(0, followUpEmails + delta) : followUpEmails
    const nextTotal = nextCalls + nextEmails
    if (nextTotal > 21) {
      toast.error('Follow-ups are capped at 21 total')
      return
    }
    await patch({ follow_up_calls: nextCalls, follow_up_emails: nextEmails })
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

  async function handleAnalyze() {
    if (analyzing) return
    setAnalyzing(true)
    try {
      const res = await fetch(`/api/companies/${c.id}/enrich`, { method: 'POST' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'Unknown error' }))
        throw new Error(body.error || `HTTP ${res.status}`)
      }
      const data = await res.json()
      setC(prev => ({ ...prev, ...data.company }))
      const fmt = (n: number) => n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${(n / 1e3).toFixed(0)}K`
      toast.success(`Revenue: ${fmt(data.estimated_revenue_low)}–${fmt(data.estimated_revenue_high)}/yr (${data.revenue_confidence})`)
    } catch (err) {
      toast.error(`Analysis failed: ${err instanceof Error ? err.message : 'Unknown error'}`)
    } finally {
      setAnalyzing(false)
    }
  }

  function formatRevenue(n: number | null) {
    if (!n) return '?'
    if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
    if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`
    return `$${n}`
  }

  return (
    <div className={`border rounded-2xl transition-all overflow-hidden ${
      overdue ? 'bg-gray-900 border-red-900/60'
      : today ? 'bg-gray-900 border-yellow-800/60'
      :         'bg-gray-900 border-gray-800'
    }`}>

      {/* Collapsed header — always visible */}
      <div className="flex items-center gap-3 p-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold truncate text-white">{c.company_name}</h2>
          <div className="flex items-center gap-2 mt-0.5">
            {c.state && <span className="text-xs text-gray-500 font-medium uppercase tracking-wider">{c.state}</span>}
            {c.meeting_priority && (
              <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                c.meeting_priority === 'high' ? 'bg-red-900/60 text-red-300' : 'bg-blue-900/60 text-blue-300'
              }`}>{c.meeting_priority}</span>
            )}
          </div>
        </div>
        <NextReachOutBadge date={c.next_reach_out} />
        <button
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setExpanded(!expanded) }}
          className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg border border-gray-700 bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white transition-colors"
        >
          <svg className={`w-4 h-4 transition-transform ${expanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="px-5 pb-5 space-y-4 border-t border-gray-800">

          {/* Actions row */}
          <div className="flex items-center gap-2 pt-4 flex-wrap">
            <button
              onClick={copyForAndre}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-medium transition-all ${
                copied
                  ? 'bg-green-900/50 border-green-700 text-green-300'
                  : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-white hover:border-gray-500'
              }`}
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
            <button
              onClick={handleAnalyze}
              disabled={analyzing}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-medium transition-all disabled:opacity-40 ${
                analyzing
                  ? 'bg-indigo-900/50 border-indigo-700 text-indigo-300'
                  : c.enriched_at
                    ? 'bg-indigo-900/40 border-indigo-800/50 text-indigo-300 hover:bg-indigo-900/60'
                    : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-indigo-300 hover:border-indigo-700/60'
              }`}
            >
              {analyzing ? (
                <>
                  <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                  </svg>
                  Analyzing...
                </>
              ) : (
                <>
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                  </svg>
                  {c.enriched_at ? 'Re-analyze' : 'Analyze'}
                </>
              )}
            </button>
            <span className="inline-flex items-center gap-1 px-2 py-1 bg-green-950/60 border border-green-800/50 rounded-full text-xs text-green-400 font-medium">
              Intro wanted
            </span>
          </div>

          {/* Details grid */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
            <Detail label="Priority">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPriority(c.meeting_priority === 'high' ? null : 'high')}
                  disabled={saving}
                  className={`px-2.5 py-1 rounded-lg border text-xs font-medium transition-colors ${
                    c.meeting_priority === 'high'
                      ? 'bg-red-900/60 border-red-700 text-red-300'
                      : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-red-300 hover:border-red-700/60'
                  }`}
                >
                  High
                </button>
                <button
                  onClick={() => setPriority(c.meeting_priority === 'low' ? null : 'low')}
                  disabled={saving}
                  className={`px-2.5 py-1 rounded-lg border text-xs font-medium transition-colors ${
                    c.meeting_priority === 'low'
                      ? 'bg-blue-900/60 border-blue-700 text-blue-300'
                      : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-blue-300 hover:border-blue-700/60'
                  }`}
                >
                  Low
                </button>
                <button
                  onClick={handleReceivedNda}
                  disabled={saving}
                  className="px-2.5 py-1 rounded-lg border text-xs font-medium transition-colors bg-gray-800 border-gray-700 text-gray-400 hover:text-emerald-300 hover:border-emerald-700/60"
                >
                  Received NDA
                </button>
              </div>
            </Detail>

            <Detail label="Owner">
              <span className="text-sm text-white">{c.owners_name || '—'}</span>
            </Detail>

            <Detail label="Phone">
              {c.phone_number ? (
                <a href={`tel:${c.phone_number}`} className="text-sm text-blue-400 hover:text-blue-300 transition-colors font-medium">
                  {c.phone_number}
                </a>
              ) : (
                <span className="text-sm text-gray-600">—</span>
              )}
            </Detail>

            <Detail label="Last Contact">
              <span className="text-sm text-gray-300">{formatDate(c.last_reach_out) ?? '—'}</span>
            </Detail>

            <Detail label="Next Reach Out">
              <NextReachOutBadge date={c.next_reach_out} />
            </Detail>

            {c.google_reviews != null && (
              <Detail label="Google Reviews">
                <span className="text-sm text-gray-300">{c.google_reviews.toLocaleString()}</span>
              </Detail>
            )}

            {c.who_called && (
              <Detail label="Called By">
                <span className="text-sm text-gray-300">{c.who_called}</span>
              </Detail>
            )}
          </div>

          {/* Notes */}
          {c.notes && (
            <div className="pt-1 border-t border-gray-800">
              <p className="text-xs text-gray-500 uppercase tracking-wide font-medium mb-1">Notes</p>
              <p className="text-sm text-gray-300 whitespace-pre-wrap leading-relaxed">{c.notes}</p>
            </div>
          )}

          {/* Enrichment results */}
          {c.enriched_at && (
            <div className="bg-indigo-950/30 border border-indigo-800/40 rounded-xl px-4 py-3 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs text-indigo-400 font-medium uppercase tracking-wide">Revenue Estimate</p>
                {c.revenue_confidence && (
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                    c.revenue_confidence === 'high' ? 'bg-green-900/60 text-green-400'
                    : c.revenue_confidence === 'medium' ? 'bg-yellow-900/60 text-yellow-400'
                    : 'bg-gray-800 text-gray-400'
                  }`}>{c.revenue_confidence} confidence</span>
                )}
              </div>
              <p className="text-lg font-bold text-white">
                {formatRevenue(c.estimated_revenue_low)}
                {' – '}
                {formatRevenue(c.estimated_revenue_high)}
                <span className="text-sm font-normal text-gray-500"> / year</span>
              </p>
              {c.technician_count_estimate != null && (
                <p className="text-sm text-gray-400">~{c.technician_count_estimate} technicians estimated</p>
              )}
              <p className="text-xs text-gray-500 leading-relaxed">{c.enrichment_reasoning}</p>
              {c.enrichment_signals?.length ? (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {c.enrichment_signals.map((s, i) => (
                    <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-gray-800 border border-gray-700 text-gray-400">{s}</span>
                  ))}
                </div>
              ) : null}
            </div>
          )}

          {/* Follow-ups */}
          <div className="pt-2 border-t border-gray-800 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">Follow-ups</p>
              <span className={`text-xs font-medium ${followUpTotal >= 21 ? 'text-red-400' : 'text-gray-400'}`}>
                {followUpTotal}/21
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-gray-800/70 border border-gray-700 rounded-lg p-2.5">
                <p className="text-[11px] text-gray-500 uppercase tracking-wide">Calls</p>
                <div className="mt-1 flex items-center justify-between">
                  <span className="text-sm text-white font-semibold tabular-nums">{followUpCalls}</span>
                  <div className="flex gap-1">
                    <button onClick={() => bumpFollowUp('call', -1)} disabled={saving || followUpCalls <= 0}
                      className="w-6 h-6 rounded border border-gray-600 text-gray-300 hover:text-white disabled:opacity-40">−</button>
                    <button onClick={() => bumpFollowUp('call', 1)} disabled={saving || followUpTotal >= 21}
                      className="w-6 h-6 rounded border border-gray-600 text-gray-300 hover:text-white disabled:opacity-40">+</button>
                  </div>
                </div>
              </div>
              <div className="bg-gray-800/70 border border-gray-700 rounded-lg p-2.5">
                <p className="text-[11px] text-gray-500 uppercase tracking-wide">Emails</p>
                <div className="mt-1 flex items-center justify-between">
                  <span className="text-sm text-white font-semibold tabular-nums">{followUpEmails}</span>
                  <div className="flex gap-1">
                    <button onClick={() => bumpFollowUp('email', -1)} disabled={saving || followUpEmails <= 0}
                      className="w-6 h-6 rounded border border-gray-600 text-gray-300 hover:text-white disabled:opacity-40">−</button>
                    <button onClick={() => bumpFollowUp('email', 1)} disabled={saving || followUpTotal >= 21}
                      className="w-6 h-6 rounded border border-gray-600 text-gray-300 hover:text-white disabled:opacity-40">+</button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Recordings */}
          <div className="pt-2 border-t border-gray-800 space-y-2">
            <button
              onClick={async () => {
                const next = !showRecordings
                setShowRecordings(next)
                if (next && recordings.length === 0) await loadRecordings()
              }}
              className="w-full flex items-center justify-between px-3 py-2 rounded-xl border border-gray-700 bg-gray-800/50 hover:bg-gray-800 transition-colors text-left"
            >
              <span className="text-sm text-gray-300 font-medium">Company call recordings</span>
              <span className="text-xs text-gray-500">
                {loadingRecordings ? 'Loading…' : `${recordings.length} clip${recordings.length !== 1 ? 's' : ''}`}
              </span>
            </button>

            {showRecordings && (
              <div className="space-y-2">
                {loadingRecordings && <p className="text-xs text-gray-500 px-1">Loading recordings…</p>}
                {!loadingRecordings && recordings.length === 0 && (
                  <p className="text-xs text-gray-500 px-1">No recordings yet for this company.</p>
                )}
                {recordings.map((r, idx) => (
                  <div key={r.id} className="bg-gray-800/60 border border-gray-700 rounded-lg p-3 space-y-2">
                    <div className="flex items-center justify-between gap-3 text-xs">
                      <span className="text-gray-500">#{idx + 1} · {format(parseISO(r.called_at), 'MMM d, yyyy · h:mm a')}</span>
                      <span className="text-gray-400">{r.called_by ?? 'Unknown caller'}</span>
                    </div>
                    {r.streamUrl ? (
                      <RecordingsPlayer src={r.streamUrl} />
                    ) : (
                      <p className="text-xs text-gray-500">Recording URL missing</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Comments */}
          <div className="pt-2 border-t border-gray-800 space-y-3">
            <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">Comments</p>

            {/* New comment input */}
            <div className="flex gap-2">
              <textarea
                ref={noteInputRef}
                value={newNote}
                onChange={e => setNewNote(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitNote() } }}
                rows={1}
                placeholder="Add a comment..."
                className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 resize-none focus:outline-none focus:border-blue-600"
              />
              <button
                onClick={submitNote}
                disabled={submittingNote || !newNote.trim()}
                className="shrink-0 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-all disabled:opacity-40"
              >
                {submittingNote ? '...' : 'Post'}
              </button>
            </div>

            {/* Comments list */}
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
