'use client'

import { useState, useMemo } from 'react'
import { format, parseISO, differenceInCalendarDays } from 'date-fns'
import { toast } from 'sonner'
import type { Company } from '@/types'

// ── Smart cadence: next follow-up date based on touch count + priority ──────

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

// ── SMS templates ───────────────────────────────────────────────────────────

function smsTemplates(c: Company) {
  const name = c.owners_name?.split(' ')[0] || 'there'
  return [
    {
      label: 'Quick check-in',
      body: `Hey ${name}, just following up on our conversation about ${c.company_name}. Still interested in meeting this week?`,
    },
    {
      label: 'Value nudge',
      body: `Hi ${name}, wanted to share how we've helped similar garage door companies${c.state ? ` in ${c.state}` : ''}. Would love to set up a quick call to discuss.`,
    },
    {
      label: 'Last attempt',
      body: `Hi ${name}, I've tried reaching out a few times about ${c.company_name}. If you're still interested, I'd love to set up a quick call — just let me know!`,
    },
  ]
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(d: string | null) {
  if (!d) return '—'
  try { return format(parseISO(d), 'MMM d, yyyy') } catch { return d }
}

function overdueDays(d: string | null): number {
  if (!d) return 0
  try { return Math.max(0, differenceInCalendarDays(new Date(), parseISO(d))) } catch { return 0 }
}

// ── Component ───────────────────────────────────────────────────────────────

export default function FollowUpQueue({
  initialDue,
  upcoming,
}: {
  initialDue: Company[]
  upcoming: Company[]
}) {
  const [queue, _setQueue] = useState(initialDue)
  const [idx, setIdx] = useState(0)
  const [saving, setSaving] = useState(false)
  const [showSms, setShowSms] = useState(false)
  const [smsBody, setSmsBody] = useState('')
  const [sendingSms, setSendingSms] = useState(false)
  const [showUpcoming, setShowUpcoming] = useState(false)
  const [completedCount, setCompletedCount] = useState(0)

  const current = queue[idx] as Company | undefined
  const remaining = queue.length - idx
  const totalTouches = current ? (current.follow_up_calls ?? 0) + (current.follow_up_emails ?? 0) : 0

  const stats = useMemo(() => {
    const high = queue.filter(c => c.meeting_priority === 'high').length
    const overdue = queue.filter(c => overdueDays(c.next_reach_out) > 0).length
    return { high, overdue, total: queue.length }
  }, [queue])

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
    setShowSms(false)
    setSmsBody('')
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
    if (ok) {
      toast.success('Meeting booked!')
      advance()
    }
  }

  async function handleGoneCold() {
    if (!current) return
    const ok = await patch(current.id, {
      reach_out_response: 'Owner is not interested',
      last_reach_out: new Date().toISOString().slice(0, 10),
    })
    if (ok) {
      toast.success('Marked as gone cold')
      advance()
    }
  }

  async function handleSkip() {
    advance()
  }

  async function handleSnooze(days: number) {
    if (!current) return
    const d = new Date()
    d.setDate(d.getDate() + days)
    const ok = await patch(current.id, { next_reach_out: d.toISOString().slice(0, 10) })
    if (ok) {
      toast.success(`Snoozed ${days} day${days !== 1 ? 's' : ''}`)
      advance()
    }
  }

  async function handleSendSms(template: { label: string; body: string }) {
    if (!current?.phone_number) {
      toast.error('No phone number on file')
      return
    }
    const body = smsBody || template.body
    if (!body.trim()) return

    setSendingSms(true)
    try {
      const res = await fetch('/api/twilio/send-sms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: current.phone_number,
          from: current.phone_number,
          body: body.trim(),
        }),
      })
      if (!res.ok) throw new Error('SMS failed')
      toast.success(`SMS sent: "${template.label}"`)

      const nextEmails = (current.follow_up_emails ?? 0) + 1
      const nextCalls = current.follow_up_calls ?? 0
      const nextDate = nextFollowUpDate(nextCalls + nextEmails, current.meeting_priority)
      await patch(current.id, {
        follow_up_emails: nextEmails,
        next_reach_out: nextDate,
        last_reach_out: new Date().toISOString().slice(0, 10),
      })
      advance()
    } catch {
      toast.error('Failed to send SMS')
    } finally {
      setSendingSms(false)
    }
  }

  // ── Done state ────────────────────────────────────────────────────────────

  if (!current) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] px-4">
        <div className="text-center space-y-4 max-w-md">
          <div className="w-16 h-16 rounded-full bg-green-900/40 border border-green-700/50 flex items-center justify-center mx-auto">
            <svg className="w-8 h-8 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          {completedCount > 0 ? (
            <>
              <h2 className="text-xl font-bold text-white">All caught up!</h2>
              <p className="text-gray-400">
                You cleared {completedCount} follow-up{completedCount !== 1 ? 's' : ''} today.
              </p>
            </>
          ) : (
            <>
              <h2 className="text-xl font-bold text-white">No follow-ups due</h2>
              <p className="text-gray-400">
                No leads need attention right now. Check back tomorrow.
              </p>
            </>
          )}

          {upcoming.length > 0 && (
            <div className="pt-4">
              <button
                onClick={() => setShowUpcoming(!showUpcoming)}
                className="text-sm text-blue-400 hover:text-blue-300 transition-colors"
              >
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

  // ── Active card ───────────────────────────────────────────────────────────

  const days = overdueDays(current.next_reach_out)

  return (
    <div className="px-4 py-6 max-w-2xl mx-auto space-y-4">

      {/* Progress bar */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 text-sm">
          <span className="text-white font-semibold">{remaining} left</span>
          {stats.high > 0 && (
            <span className="text-red-400 text-xs">{stats.high} high priority</span>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <span>{completedCount} done today</span>
        </div>
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

        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-white truncate">{current.company_name}</h2>
            <div className="flex items-center gap-2 mt-0.5">
              {current.state && (
                <span className="text-xs text-gray-500 font-medium uppercase tracking-wider">{current.state}</span>
              )}
              {current.meeting_priority && (
                <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${
                  current.meeting_priority === 'high'
                    ? 'bg-red-900/60 text-red-300'
                    : 'bg-blue-900/60 text-blue-300'
                }`}>
                  {current.meeting_priority} priority
                </span>
              )}
            </div>
          </div>
          <div className="text-right shrink-0">
            {days > 0 ? (
              <span className="text-sm font-medium text-red-400">{days}d overdue</span>
            ) : (
              <span className="text-sm font-medium text-yellow-400">Due today</span>
            )}
            <p className="text-xs text-gray-500 mt-0.5">{formatDate(current.next_reach_out)}</p>
          </div>
        </div>

        {/* Details */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-3">
          <div>
            <p className="text-xs text-gray-600 uppercase tracking-wide font-medium mb-0.5">Owner</p>
            <span className="text-sm text-white">{current.owners_name || '—'}</span>
          </div>
          <div>
            <p className="text-xs text-gray-600 uppercase tracking-wide font-medium mb-0.5">Phone</p>
            {current.phone_number ? (
              <a href={`tel:${current.phone_number}`} className="text-sm text-blue-400 hover:text-blue-300 transition-colors font-medium">
                {current.phone_number}
              </a>
            ) : (
              <span className="text-sm text-gray-600">—</span>
            )}
          </div>
          <div>
            <p className="text-xs text-gray-600 uppercase tracking-wide font-medium mb-0.5">Last Contact</p>
            <span className="text-sm text-gray-300">{formatDate(current.last_reach_out)}</span>
          </div>
          <div>
            <p className="text-xs text-gray-600 uppercase tracking-wide font-medium mb-0.5">Total Follow-ups</p>
            <span className="text-sm text-gray-300">
              {totalTouches} ({current.follow_up_calls ?? 0} calls, {current.follow_up_emails ?? 0} SMS)
            </span>
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

        {/* Notes */}
        {current.notes && (
          <div className="pt-2 border-t border-gray-800">
            <p className="text-xs text-gray-500 uppercase tracking-wide font-medium mb-1">Notes</p>
            <p className="text-sm text-gray-300 whitespace-pre-wrap leading-relaxed">{current.notes}</p>
          </div>
        )}

        {/* Cadence hint */}
        <div className="pt-2 border-t border-gray-800">
          <p className="text-xs text-gray-500">
            Next follow-up will be scheduled in <span className="text-gray-300 font-medium">{cadenceLabel(totalTouches + 1, current.meeting_priority)}</span> based on {totalTouches + 1} total touches
            {current.meeting_priority === 'high' ? ' (halved for high priority)' : ''}.
          </p>
        </div>
      </div>

      {/* Actions */}
      <div className="space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => handleFollowedUp('call')}
            disabled={saving}
            className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-medium text-sm transition-all active:scale-[0.98] disabled:opacity-50"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
            </svg>
            Called
          </button>
          <button
            onClick={() => {
              setShowSms(!showSms)
              if (!showSms && current) {
                const templates = smsTemplates(current)
                const touchCount = (current.follow_up_calls ?? 0) + (current.follow_up_emails ?? 0)
                const pick = touchCount >= 4 ? 2 : touchCount >= 2 ? 1 : 0
                setSmsBody(templates[pick].body)
              }
            }}
            disabled={saving}
            className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-medium text-sm transition-all active:scale-[0.98] disabled:opacity-50"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
            Send SMS
          </button>
        </div>

        {/* SMS panel */}
        {showSms && current && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3">
            <div className="flex gap-2 flex-wrap">
              {smsTemplates(current).map((t) => (
                <button
                  key={t.label}
                  onClick={() => setSmsBody(t.body)}
                  className={`text-xs px-2.5 py-1.5 rounded-lg border transition-colors ${
                    smsBody === t.body
                      ? 'bg-purple-900/60 border-purple-700 text-purple-300'
                      : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-white hover:border-gray-600'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <textarea
              value={smsBody}
              onChange={e => setSmsBody(e.target.value)}
              rows={3}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 resize-none focus:outline-none focus:border-purple-600"
              placeholder="Type your SMS..."
            />
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-500">
                To: {current.phone_number || 'No number'}
              </span>
              <button
                onClick={() => {
                  const templates = smsTemplates(current)
                  const match = templates.find(t => t.body === smsBody)
                  handleSendSms(match || { label: 'Custom', body: smsBody })
                }}
                disabled={sendingSms || !smsBody.trim() || !current.phone_number}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white text-sm font-medium rounded-lg transition-all disabled:opacity-50 active:scale-[0.98]"
              >
                {sendingSms ? 'Sending...' : 'Send'}
              </button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={handleMeetingBooked}
            disabled={saving}
            className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-green-700 hover:bg-green-600 text-white font-medium text-sm transition-all active:scale-[0.98] disabled:opacity-50"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            Meeting Booked
          </button>
          <button
            onClick={handleGoneCold}
            disabled={saving}
            className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 font-medium text-sm transition-all active:scale-[0.98] disabled:opacity-50"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
            </svg>
            Gone Cold
          </button>
        </div>

        {/* Snooze + skip row */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500 shrink-0">Snooze:</span>
          {[1, 3, 7].map(d => (
            <button
              key={d}
              onClick={() => handleSnooze(d)}
              disabled={saving}
              className="px-3 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-xs text-gray-400 hover:text-white hover:border-gray-600 transition-colors disabled:opacity-50"
            >
              {d}d
            </button>
          ))}
          <div className="flex-1" />
          <button
            onClick={handleSkip}
            className="text-xs text-gray-500 hover:text-gray-300 transition-colors px-2 py-1"
          >
            Skip for now
          </button>
        </div>
      </div>

      {/* Upcoming preview */}
      {upcoming.length > 0 && (
        <div className="pt-4">
          <button
            onClick={() => setShowUpcoming(!showUpcoming)}
            className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-300 transition-colors"
          >
            <svg className={`w-3.5 h-3.5 transition-transform ${showUpcoming ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            Coming up next ({upcoming.length})
          </button>
          {showUpcoming && (
            <div className="mt-2 space-y-1.5">
              {upcoming.map(c => (
                <div key={c.id} className="flex items-center justify-between px-3 py-2 bg-gray-900/50 border border-gray-800/50 rounded-lg">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-gray-300 truncate">{c.company_name}</p>
                  </div>
                  <span className="text-xs text-green-400/70 shrink-0 ml-3">{formatDate(c.next_reach_out)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
