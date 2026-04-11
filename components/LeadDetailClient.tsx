'use client'

import { useState } from 'react'
import { format, parseISO, isPast, isToday } from 'date-fns'
import { toast } from 'sonner'
import type { Company, CompanyNote, CallRecording } from '@/types'
import RecordingsPlayer from './RecordingsPlayer'
import Link from 'next/link'

type RecordingWithStream = CallRecording & { streamUrl: string | null }

function formatDate(d: string | null) {
  if (!d) return '—'
  try { return format(parseISO(d), 'MMM d, yyyy') } catch { return d }
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-gray-600 uppercase tracking-wide font-medium mb-0.5">{label}</p>
      {children}
    </div>
  )
}

export default function LeadDetailClient({
  lead,
  recordings,
  notes,
}: {
  lead: Company
  recordings: RecordingWithStream[]
  notes: CompanyNote[]
}) {
  const [c, setC] = useState(lead)
  const [saving, setSaving] = useState(false)
  const [copied, setCopied] = useState(false)
  const [copiedFull, setCopiedFull] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)

  const nextDate = c.next_reach_out ? parseISO(c.next_reach_out) : null
  const overdue = nextDate && isPast(nextDate) && !isToday(nextDate)
  const today = nextDate && isToday(nextDate)
  const followUpTotal = (c.follow_up_calls ?? 0) + (c.follow_up_emails ?? 0)

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

  function copyForSearcher() {
    const parts = [
      `Company: ${c.company_name}`,
      c.state ? `State: ${c.state}` : null,
      c.owners_name ? `Owner: ${c.owners_name}` : null,
      c.phone_number ? `Phone: ${c.phone_number}` : null,
      c.email ? `Email: ${c.email}` : null,
      c.google_reviews != null ? `Google Reviews: ${c.google_reviews}` : null,
      c.notes ? `\nNotes: ${c.notes}` : null,
      notes.length > 0 ? `\nCall Notes:\n${notes.map(n => `- ${n.note}${n.caller_name ? ` (${n.caller_name})` : ''}`).join('\n')}` : null,
      `\nFollow-ups: ${followUpTotal} (${c.follow_up_calls ?? 0} calls, ${c.follow_up_emails ?? 0} SMS)`,
      c.last_reach_out ? `Last Contact: ${formatDate(c.last_reach_out)}` : null,
      c.next_reach_out ? `Next Reach Out: ${formatDate(c.next_reach_out)}` : null,
    ].filter(Boolean).join('\n')

    navigator.clipboard.writeText(parts).then(() => {
      setCopiedFull(true)
      toast.success('Lead info copied to clipboard')
      setTimeout(() => setCopiedFull(false), 2000)
    })
  }

  function copyQuick() {
    const statePart = c.state ? ` (${c.state})` : ''
    const ownerPart = c.owners_name ? `, Owner: ${c.owners_name}` : ''
    const notesPart = c.notes ? `, ${c.notes}` : ''
    const text = `${c.company_name}${statePart}: ${c.phone_number ?? '—'}${ownerPart}${notesPart}`
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
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
    <div className="px-4 py-6 max-w-3xl mx-auto space-y-5">

      {/* Back link */}
      <Link href="/meetings" className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-300 transition-colors">
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back to Leads
      </Link>

      {/* Header card */}
      <div className={`border rounded-2xl p-5 space-y-4 ${
        overdue ? 'bg-gray-900 border-red-900/60'
          : today ? 'bg-gray-900 border-yellow-800/60'
          : 'bg-gray-900 border-gray-800'
      }`}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-white">{c.company_name}</h1>
            <div className="flex items-center gap-2 mt-1">
              {c.state && <span className="text-xs text-gray-500 font-medium uppercase tracking-wider">{c.state}</span>}
              {c.meeting_priority && (
                <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${
                  c.meeting_priority === 'high' ? 'bg-red-900/60 text-red-300' : 'bg-blue-900/60 text-blue-300'
                }`}>
                  {c.meeting_priority} priority
                </span>
              )}
              <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-green-900/60 text-green-300">Intro wanted</span>
            </div>
          </div>
          {c.next_reach_out && (
            <div className="text-right shrink-0">
              <span className={`text-sm font-medium ${overdue ? 'text-red-400' : today ? 'text-yellow-400' : 'text-green-400'}`}>
                {overdue ? 'Overdue' : today ? 'Due today' : 'Upcoming'}
              </span>
              <p className="text-xs text-gray-500 mt-0.5">{formatDate(c.next_reach_out)}</p>
            </div>
          )}
        </div>

        {/* Details grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3">
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
          <Detail label="Email">
            {c.email ? (
              <a href={`mailto:${c.email}`} className="text-sm text-blue-400 hover:text-blue-300 transition-colors font-medium truncate block">
                {c.email}
              </a>
            ) : (
              <span className="text-sm text-gray-600">—</span>
            )}
          </Detail>
          <Detail label="Last Contact">
            <span className="text-sm text-gray-300">{formatDate(c.last_reach_out)}</span>
          </Detail>
          <Detail label="Total Calls">
            <span className="text-sm text-gray-300">{c.amount_of_calls}</span>
          </Detail>
          <Detail label="Follow-ups">
            <span className="text-sm text-gray-300">{followUpTotal} ({c.follow_up_calls ?? 0} calls, {c.follow_up_emails ?? 0} SMS)</span>
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

        {/* Priority controls */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500 font-medium">Priority:</span>
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
      </div>

      {/* Copy for searcher buttons */}
      <div className="flex gap-2">
        <button
          onClick={copyForSearcher}
          className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl border text-sm font-medium transition-all active:scale-[0.98] ${
            copiedFull
              ? 'bg-green-900/50 border-green-700 text-green-300'
              : 'bg-blue-600 hover:bg-blue-500 border-blue-600 text-white'
          }`}
        >
          {copiedFull ? (
            <>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
              Copied!
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              Copy full lead info for searcher
            </>
          )}
        </button>
        <button
          onClick={copyQuick}
          className={`px-4 py-3 rounded-xl border text-sm font-medium transition-all active:scale-[0.98] ${
            copied
              ? 'bg-green-900/50 border-green-700 text-green-300'
              : 'bg-gray-800 hover:bg-gray-700 border-gray-700 text-gray-300'
          }`}
        >
          {copied ? 'Copied' : 'Quick copy'}
        </button>
      </div>

      {/* Analyze */}
      <button
        onClick={handleAnalyze}
        disabled={analyzing}
        className={`w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl border text-sm font-medium transition-all active:scale-[0.98] disabled:opacity-50 ${
          analyzing
            ? 'bg-indigo-900/50 border-indigo-700 text-indigo-300'
            : c.enriched_at
              ? 'bg-indigo-900/40 border-indigo-800/50 text-indigo-300 hover:bg-indigo-900/60'
              : 'bg-gray-800 border-gray-700 text-gray-300 hover:text-indigo-300 hover:border-indigo-700/60'
        }`}
      >
        {analyzing ? (
          <>
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
            </svg>
            Analyzing...
          </>
        ) : (
          <>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
            {c.enriched_at ? 'Re-analyze Lead' : 'Analyze Lead'}
          </>
        )}
      </button>

      {/* Enrichment results */}
      {c.enriched_at && (
        <div className="bg-indigo-950/30 border border-indigo-800/40 rounded-2xl px-5 py-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-indigo-400 uppercase tracking-wide">Revenue Estimate</h2>
            {c.revenue_confidence && (
              <span className={`text-xs px-2 py-0.5 rounded font-medium ${
                c.revenue_confidence === 'high' ? 'bg-green-900/60 text-green-400'
                : c.revenue_confidence === 'medium' ? 'bg-yellow-900/60 text-yellow-400'
                : 'bg-gray-800 text-gray-400'
              }`}>{c.revenue_confidence} confidence</span>
            )}
          </div>
          <p className="text-2xl font-bold text-white">
            {formatRevenue(c.estimated_revenue_low)}
            {' – '}
            {formatRevenue(c.estimated_revenue_high)}
            <span className="text-base font-normal text-gray-500"> / year</span>
          </p>
          {c.technician_count_estimate != null && (
            <p className="text-sm text-gray-400">~{c.technician_count_estimate} technicians estimated</p>
          )}
          <p className="text-sm text-gray-500 leading-relaxed">{c.enrichment_reasoning}</p>
          {c.enrichment_signals?.length ? (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {c.enrichment_signals.map((s, i) => (
                <span key={i} className="text-xs px-2.5 py-0.5 rounded-full bg-gray-800 border border-gray-700 text-gray-400">{s}</span>
              ))}
            </div>
          ) : null}
        </div>
      )}

      {/* Notes */}
      {(c.notes || notes.length > 0) && (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 space-y-3">
          <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wide">Notes</h2>
          {c.notes && (
            <p className="text-sm text-gray-300 whitespace-pre-wrap leading-relaxed">{c.notes}</p>
          )}
          {notes.length > 0 && (
            <div className="space-y-2 pt-2 border-t border-gray-800">
              {notes.map(n => (
                <div key={n.id} className="text-sm">
                  <p className="text-gray-300 leading-relaxed">{n.note}</p>
                  <p className="text-xs text-gray-600 mt-0.5">
                    {n.caller_name && <span>{n.caller_name} · </span>}
                    {formatDate(n.created_at)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Recordings */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 space-y-3">
        <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wide">
          Call Recordings ({recordings.length})
        </h2>
        {recordings.length === 0 ? (
          <p className="text-sm text-gray-600 py-4 text-center">No recordings yet for this company.</p>
        ) : (
          <div className="space-y-3">
            {recordings.map((r, idx) => (
              <div key={r.id} className="bg-gray-800/60 border border-gray-700 rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className="text-gray-500">
                    #{idx + 1} · {formatDate(r.called_at)}
                    {r.duration_seconds != null && ` · ${Math.floor(r.duration_seconds / 60)}:${(r.duration_seconds % 60).toString().padStart(2, '0')}`}
                  </span>
                  <span className="text-gray-400">{r.called_by ?? 'Unknown'}</span>
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
    </div>
  )
}
