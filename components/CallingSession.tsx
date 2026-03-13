'use client'

import { useState, useCallback } from 'react'
import { toast } from 'sonner'
import { format } from 'date-fns'
import type { Company } from '@/types'
import { RESPONSE_STATUSES, TEAM_MEMBERS, STATES } from '@/types'

interface Props {
  initialQueue: Company[]
}

async function patchCompany(id: string, payload: Partial<Company>): Promise<Company> {
  const res = await fetch(`/api/companies/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error('Failed to save')
  return res.json()
}

function today() {
  return format(new Date(), 'yyyy-MM-dd')
}

function twoWeeksFromNow() {
  const d = new Date()
  d.setDate(d.getDate() + 14)
  return format(d, 'yyyy-MM-dd')
}

export function CallingSession({ initialQueue }: Props) {
  const [queue, setQueue] = useState<Company[]>(initialQueue)
  const [index, setIndex] = useState(0)
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)
  const [sessionCaller, setSessionCaller] = useState<string>('')

  // Per-card editable fields
  const [response, setResponse] = useState<string>('')
  const [notes, setNotes] = useState<string>('')
  const [ownersName, setOwnersName] = useState<string>('')
  const [phoneNumber, setPhoneNumber] = useState<string>('')
  const [state, setState] = useState<string>('')
  const [companyName, setCompanyName] = useState<string>('')

  const company = queue[index]

  // Load current company values into edit state whenever index changes
  const loadCompany = useCallback((c: Company) => {
    setResponse(c.reach_out_response ?? '')
    setNotes(c.notes ?? '')
    setOwnersName(c.owners_name ?? '')
    setPhoneNumber(c.phone_number ?? '')
    setState(c.state ?? '')
    setCompanyName(c.company_name ?? '')
  }, [])

  // On first render, load the first company
  useState(() => {
    if (queue[0]) loadCompany(queue[0])
  })

  // ── Advance to next ──────────────────────────────────────────
  async function handleNext(skip = false) {
    if (!company) return
    setSaving(true)

    try {
      const payload: Partial<Company> = {
        company_name: companyName || company.company_name,
        notes: notes || null,
        owners_name: ownersName || null,
        phone_number: phoneNumber || null,
        state: state || null,
      }

      if (!skip && response) {
        payload.reach_out_response = response
        payload.who_called = sessionCaller || null
        payload.last_reach_out = today()
        payload.next_reach_out = twoWeeksFromNow()
        payload.amount_of_calls = (company.amount_of_calls ?? 0) + 1
      }

      const updated = await patchCompany(company.id, payload)
      setQueue(q => q.map(c => c.id === updated.id ? updated : c))
      toast.success(skip ? 'Skipped' : 'Saved')
    } catch {
      toast.error('Failed to save')
    } finally {
      setSaving(false)
    }

    const nextIndex = index + 1
    if (nextIndex >= queue.length) {
      setDone(true)
    } else {
      setIndex(nextIndex)
      loadCompany(queue[nextIndex])
    }
  }

  function handleBack() {
    if (index === 0) return
    const prevIndex = index - 1
    setIndex(prevIndex)
    loadCompany(queue[prevIndex])
  }

  // ── Done state ───────────────────────────────────────────────
  if (done || queue.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-6 text-center px-4">
        <div className="w-16 h-16 rounded-full bg-green-900/40 border border-green-700 flex items-center justify-center">
          <svg className="w-8 h-8 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <div>
          <h2 className="text-2xl font-bold text-white">Queue complete</h2>
          <p className="text-gray-400 mt-1">
            {queue.length === 0
              ? 'No companies in the calling queue right now.'
              : `You've gone through all ${queue.length} companies.`}
          </p>
        </div>
        <div className="flex gap-3">
          <a href="/" className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-lg text-sm transition-colors">
            Back to Pipeline
          </a>
          <button
            onClick={() => { setIndex(0); setDone(false); if (queue[0]) loadCompany(queue[0]) }}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm transition-colors"
          >
            Start over
          </button>
        </div>
      </div>
    )
  }

  const progress = ((index) / queue.length) * 100

  return (
    <div className="flex-1 overflow-y-auto flex flex-col items-center justify-start py-8 px-4">
      <div className="w-full max-w-2xl space-y-4">

        {/* Session caller picker */}
        {!sessionCaller && (
          <div className="bg-blue-950/30 border border-blue-800/50 rounded-xl p-4 flex items-center gap-3">
            <svg className="w-4 h-4 text-blue-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
            <span className="text-sm text-blue-300">Who is calling today?</span>
            <select
              value={sessionCaller}
              onChange={e => setSessionCaller(e.target.value)}
              className="ml-auto bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
            >
              <option value="">Select caller…</option>
              {TEAM_MEMBERS.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
        )}

        {sessionCaller && (
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-500">
              Calling as <span className="text-gray-300 font-medium">{sessionCaller}</span>
              <button onClick={() => setSessionCaller('')} className="ml-2 text-gray-600 hover:text-gray-400 text-xs underline">change</button>
            </span>
            <span className="text-sm text-gray-500">{index + 1} / {queue.length}</span>
          </div>
        )}

        {/* Progress bar */}
        <div className="w-full bg-gray-800 rounded-full h-1.5 overflow-hidden">
          <div
            className="h-1.5 bg-blue-500 rounded-full transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>

        {/* Company card */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">

          {/* Company name */}
          <div className="px-6 pt-6 pb-4 border-b border-gray-800">
            <label className="text-xs text-gray-500 uppercase tracking-wide font-medium">Company</label>
            <input
              value={companyName}
              onChange={e => setCompanyName(e.target.value)}
              className="mt-1 w-full bg-transparent text-2xl font-bold text-white focus:outline-none border-b border-transparent focus:border-gray-600 pb-1 transition-colors"
              placeholder="Company name"
            />
          </div>

          <div className="px-6 py-5 grid grid-cols-2 gap-5">
            {/* Phone */}
            <Field label="Phone Number">
              <a
                href={`tel:${phoneNumber}`}
                onClick={e => phoneNumber ? undefined : e.preventDefault()}
                className="text-blue-400 hover:text-blue-300 text-lg font-semibold transition-colors"
              >
                {phoneNumber || '—'}
              </a>
              <input
                value={phoneNumber}
                onChange={e => setPhoneNumber(e.target.value)}
                placeholder="Edit phone…"
                className="mt-1 w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
              />
            </Field>

            {/* State */}
            <Field label="State">
              <select
                value={state}
                onChange={e => setState(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
              >
                <option value="">—</option>
                {STATES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>

            {/* Owner's name */}
            <Field label="Owner's Name">
              <input
                value={ownersName}
                onChange={e => setOwnersName(e.target.value)}
                placeholder="Unknown"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
              />
            </Field>

            {/* Google reviews */}
            <Field label="Google Reviews">
              <span className="text-white font-semibold text-lg">
                {company?.google_reviews?.toLocaleString() ?? '—'}
              </span>
            </Field>
          </div>

          {/* Notes */}
          <div className="px-6 pb-5">
            <Field label="Notes">
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                rows={3}
                placeholder="Add notes…"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 resize-none"
              />
            </Field>
          </div>

          {/* Response + actions */}
          <div className="px-6 pb-6 border-t border-gray-800 pt-5 space-y-4">
            <Field label="Call Outcome">
              <div className="grid grid-cols-2 gap-2 mt-1">
                {RESPONSE_STATUSES.map(r => (
                  <button
                    key={r}
                    onClick={() => setResponse(r)}
                    className={`text-left px-3 py-2 rounded-lg border text-sm transition-colors ${
                      response === r
                        ? getResponseButtonStyle(r)
                        : 'border-gray-700 bg-gray-800 text-gray-400 hover:border-gray-600 hover:text-gray-300'
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </Field>

            {/* Action buttons */}
            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={handleBack}
                disabled={index === 0 || saving}
                className="px-4 py-2.5 rounded-xl border border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed text-sm font-medium transition-colors"
              >
                ← Back
              </button>
              <button
                onClick={() => handleNext(true)}
                disabled={saving}
                className="px-4 py-2.5 rounded-xl border border-gray-700 bg-gray-800 text-gray-400 hover:bg-gray-700 disabled:opacity-50 text-sm font-medium transition-colors"
              >
                Skip
              </button>
              <button
                onClick={() => handleNext(false)}
                disabled={saving || !response}
                className="flex-1 flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold text-sm transition-colors"
              >
                {saving ? (
                  <>
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                    </svg>
                    Saving…
                  </>
                ) : (
                  <>
                    Log & Next
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                    </svg>
                  </>
                )}
              </button>
            </div>
            {!response && (
              <p className="text-xs text-gray-600 text-center">Select a call outcome to log and advance</p>
            )}
          </div>
        </div>

        {/* Mini queue preview */}
            {queue.length > index + 1 && (() => {
          const next = queue[index + 1]
          return next ? (
            <div className="text-center">
              <p className="text-xs text-gray-600">
                Up next: <span className="text-gray-400">{next.company_name}</span>
                {next.state && <span className="text-gray-600"> · {next.state}</span>}
              </p>
            </div>
          ) : null
        })()}
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs text-gray-500 uppercase tracking-wide font-medium">{label}</label>
      {children}
    </div>
  )
}

function getResponseButtonStyle(response: string): string {
  if (response === 'Intro-meeting wanted') return 'border-green-600 bg-green-950/50 text-green-300'
  if (response === 'Owner is not interested' || response === 'Already acquired') return 'border-red-700 bg-red-950/50 text-red-300'
  if (response === 'Left a message to the owner' || response === 'Call back on Monday') return 'border-yellow-600 bg-yellow-950/50 text-yellow-300'
  if (response === 'Not called') return 'border-gray-600 bg-gray-800 text-gray-300'
  return 'border-blue-600 bg-blue-950/50 text-blue-300'
}
