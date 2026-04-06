'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { format, parseISO, differenceInCalendarDays } from 'date-fns'
import { toast } from 'sonner'
import type { Company } from '@/types'

// ── Smart cadence ────────────────────────────────────────────────────────────

function nextFollowUpDate(totalTouches: number, priority: Company['meeting_priority']): string {
  const base = [2, 4, 7, 10, 14]
  const days = base[Math.min(totalTouches, base.length - 1)]
  const adjusted = priority === 'high' ? Math.max(1, Math.round(days / 2)) : days
  const d = new Date()
  d.setDate(d.getDate() + adjusted)
  return d.toISOString().slice(0, 10)
}

function cadenceLabel(totalTouches: number, priority: Company['meeting_priority']): string {
  const base = [2, 4, 7, 10, 14]
  const days = base[Math.min(totalTouches, base.length - 1)]
  const adjusted = priority === 'high' ? Math.max(1, Math.round(days / 2)) : days
  return `${adjusted} day${adjusted !== 1 ? 's' : ''}`
}

function formatDate(d: string | null) {
  if (!d) return '—'
  try { return format(parseISO(d), 'MMM d, yyyy') } catch { return d }
}

function overdueDays(d: string | null): number {
  if (!d) return 0
  try { return Math.max(0, differenceInCalendarDays(new Date(), parseISO(d))) } catch { return 0 }
}

// ── Single-queue section ─────────────────────────────────────────────────────

function QueueSection({
  queue,
  upcoming,
  label,
}: {
  queue: Company[]
  upcoming: Company[]
  label: string
}) {
  const router = useRouter()
  const [idx, setIdx] = useState(0)
  const [saving, setSaving] = useState(false)
  const [showUpcoming, setShowUpcoming] = useState(false)
  const [completedCount, setCompletedCount] = useState(0)

  const current = queue[idx] as Company | undefined
  const remaining = queue.length - idx
  const totalTouches = current ? (current.follow_up_calls ?? 0) + (current.follow_up_emails ?? 0) : 0

  async function patch(id: string, fields: Partial<Company>) {
    setSaving(true)
    try {
      const res = await fetch(`/api/companies/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fields),
      })
      if (!res.ok) throw new Error('Save failed')
      return true
    } catch {
      toast.error('Failed to save')
      return false
    } finally {
      setSaving(false)
    }
  }

  function advance() {
    setCompletedCount(c => c + 1)
    setIdx(i => i + 1)
  }

  async function handleFollowedUp(kind: 'call' | 'email') {
    if (!current) return
    const nextCalls = kind === 'call' ? (current.follow_up_calls ?? 0) + 1 : (current.follow_up_calls ?? 0)
    const nextEmails = kind === 'email' ? (current.follow_up_emails ?? 0) + 1 : (current.follow_up_emails ?? 0)
    const nextDate = nextFollowUpDate(nextCalls + nextEmails, current.meeting_priority)
    const ok = await patch(current.id, {
      follow_up_calls: nextCalls,
      follow_up_emails: nextEmails,
      next_reach_out: nextDate,
      last_reach_out: new Date().toISOString().slice(0, 10),
    })
    if (ok) {
      toast.success(`Follow-up ${kind} logged — next in ${cadenceLabel(nextCalls + nextEmails, current.meeting_priority)}`)
      advance()
    }
  }

  async function handleMeetingBooked() {
    if (!current) return
    const ok = await patch(current.id, {
      reach_out_response: 'Meeting booked',
      last_reach_out: new Date().toISOString().slice(0, 10),
    })
    if (ok) { toast.success('Meeting booked!'); advance() }
  }

  async function handleGoneCold() {
    if (!current) return
    const ok = await patch(current.id, {
      reach_out_response: 'Owner is not interested',
      last_reach_out: new Date().toISOString().slice(0, 10),
    })
    if (ok) { toast.success('Marked as gone cold'); advance() }
  }

  async function handleSnooze(days: number) {
    if (!current) return
    const d = new Date()
    d.setDate(d.getDate() + days)
    const ok = await patch(current.id, { next_reach_out: d.toISOString().slice(0, 10) })
    if (ok) { toast.success(`Snoozed ${days} day${days !== 1 ? 's' : ''}`); advance() }
  }

  // ── Done state ─────────────────────────────────────────────────────────────

  if (!current) {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-4">
        <div className="text-center space-y-3 max-w-md">
          <div className="w-14 h-14 rounded-full bg-green-900/40 border border-green-700/50 flex items-center justify-center mx-auto">
            <svg className="w-7 h-7 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          {completedCount > 0 ? (
            <>
              <h3 className="text-lg font-bold text-white">All caught up!</h3>
              <p className="text-gray-400 text-sm">Cleared {completedCount} {label.toLowerCase()} follow-up{completedCount !== 1 ? 's' : ''}.</p>
            </>
          ) : (
            <>
              <h3 className="text-lg font-bold text-white">No {label.toLowerCase()} follow-ups due</h3>
              <p className="text-gray-400 text-sm">Check back tomorrow.</p>
            </>
          )}
          {upcoming.length > 0 && (
            <div className="pt-3">
              <button onClick={() => setShowUpcoming(!showUpcoming)} className="text-sm text-blue-400 hover:text-blue-300 transition-colors">
                {showUpcoming ? 'Hide' : 'Show'} upcoming ({upcoming.length})
              </button>
              {showUpcoming && (
                <div className="mt-3 space-y-2 text-left">
                  {upcoming.map(c => (
                    <div key={c.id} className="flex items-center justify-between px-3 py-2 bg-gray-900 border border-gray-800 rounded-lg">
                      <div className="min-w-0">
                        <p className="text-sm text-white font-medium truncate">{c.company_name}</p>
                        <p className="text-xs text-gray-500">{c.owners_name || 'Unknown owner'}</p>
                      </div>
                      <span className="text-xs text-green-400 shrink-0 ml-3">{formatDate(c.next_reach_out)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    )
  }

  // ── Active card ────────────────────────────────────────────────────────────

  const days = overdueDays(current.next_reach_out)

  return (
    <div className="space-y-4">
      {/* Progress */}
      <div className="flex items-center justify-between gap-4">
        <span className="text-white font-semibold text-sm">{remaining} left</span>
        <span className="text-xs text-gray-500">{completedCount} done</span>
      </div>
      <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
        <div
          className="h-full bg-blue-500 rounded-full transition-all duration-500"
          style={{ width: queue.length > 0 ? `${(completedCount / queue.length) * 100}%` : '0%' }}
        />
      </div>

      {/* Lead card */}
      <div className={`border rounded-2xl p-5 space-y-4 ${
        current.meeting_priority === 'high'
          ? 'bg-gray-900 border-red-900/60'
          : days > 0
            ? 'bg-gray-900 border-yellow-800/60'
            : 'bg-gray-900 border-gray-800'
      }`}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-white truncate">{current.company_name}</h2>
            <div className="flex items-center gap-2 mt-0.5">
              {current.state && <span className="text-xs text-gray-500 font-medium uppercase tracking-wider">{current.state}</span>}
              {current.meeting_priority && (
                <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${
                  current.meeting_priority === 'high' ? 'bg-red-900/60 text-red-300' : 'bg-blue-900/60 text-blue-300'
                }`}>{current.meeting_priority} priority</span>
              )}
            </div>
          </div>
          <div className="text-right shrink-0">
            {days > 0 ? <span className="text-sm font-medium text-red-400">{days}d overdue</span>
              : <span className="text-sm font-medium text-yellow-400">Due today</span>}
            <p className="text-xs text-gray-500 mt-0.5">{formatDate(current.next_reach_out)}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-x-4 gap-y-3">
          <div>
            <p className="text-xs text-gray-600 uppercase tracking-wide font-medium mb-0.5">Owner</p>
            <span className="text-sm text-white">{current.owners_name || '—'}</span>
          </div>
          <div>
            <p className="text-xs text-gray-600 uppercase tracking-wide font-medium mb-0.5">Phone</p>
            {current.phone_number ? (
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-300 font-medium">{current.phone_number}</span>
                <button
                  onClick={() => router.push(`/call?dial=${encodeURIComponent(current.phone_number!)}`)}
                  className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-green-700/60 hover:bg-green-600 text-green-300 hover:text-white text-xs font-medium transition-colors"
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                  </svg>
                  Call
                </button>
              </div>
            ) : <span className="text-sm text-gray-600">—</span>}
          </div>
          <div>
            <p className="text-xs text-gray-600 uppercase tracking-wide font-medium mb-0.5">Last Contact</p>
            <span className="text-sm text-gray-300">{formatDate(current.last_reach_out)}</span>
          </div>
          <div>
            <p className="text-xs text-gray-600 uppercase tracking-wide font-medium mb-0.5">Total Follow-ups</p>
            <span className="text-sm text-gray-300">{totalTouches} ({current.follow_up_calls ?? 0} calls, {current.follow_up_emails ?? 0} SMS)</span>
          </div>
          {current.who_called && (
            <div>
              <p className="text-xs text-gray-600 uppercase tracking-wide font-medium mb-0.5">Called By</p>
              <span className="text-sm text-gray-300">{current.who_called}</span>
            </div>
          )}
          {current.google_reviews != null && (
            <div>
              <p className="text-xs text-gray-600 uppercase tracking-wide font-medium mb-0.5">Google Reviews</p>
              <span className="text-sm text-gray-300">{current.google_reviews.toLocaleString()}</span>
            </div>
          )}
        </div>

        {current.notes && (
          <div className="pt-2 border-t border-gray-800">
            <p className="text-xs text-gray-500 uppercase tracking-wide font-medium mb-1">Notes</p>
            <p className="text-sm text-gray-300 whitespace-pre-wrap leading-relaxed">{current.notes}</p>
          </div>
        )}

        <div className="pt-2 border-t border-gray-800">
          <p className="text-xs text-gray-500">
            Next follow-up in <span className="text-gray-300 font-medium">{cadenceLabel(totalTouches + 1, current.meeting_priority)}</span>
            {current.meeting_priority === 'high' ? ' (halved for high priority)' : ''}.
          </p>
        </div>
      </div>

      {/* Actions */}
      <div className="space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => handleFollowedUp('call')} disabled={saving}
            className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-medium text-sm transition-all active:scale-[0.98] disabled:opacity-50">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
            </svg>
            Called
          </button>
          <button onClick={() => handleFollowedUp('email')} disabled={saving}
            className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-medium text-sm transition-all active:scale-[0.98] disabled:opacity-50">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
            Sent SMS
          </button>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <button onClick={handleMeetingBooked} disabled={saving}
            className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-green-700 hover:bg-green-600 text-white font-medium text-sm transition-all active:scale-[0.98] disabled:opacity-50">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            Meeting Booked
          </button>
          <button onClick={() => handleSnooze(90)} disabled={saving}
            className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-orange-800/70 hover:bg-orange-700 border border-orange-700/50 text-orange-300 font-medium text-sm transition-all active:scale-[0.98] disabled:opacity-50">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Changed Mind
          </button>
          <button onClick={handleGoneCold} disabled={saving}
            className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 font-medium text-sm transition-all active:scale-[0.98] disabled:opacity-50">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
            </svg>
            Gone Cold
          </button>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500 shrink-0">Snooze:</span>
          {[1, 3, 7].map(d => (
            <button key={d} onClick={() => handleSnooze(d)} disabled={saving}
              className="px-3 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-xs text-gray-400 hover:text-white hover:border-gray-600 transition-colors disabled:opacity-50">
              {d}d
            </button>
          ))}
          <div className="flex-1" />
          <button onClick={advance} className="text-xs text-gray-500 hover:text-gray-300 transition-colors px-2 py-1">Skip for now</button>
        </div>
      </div>
    </div>
  )
}

// ── Main component ───────────────────────────────────────────────────────────

export default function FollowUpQueue({
  highDue,
  lowDue,
  upcoming,
}: {
  highDue: Company[]
  lowDue: Company[]
  upcoming: Company[]
}) {
  const [tab, setTab] = useState<'high' | 'low'>('high')

  return (
    <div className="px-4 py-6 max-w-2xl mx-auto space-y-4">
      {/* Tab switcher */}
      <div className="flex gap-1 bg-gray-900 border border-gray-800 rounded-xl p-1">
        <button
          onClick={() => setTab('high')}
          className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
            tab === 'high' ? 'bg-red-900/60 text-red-300' : 'text-gray-400 hover:text-white hover:bg-gray-800'
          }`}
        >
          <span className="w-2 h-2 rounded-full bg-red-500" />
          High Priority
          <span className={`text-xs px-1.5 py-0.5 rounded-full ${tab === 'high' ? 'bg-red-800/60 text-red-300' : 'bg-gray-800 text-gray-500'}`}>
            {highDue.length}
          </span>
        </button>
        <button
          onClick={() => setTab('low')}
          className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
            tab === 'low' ? 'bg-blue-900/60 text-blue-300' : 'text-gray-400 hover:text-white hover:bg-gray-800'
          }`}
        >
          <span className="w-2 h-2 rounded-full bg-blue-500" />
          Other
          <span className={`text-xs px-1.5 py-0.5 rounded-full ${tab === 'low' ? 'bg-blue-800/60 text-blue-300' : 'bg-gray-800 text-gray-500'}`}>
            {lowDue.length}
          </span>
        </button>
      </div>

      {/* Active queue */}
      {tab === 'high' ? (
        <QueueSection key="high" queue={highDue} upcoming={upcoming.filter(c => c.meeting_priority === 'high')} label="High Priority" />
      ) : (
        <QueueSection key="low" queue={lowDue} upcoming={upcoming.filter(c => c.meeting_priority !== 'high')} label="Other" />
      )}
    </div>
  )
}
