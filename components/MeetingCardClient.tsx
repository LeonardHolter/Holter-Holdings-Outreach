'use client'

import { useState } from 'react'
import { format, parseISO, isPast, isToday } from 'date-fns'
import { toast } from 'sonner'
import type { Company } from '@/types'

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
    <span className={`text-sm font-medium ${overdue ? 'text-red-400' : today ? 'text-yellow-400' : 'text-green-400'}`}>
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

export default function MeetingCardClient({ company: initial }: { company: Company }) {
  const [c, setC]           = useState(initial)
  const [saving, setSaving] = useState(false)
  const [copied, setCopied] = useState(false)

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

  async function toggleAndre() {
    const giving = !c.andre_lead_given
    await patch({
      andre_lead_given: giving,
      andre_lead_date:  giving ? new Date().toISOString().slice(0, 10) : null,
      andre_heard_back: giving ? c.andre_heard_back : null,
    })
    if (giving) toast.success('Marked as lead given to Andre')
    else        toast.success('Unmarked')
  }

  async function setHeardBack(value: string) {
    await patch({ andre_heard_back: value || null })
  }

  async function setPriority(priority: 'high' | 'low' | null) {
    await patch({ meeting_priority: priority })
    if (priority) toast.success(`Set to ${priority} priority`)
    else toast.success('Priority cleared')
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

  return (
    <div className={`border rounded-2xl p-5 space-y-4 transition-all ${
      c.andre_lead_given
        ? 'bg-gray-900/40 border-gray-700/40 opacity-70'
        : overdue ? 'bg-gray-900 border-red-900/60'
        : today   ? 'bg-gray-900 border-yellow-800/60'
        :           'bg-gray-900 border-gray-800'
    }`}>

      {/* Top row */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 className={`text-base font-semibold truncate ${c.andre_lead_given ? 'line-through text-gray-500' : 'text-white'}`}>
            {c.company_name}
          </h2>
          {c.state && (
            <span className="text-xs text-gray-500 font-medium uppercase tracking-wider">{c.state}</span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={copyForAndre}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-medium transition-all touch-manipulation ${
              copied
                ? 'bg-green-900/50 border-green-700 text-green-300'
                : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-white hover:border-gray-500'
            }`}
          >
            {copied ? (
              <>
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
                Copied
              </>
            ) : (
              <>
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                Copy
              </>
            )}
          </button>
          <span className="inline-flex items-center gap-1 px-2 py-1 bg-green-950/60 border border-green-800/50 rounded-full text-xs text-green-400 font-medium">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            Intro wanted
          </span>
        </div>
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

      {/* Andre section */}
      <div className="pt-2 border-t border-gray-800 space-y-3">
        {/* Toggle button */}
        <button
          onClick={toggleAndre}
          disabled={saving}
          className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl border text-sm font-medium transition-all touch-manipulation ${
            c.andre_lead_given
              ? 'bg-purple-950/40 border-purple-700/50 text-purple-300 hover:bg-purple-950/60'
              : 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700 hover:text-white'
          } disabled:opacity-50`}
        >
          <span className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${
            c.andre_lead_given ? 'bg-purple-600 border-purple-500' : 'border-gray-500'
          }`}>
            {c.andre_lead_given && (
              <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
              </svg>
            )}
          </span>
          <span className="flex-1 text-left">Lead given to Andre</span>
          {c.andre_lead_given && c.andre_lead_date && (
            <span className="text-xs text-purple-400/80 font-normal shrink-0">
              {formatDate(c.andre_lead_date)}
            </span>
          )}
        </button>

        {/* Heard back dropdown — only shown once marked */}
        {c.andre_lead_given && (
          <div className="flex items-center gap-3 px-1">
            <span className="text-xs text-gray-500 shrink-0">Andre heard back?</span>
            <div className="flex gap-2 flex-1">
              {(['Yes', 'No', 'Pending'] as const).map(opt => (
                <button
                  key={opt}
                  onClick={() => setHeardBack(c.andre_heard_back === opt ? '' : opt)}
                  disabled={saving}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-medium border transition-colors touch-manipulation ${
                    c.andre_heard_back === opt
                      ? opt === 'Yes'
                        ? 'bg-green-900/60 border-green-700 text-green-300'
                        : opt === 'No'
                          ? 'bg-red-900/60 border-red-700 text-red-300'
                          : 'bg-yellow-900/40 border-yellow-700/60 text-yellow-300'
                      : 'bg-gray-800 border-gray-700 text-gray-500 hover:text-gray-300 hover:border-gray-600'
                  } disabled:opacity-50`}
                >
                  {opt}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
