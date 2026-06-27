'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { format } from 'date-fns'
import type { Company, CompanyNote } from '@/types'
import { RESPONSE_STATUSES, TEAM_MEMBERS, REGIONS } from '@/types'

interface Props {
  initialQueue: Company[]
  dialNumber?: string
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

function todayStr() { return format(new Date(), 'yyyy-MM-dd') }

const DAYS_OF_WEEK = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']

function callbackMatchesNow(c: Company): boolean {
  const now = new Date()
  const todayName = DAYS_OF_WEEK[now.getDay()]
  if (c.callback_day && c.callback_day !== todayName) return false
  if (c.callback_time) {
    const [h, m] = c.callback_time.split(':').map(Number)
    const callbackMinutes = h * 60 + m
    const nowMinutes = now.getHours() * 60 + now.getMinutes()
    if (Math.abs(nowMinutes - callbackMinutes) > 120) return false
  }
  return !!(c.callback_day || c.callback_time)
}

// Revenue-tier lead priority (driftsinntekter in thousands NOK). Lower = higher
// priority. Mirrors PRIORITY_ORDER_BY in lib/db.ts.
function revenuePriority(c: Company): number {
  const r = c.revenue
  if (r != null && r < 15000) return 1   // under 15 MNOK — real shop, real pain
  if (r != null && r <= 25000) return 2  // 15–25 MNOK — lower priority
  if (r == null) return 3                // unknown revenue
  return 4                               // over 25 MNOK — too big, skip
}

function sortQueueByCallback(q: Company[]): Company[] {
  const score = (c: Company): number => {
    const notCalled = c.reach_out_response === 'Not called' || !c.reach_out_response
    const matches = callbackMatchesNow(c)
    if (notCalled && matches) return 0
    if (notCalled) return 1
    if (matches) return 2
    return 3
  }
  return [...q].sort((a, b) => {
    const sd = score(a) - score(b)
    if (sd !== 0) return sd
    const pd = revenuePriority(a) - revenuePriority(b)
    if (pd !== 0) return pd
    return (b.revenue ?? 0) - (a.revenue ?? 0)
  })
}

function nextRescheduleDate(googleReviews: number | null, callCount: number): string {
  const highValue = (googleReviews ?? 0) >= 500
  const calls = Math.max(callCount, 1)
  let days: number
  if (highValue) {
    days = calls <= 1 ? 7 : calls <= 2 ? 10 : 14
  } else {
    days = calls <= 2 ? 14 : 21
  }
  const d = new Date()
  d.setDate(d.getDate() + days)
  return format(d, 'yyyy-MM-dd')
}

function getResponseButtonStyle(r: string): string {
  if (r === 'Demo booked') return 'border-green-600 bg-green-950/50 text-green-300'
  if (r === 'Not interested' || r === 'Wrong number') return 'border-red-700 bg-red-950/50 text-red-300'
  if (r === 'Call back later') return 'border-yellow-600 bg-yellow-950/50 text-yellow-300'
  if (r === 'No answer') return 'border-orange-600 bg-orange-950/50 text-orange-300'
  return 'border-blue-600 bg-blue-950/50 text-blue-300'
}

export function CallingSession({ initialQueue, dialNumber }: Props) {
  const [queue, setQueue] = useState<Company[]>(() => {
    if (dialNumber) {
      const normalized = dialNumber.replace(/\D/g, '')
      const target = initialQueue.find(c => c.phone_number?.replace(/\D/g, '') === normalized)
      if (target) {
        const rest = initialQueue.filter(c => c.id !== target.id)
        return [target, ...sortQueueByCallback(rest)]
      }
    }
    return sortQueueByCallback(initialQueue)
  })
  const [index, setIndex] = useState(0)
  const calledIdsRef = useRef<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)
  const [sessionCaller, setSessionCallerState] = useState('')

  useEffect(() => {
    const saved = localStorage.getItem('sessionCaller')
    if (saved) setSessionCallerState(saved)
  }, [])

  function setSessionCaller(name: string) {
    setSessionCallerState(name)
    if (name) localStorage.setItem('sessionCaller', name)
    else localStorage.removeItem('sessionCaller')
  }

  // Register own session whenever caller or current company changes
  const sessionCallerRef = useRef(sessionCaller)
  useEffect(() => { sessionCallerRef.current = sessionCaller }, [sessionCaller])

  useEffect(() => {
    const current = queue[index]
    if (!sessionCaller || !current) return
    fetch('/api/session', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ caller_name: sessionCaller, company_id: current.id, company_name: current.company_name }),
    }).catch(() => {})
  }, [sessionCaller, queue, index])

  // Clean up session on unmount
  useEffect(() => {
    return () => {
      const caller = sessionCallerRef.current
      if (caller) {
        fetch('/api/session', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ caller_name: caller }),
        }).catch(() => {})
      }
    }
  }, [])

  // Poll for other callers' sessions every 12 seconds
  useEffect(() => {
    if (!sessionCaller) return
    const poll = async () => {
      try {
        const res = await fetch('/api/session')
        if (!res.ok) return
        const sessions: CallerSession[] = await res.json()
        const others = sessions.filter(s => s.caller_name !== sessionCaller)
        setOtherSessions(others)
        const locked = new Set(others.map(s => s.company_id).filter(Boolean) as string[])
        claimedByOthers.current = locked
      } catch { /* network glitch — keep last state */ }
    }
    poll()
    const id = setInterval(poll, 12000)
    return () => clearInterval(id)
  }, [sessionCaller])

  // Editable fields
  const [response, setResponse] = useState('')
  const [notes, setNotes] = useState('')
  const [ownersName, setOwnersName] = useState('')
  const [phoneNumber, setPhoneNumber] = useState('')
  const [emailField, setEmailField] = useState('')
  const [callbackDay, setCallbackDay] = useState('')
  const [callbackTime, setCallbackTime] = useState('')
  const [callbackDate, setCallbackDate] = useState('')
  const [showCallback, setShowCallback] = useState(false)
  const [state, setState] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [originalNotes, setOriginalNotes] = useState('')
  const [noteHistory, setNoteHistory] = useState<CompanyNote[]>([])
  const [showHistory, setShowHistory] = useState(false)
  const [loadingHistory, setLoadingHistory] = useState(false)

  // Presence — who else is live and which company they're viewing
  interface CallerSession { caller_name: string; company_id: string | null; company_name: string | null }
  const [otherSessions, setOtherSessions] = useState<CallerSession[]>([])
  const claimedByOthers = useRef<Set<string>>(new Set())

  // Recording
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const recordingStartRef = useRef<number>(0)
  const [isRecording, setIsRecording] = useState(false)
  const [recordingUploading, setRecordingUploading] = useState(false)
  const [lastRecordingId, setLastRecordingId] = useState<string | null>(null)

  const company = queue[index]

  const loadCompany = useCallback((c: Company) => {
    setResponse(c.reach_out_response ?? '')
    setNotes(c.notes ?? '')
    setOriginalNotes(c.notes ?? '')
    setOwnersName(c.owners_name ?? '')
    setPhoneNumber(c.phone_number ?? '')
    setEmailField(c.email ?? '')
    setCallbackDay(c.callback_day ?? '')
    setCallbackTime(c.callback_time ?? '')
    setCallbackDate(c.next_reach_out ?? '')
    setShowCallback(!!(c.callback_day || c.callback_time || c.next_reach_out))
    setState(c.state ?? '')
    setCompanyName(c.company_name ?? '')
    setNoteHistory([])
    setShowHistory(false)
    setLoadingHistory(true)
    fetch(`/api/companies/${c.id}/notes`)
      .then(r => r.json())
      .then((data: CompanyNote[]) => setNoteHistory(Array.isArray(data) ? data : []))
      .catch(() => {})
      .finally(() => setLoadingHistory(false))
  }, [])

  useState(() => { if (queue[0]) loadCompany(queue[0]) })

  function findNextUncalled(from: number, q: Company[]): number {
    let i = from
    while (i < q.length && (calledIdsRef.current.has(q[i].id) || claimedByOthers.current.has(q[i].id))) i++
    return i < q.length ? i : -1
  }

  async function startRecording() {
    if (!navigator.mediaDevices?.getUserMedia) {
      toast.error('Recording not supported on this browser')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      // Pick the best supported format — Safari needs mp4, Chrome/Firefox use webm
      const mimeType = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/mp4',
        'audio/ogg;codecs=opus',
      ].find(t => MediaRecorder.isTypeSupported(t)) ?? ''
      const mr = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      chunksRef.current = []
      mr.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      mr.start(1000)
      mediaRecorderRef.current = mr
      recordingStartRef.current = Date.now()
      setIsRecording(true)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error(msg.includes('Permission') || msg.includes('denied') ? 'Microphone access denied' : `Recording error: ${msg}`)
    }
  }

  async function stopRecording() {
    const mr = mediaRecorderRef.current
    if (!mr) return
    setIsRecording(false)
    setRecordingUploading(true)
    // Stop recorder first, then tracks — ensures all chunks are flushed before onstop fires
    await new Promise<void>(resolve => {
      mr.onstop = () => {
        mr.stream.getTracks().forEach(t => t.stop())
        resolve()
      }
      mr.stop()
    })
    const durationSeconds = Math.round((Date.now() - recordingStartRef.current) / 1000)
    const mimeType = mr.mimeType || 'audio/webm'
    const ext = mimeType.includes('mp4') ? 'mp4' : mimeType.includes('ogg') ? 'ogg' : 'webm'
    const blob = new Blob(chunksRef.current, { type: mimeType })
    chunksRef.current = []
    mediaRecorderRef.current = null
    if (blob.size === 0) {
      toast.error('Recording was empty — try again')
      setRecordingUploading(false)
      return
    }
    try {
      const form = new FormData()
      form.append('audio', blob, `recording.${ext}`)
      form.append('mime_type', mimeType)
      form.append('duration_seconds', String(durationSeconds))
      if (company) {
        form.append('company_id', company.id)
        form.append('company_name', company.company_name)
      }
      if (sessionCaller) form.append('caller_name', sessionCaller)
      const res = await fetch('/api/recordings', { method: 'POST', body: form })
      if (!res.ok) throw new Error('Upload failed')
      const { id } = await res.json()
      setLastRecordingId(id)
      toast.success('Recording saved')
    } catch {
      toast.error('Failed to save recording')
    } finally {
      setRecordingUploading(false)
    }
  }

  async function handleNext(skip = false) {
    if (!company) return
    setSaving(true)
    try {
      const payload: Partial<Company> = {
        company_name: companyName || company.company_name,
        notes: notes || null,
        owners_name: ownersName || null,
        phone_number: phoneNumber || null,
        email: emailField || null,
        callback_day: callbackDay || null,
        callback_time: callbackTime || null,
        state: state || null,
      }
      if (!skip && response) {
        payload.reach_out_response = response
        payload.who_called = sessionCaller || null
        payload.last_reach_out = todayStr()
        const newCallCount = (company.amount_of_calls ?? 0) + 1
        payload.next_reach_out = callbackDate || nextRescheduleDate(company.google_reviews, newCallCount)
        payload.amount_of_calls = newCallCount
        if (sessionCaller === 'Leonard') payload.calls_leonard = (company.calls_leonard ?? 0) + 1
        if (sessionCaller === 'William') payload.calls_william = (company.calls_william ?? 0) + 1
      }
      const updated = await patchCompany(company.id, payload)

      if (!skip && notes.trim() && notes.trim() !== originalNotes.trim()) {
        fetch(`/api/companies/${company.id}/notes`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ note: notes.trim(), caller_name: sessionCaller || null }),
        }).catch(() => {})
      }

      if (!skip) {
        calledIdsRef.current.add(updated.id)
        const filtered = queue.filter(c => !calledIdsRef.current.has(c.id))
        setQueue(filtered)
        const next = findNextUncalled(0, filtered)
        if (next === -1) { toast.success('Saved'); setSaving(false); setDone(true); return }
        toast.success('Saved')
        setSaving(false)
        setIndex(next)
        setLastRecordingId(null)
        loadCompany(filtered[next])
        return
      }

      setQueue(q => q.map(c => c.id === updated.id ? updated : c))
      toast.success('Skipped')
    } catch {
      toast.error('Failed to save')
    } finally {
      setSaving(false)
    }
    const next = findNextUncalled(index + 1, queue)
    if (next === -1) setDone(true)
    else { setIndex(next); loadCompany(queue[next]) }
  }

  function handleBack() {
    if (index === 0) return
    let p = index - 1
    while (p >= 0 && calledIdsRef.current.has(queue[p].id)) p--
    if (p < 0) return
    setIndex(p)
    loadCompany(queue[p])
  }

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
            {queue.length === 0 ? 'No companies in the queue.' : `You've gone through all ${queue.length} companies.`}
          </p>
        </div>
        <div className="flex gap-3">
          <a href="/pipeline" className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-lg text-sm transition-colors">Back to Companies</a>
          <button onClick={() => { setIndex(0); setDone(false); if (queue[0]) loadCompany(queue[0]) }}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm transition-colors">Start over</button>
        </div>
      </div>
    )
  }

  const progress = (index / queue.length) * 100
  const nextIdx = findNextUncalled(index + 1, queue)
  const nextCompany = nextIdx !== -1 ? queue[nextIdx] : null

  return (
    <div className="flex-1 overflow-y-auto flex flex-col items-center justify-start py-4 sm:py-8 px-3 sm:px-4 pb-safe">
      <div className="w-full max-w-2xl space-y-3 sm:space-y-4">

        {/* Caller picker */}
        {!sessionCaller ? (
          <div className="bg-blue-950/30 border border-blue-800/50 rounded-xl p-4 flex items-center gap-3">
            <svg className="w-4 h-4 text-blue-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
            <span className="text-sm text-blue-300">Who is calling today?</span>
            <select value={sessionCaller} onChange={e => setSessionCaller(e.target.value)}
              className="ml-auto bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500">
              <option value="">Select caller…</option>
              {TEAM_MEMBERS.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <span className="text-sm text-gray-500">
              Logging as <span className="text-gray-300 font-medium">{sessionCaller}</span>
              <button onClick={() => setSessionCaller('')} className="ml-2 text-gray-600 hover:text-gray-400 text-xs underline">change</button>
            </span>
            <div className="flex items-center gap-3">
              {otherSessions.map(s => (
                <span key={s.caller_name} className="flex items-center gap-1.5 text-xs text-emerald-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  {s.caller_name}{s.company_name ? ` → ${s.company_name}` : ' online'}
                </span>
              ))}
              <span className="text-sm text-gray-500">{index + 1} / {queue.length}</span>
            </div>
          </div>
        )}

        {/* Progress bar */}
        <div className="w-full bg-gray-800 rounded-full h-1.5 overflow-hidden">
          <div className="h-1.5 bg-blue-500 rounded-full transition-all duration-300" style={{ width: `${progress}%` }} />
        </div>

        {/* Company card */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">

          {/* Name */}
          <div className="px-4 sm:px-6 pt-4 sm:pt-6 pb-3 sm:pb-4 border-b border-gray-800">
            <label className="text-xs text-gray-500 uppercase tracking-wide font-medium">Company</label>
            <input value={companyName} onChange={e => setCompanyName(e.target.value)}
              className="mt-1 w-full bg-transparent text-xl sm:text-2xl font-bold text-white focus:outline-none border-b border-transparent focus:border-gray-600 pb-1 transition-colors"
              placeholder="Company name" />
            {company && callbackMatchesNow(company) && (
              <div className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-yellow-900/50 border border-yellow-700/60 text-yellow-300 text-xs font-medium">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Callback window{company.callback_day ? ` · ${company.callback_day}` : ''}{company.callback_time ? ` ${company.callback_time.slice(0,5)}` : ''}
              </div>
            )}
          </div>

          <div className="px-4 sm:px-6 py-4 sm:py-5 grid grid-cols-2 gap-3 sm:gap-5">

            {/* Phone — full width, tap to call */}
            <div className="col-span-2">
              <Field label="Phone Number">
                <div className="flex items-center gap-2 flex-wrap">
                  {phoneNumber ? (
                    <a href={`tel:${phoneNumber}`}
                      className="text-blue-400 hover:text-blue-300 text-lg font-semibold transition-colors flex-1 truncate">
                      {phoneNumber}
                    </a>
                  ) : (
                    <span className="text-gray-600 text-base flex-1">—</span>
                  )}
                </div>
                <input value={phoneNumber} onChange={e => setPhoneNumber(e.target.value)}
                  placeholder="Edit phone…"
                  className="mt-2 w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500" />

                {/* Record button */}
                <div className="mt-3 flex items-center gap-2">
                  {isRecording ? (
                    <button
                      onClick={stopRecording}
                      className="flex items-center gap-2 px-3 py-2 bg-red-900/40 border border-red-700 hover:bg-red-900/60 text-red-300 text-sm rounded-lg transition-colors"
                    >
                      <span className="w-2 h-2 rounded-full bg-red-400 animate-pulse" />
                      Stop recording
                    </button>
                  ) : recordingUploading ? (
                    <span className="text-xs text-gray-500 flex items-center gap-1.5">
                      <span className="w-3 h-3 border border-gray-500 border-t-gray-300 rounded-full animate-spin" />
                      Saving recording…
                    </span>
                  ) : lastRecordingId ? (
                    <a
                      href="/recordings"
                      className="flex items-center gap-1.5 text-xs text-green-400 hover:text-green-300 transition-colors"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      Recording saved · View
                    </a>
                  ) : (
                    <button
                      onClick={startRecording}
                      className="flex items-center gap-2 px-3 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 text-sm rounded-lg transition-colors"
                    >
                      <svg className="w-3.5 h-3.5 text-red-400" fill="currentColor" viewBox="0 0 24 24">
                        <circle cx="12" cy="12" r="6" />
                      </svg>
                      Record call
                    </button>
                  )}
                </div>
              </Field>
            </div>

            {/* Region */}
            <Field label="Region">
              <select value={state} onChange={e => setState(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500">
                <option value="">—</option>
                {REGIONS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>

            {/* Owner */}
            <Field label="Owner's Name">
              <input value={ownersName} onChange={e => setOwnersName(e.target.value)}
                placeholder="Unknown"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500" />
            </Field>

            {/* Email */}
            <Field label="Email">
              <input value={emailField} onChange={e => setEmailField(e.target.value)}
                placeholder="—" type="email"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500" />
            </Field>

            {/* Times called */}
            <Field label="Times Called">
              <span className={`font-semibold text-lg ${(company?.amount_of_calls ?? 0) > 0 ? 'text-yellow-400' : 'text-gray-500'}`}>
                {company?.amount_of_calls ?? 0}
              </span>
            </Field>
          </div>

          {/* Notes */}
          <div className="px-4 sm:px-6 pb-4 sm:pb-5 space-y-2">
            <Field label="Notes">
              <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
                placeholder="Add notes…"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 resize-none" />
            </Field>

            {(noteHistory.length > 0 || loadingHistory) && (
              <button
                onClick={() => setShowHistory(h => !h)}
                className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-300 transition-colors"
              >
                <svg className={`w-3 h-3 transition-transform ${showHistory ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
                {loadingHistory ? 'Loading history…' : `${noteHistory.length} previous note${noteHistory.length !== 1 ? 's' : ''}`}
              </button>
            )}

            {showHistory && noteHistory.length > 0 && (
              <div className="space-y-2 border-l-2 border-gray-700 pl-3">
                {noteHistory.map(n => (
                  <div key={n.id} className="space-y-0.5">
                    <div className="flex items-center gap-2 text-xs text-gray-500">
                      <span className="font-medium text-gray-400">{n.caller_name ?? 'Unknown'}</span>
                      <span>·</span>
                      <span>{new Date(n.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                      <span>{new Date(n.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</span>
                    </div>
                    <p className="text-sm text-gray-300 whitespace-pre-wrap leading-relaxed">{n.note}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Callback */}
          <div className="px-4 sm:px-6 pb-4 sm:pb-5">
            {!showCallback ? (
              <button
                onClick={() => setShowCallback(true)}
                className="flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed border-gray-600 text-sm text-gray-400 hover:border-yellow-500 hover:text-yellow-400 transition-colors touch-manipulation w-full"
              >
                <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Set callback date/time
              </button>
            ) : (
              <div className="space-y-3">
                <Field label="Callback Date">
                  <input type="date" value={callbackDate} onChange={e => setCallbackDate(e.target.value)}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-yellow-500 [color-scheme:dark]" />
                </Field>
                <Field label="Preferred Day & Time">
                  <div className="flex gap-2 flex-wrap">
                    <select value={callbackDay} onChange={e => setCallbackDay(e.target.value)}
                      className="flex-1 min-w-[120px] bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-yellow-500">
                      <option value="">Any day</option>
                      {['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'].map(d => (
                        <option key={d} value={d}>{d}</option>
                      ))}
                    </select>
                    <input type="time" value={callbackTime} onChange={e => setCallbackTime(e.target.value)}
                      className="flex-1 min-w-[120px] bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-yellow-500 [color-scheme:dark]" />
                    <button onClick={() => { setCallbackDay(''); setCallbackTime(''); setCallbackDate(''); setShowCallback(false) }}
                      className="px-2 text-gray-600 hover:text-gray-400 transition-colors" title="Clear">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                </Field>
              </div>
            )}
          </div>

          {/* Outcome + actions */}
          <div className="px-4 sm:px-6 pb-4 sm:pb-6 border-t border-gray-800 pt-4 sm:pt-5 space-y-3 sm:space-y-4">
            <Field label="Call Outcome">
              <div className="grid grid-cols-2 gap-2 mt-1">
                {RESPONSE_STATUSES.map(r => (
                  <button key={r} onClick={() => setResponse(r)}
                    className={`text-left px-3 py-2.5 rounded-lg border text-sm transition-colors touch-manipulation ${
                      response === r ? getResponseButtonStyle(r) : 'border-gray-700 bg-gray-800 text-gray-400 hover:border-gray-600 hover:text-gray-300'
                    }`}>{r}</button>
                ))}
              </div>
            </Field>

            <div className="flex items-center gap-2 pt-1">
              <button onClick={handleBack} disabled={index === 0 || saving}
                className="px-3 sm:px-4 py-3 rounded-xl border border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed text-sm font-medium transition-colors touch-manipulation">
                ←
              </button>
              <button onClick={() => handleNext(true)} disabled={saving}
                className="px-3 sm:px-4 py-3 rounded-xl border border-gray-700 bg-gray-800 text-gray-400 hover:bg-gray-700 disabled:opacity-50 text-sm font-medium transition-colors touch-manipulation">
                Skip
              </button>
              <button onClick={() => handleNext(false)} disabled={saving || !response}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 active:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold text-sm transition-colors touch-manipulation">
                {saving ? (
                  <><svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                  </svg>Saving…</>
                ) : <>Log & Next →</>}
              </button>
            </div>
            {!response && <p className="text-xs text-gray-600 text-center">Select a call outcome to log</p>}
          </div>
        </div>

        {/* Up next */}
        {nextCompany && (
          <div className="text-center">
            <p className="text-xs text-gray-600">
              Up next: <span className="text-gray-400">{nextCompany.company_name}</span>
              {nextCompany.state && <span className="text-gray-600"> · {nextCompany.state}</span>}
            </p>
          </div>
        )}
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
