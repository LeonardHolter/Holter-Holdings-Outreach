'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { format, parseISO, isPast, isToday } from 'date-fns'
import { toast } from 'sonner'
import type { Company } from '@/types'
import { DEMO_OUTCOMES } from '@/types'

function demoOutcomeStyle(o: string): string {
  if (o === 'Won') return 'border-green-600 bg-green-950/50 text-green-300'
  if (o === 'Lost') return 'border-red-700 bg-red-950/50 text-red-300'
  if (o === 'No-show') return 'border-orange-600 bg-orange-950/50 text-orange-300'
  if (o === 'Held') return 'border-blue-600 bg-blue-950/50 text-blue-300'
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

export default function DemoCard({ company: initial }: { company: Company }) {
  const [c, setC]           = useState(initial)
  const [saving, setSaving] = useState(false)
  const [expanded, setExpanded] = useState(false)

  const [notes, setNotes] = useState<Note[]>([])
  const [notesLoaded, setNotesLoaded] = useState(false)
  const [loadingNotes, setLoadingNotes] = useState(false)
  const [newNote, setNewNote] = useState('')
  const [submittingNote, setSubmittingNote] = useState(false)
  const noteInputRef = useRef<HTMLTextAreaElement>(null)

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
    <div className={`border rounded-2xl transition-all overflow-hidden ${
      overdue ? 'bg-gray-900 border-red-900/60'
      : today ? 'bg-gray-900 border-yellow-800/60'
      :         'bg-gray-900 border-gray-800'
    }`}>

      <div className="flex items-center gap-3 p-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold truncate text-white">{c.company_name}</h2>
          <div className="flex items-center gap-2 mt-0.5">
            {c.state && <span className="text-xs text-gray-500 font-medium">{c.state}</span>}
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-green-900/60 text-green-300">Demo booked</span>
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
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 [color-scheme:dark] disabled:opacity-40"
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
