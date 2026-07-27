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

// Telnyx click-to-call: when true, the hero Call button dials via Telnyx
// (rings the caller's phone first, auto-recorded) from the number RESERVED
// for this caller — instead of a bare tel: link.
//
// DISABLED 2026-07-27: a live test hit SIP 603 (carrier decline) on every
// outbound call — Norwegian operators reject calls bearing a Norwegian
// caller ID that arrive over Telnyx's international route (a documented,
// deliberate anti-spoofing policy, not a bug in this code). The hero button
// reverts to tel: until that's resolved with Telnyx (local termination) or
// a Nordic carrier is wired in. The manual "Telnyx-oppringing" panel at the
// top of the page still exists for testing a fix — this flag only gates
// the automatic hero button. Flip back to true once outbound Norwegian
// calls actually complete.
const TELNYX_HERO_BUTTON_ENABLED = false

async function patchCompanyOnce(id: string, payload: Partial<Company>): Promise<Company> {
  const res = await fetch(`/api/companies/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error('Failed to save')
  return res.json()
}

// Call records are the product — retry once on transient failures
// (flaky network, cold serverless function) before giving up.
async function patchCompany(id: string, payload: Partial<Company>): Promise<Company> {
  try {
    return await patchCompanyOnce(id, payload)
  } catch {
    await new Promise(r => setTimeout(r, 1000))
    return patchCompanyOnce(id, payload)
  }
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
  if (r != null && r >= 10000 && r <= 20000) return 1  // 10–20 MNOK — sweet spot, call first
  if (r != null && r < 10000) return 2                 // under 10 MNOK — real shop, real pain
  if (r != null && r <= 25000) return 3                // 20–25 MNOK — lower priority
  if (r == null) return 4                              // unknown revenue
  return 5                                             // over 25 MNOK — too big, skip
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

// Revenue is stored in thousands NOK (driftsinntekter). Under 15 MNOK is the
// ideal customer profile this tool exists to find — surface that while dialing.
function fmtRevenue(revenue: number | null): string | null {
  if (revenue == null) return null
  return `${(revenue / 1000).toFixed(1).replace('.', ',')} MNOK`
}

function fitBadge(revenue: number | null): { label: string; hot: boolean } {
  if (revenue == null) return { label: 'Revenue unknown', hot: false }
  if (revenue < 15000) return { label: 'ICP fit', hot: true }
  if (revenue <= 25000) return { label: 'Large', hot: false }
  return { label: 'Too big', hot: false }
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

  // Refs tracking the live queue/index so the polling heartbeat can read the
  // current company without re-subscribing the interval on every advance.
  const queueRef = useRef(queue)
  const indexRef = useRef(index)
  useEffect(() => { queueRef.current = queue }, [queue])
  useEffect(() => { indexRef.current = index }, [index])

  const sessionCallerRef = useRef(sessionCaller)
  useEffect(() => { sessionCallerRef.current = sessionCaller }, [sessionCaller])

  // Release our session on unmount / tab close so we don't block the other caller
  useEffect(() => {
    const release = () => {
      const caller = sessionCallerRef.current
      if (!caller) return
      fetch('/api/session', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caller_name: caller }),
        keepalive: true,
      }).catch(() => {})
    }
    window.addEventListener('beforeunload', release)
    return () => { window.removeEventListener('beforeunload', release); release() }
  }, [])

  // Every 12s: heartbeat our current claim (so it never expires mid-call) and
  // refresh the list of who else is online + which companies they hold.
  useEffect(() => {
    if (!sessionCaller) return
    const tick = async () => {
      const current = queueRef.current[indexRef.current]
      if (current) {
        fetch('/api/session', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ caller_name: sessionCaller, company_id: current.id, company_name: current.company_name }),
        }).catch(() => {})
      }
      try {
        const res = await fetch('/api/session')
        if (!res.ok) return
        const sessions: CallerSession[] = await res.json()
        const others = sessions.filter(s => s.caller_name !== sessionCaller)
        setOtherSessions(others)
        claimedByOthers.current = new Set(others.map(s => s.company_id).filter(Boolean) as string[])
      } catch { /* network glitch — keep last state */ }
    }
    tick()
    const id = setInterval(tick, 12000)
    return () => clearInterval(id)
  }, [sessionCaller])

  const [telnyxFrom, setTelnyxFrom] = useState<string | null>(null)
  const [telnyxPool, setTelnyxPool] = useState(0)
  const [telnyxCalling, setTelnyxCalling] = useState(false)
  const [telnyxStatus, setTelnyxStatus] = useState<string | null>(null)
  useEffect(() => {
    if (!sessionCaller || !TELNYX_HERO_BUTTON_ENABLED) {
      setTelnyxFrom(null)
      return
    }
    let cancelled = false
    fetch(`/api/telnyx/numbers?caller=${encodeURIComponent(sessionCaller)}`, { cache: 'no-store' })
      .then(r => r.json())
      .then(d => {
        if (!cancelled) {
          setTelnyxFrom(d?.mine?.phoneNumber ?? null)
          setTelnyxPool(d?.poolSize ?? 0)
        }
      })
      .catch(() => {
        if (!cancelled) setTelnyxFrom(null)
      })
    return () => {
      cancelled = true
    }
  }, [sessionCaller])

  async function telnyxCall() {
    if (!phoneNumber || telnyxCalling) return
    setTelnyxCalling(true)
    setTelnyxStatus(null)
    try {
      const res = await fetch('/api/telnyx/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: phoneNumber, caller: sessionCaller }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? 'Oppringing feilet')
      setTelnyxStatus(`Ringer telefonen din fra ${body.from} - svar, så kobles leadet på. Samtalen tas opp.`)
      // Telnyx ACCEPTING the request is not the phone ringing: carrier
      // rejections land seconds later. Poll for the real outcome and
      // replace the optimistic line if it failed.
      if (body.sid) void pollCallOutcome(body.sid)
    } catch (e) {
      setTelnyxStatus(e instanceof Error ? e.message : 'Noe gikk galt')
    } finally {
      setTelnyxCalling(false)
    }
  }

  async function pollCallOutcome(sid: string) {
    for (let i = 0; i < 6; i++) {
      await new Promise(r => setTimeout(r, 2500))
      try {
        const d = await (await fetch(`/api/telnyx/call-status?sid=${encodeURIComponent(sid)}`, { cache: 'no-store' })).json()
        if (d?.problem) {
          setTelnyxStatus(`⚠ ${d.problem}`)
          return
        }
        if (d?.status === 'in-progress' || d?.status === 'completed') return
      } catch {
        return
      }
    }
  }

  // Editable fields
  const [response, setResponse] = useState('')
  const [reachedDM, setReachedDM] = useState(false)
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

  // Recording — the whole session lives in one ref so overlapping start/stop
  // (auto-record + outcome-click + advance) can never mix chunks between two
  // recordings, which previously dropped the WebM header and corrupted files.
  const recordingRef = useRef<{ recorder: MediaRecorder; chunks: Blob[]; startedAt: number } | null>(null)
  const [isRecording, setIsRecording] = useState(false)
  const [recordingUploading, setRecordingUploading] = useState(false)
  const [lastRecordingId, setLastRecordingId] = useState<string | null>(null)
  const [autoRecord, setAutoRecordState] = useState(false)

  useEffect(() => {
    setAutoRecordState(localStorage.getItem('autoRecord') === '1')
  }, [])

  function setAutoRecord(on: boolean) {
    setAutoRecordState(on)
    localStorage.setItem('autoRecord', on ? '1' : '0')
  }

  // Script side panel — the pitch you keep open while calling. Persisted in
  // localStorage and snapshotted onto every logged call so you can later see
  // which script wording produced which outcomes.
  const [script, setScript] = useState('')
  const [showScript, setShowScript] = useState(false)
  const scriptRef = useRef('')
  useEffect(() => {
    const saved = localStorage.getItem('callScript')
    if (saved) { setScript(saved); scriptRef.current = saved }
  }, [])
  function updateScript(text: string) {
    setScript(text)
    scriptRef.current = text
    localStorage.setItem('callScript', text)
  }

  const company = queue[index]

  // Auto-record: when enabled, start a recording each time we land on a new
  // company (stops + saves when an outcome is chosen, or on advance). Only fires
  // on company change / toggle-on; never restarts on the same company.
  useEffect(() => {
    if (!autoRecord || !sessionCaller || !company) return
    if (recordingRef.current) return // already recording
    startRecording()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRecord, sessionCaller, company?.id])

  const loadCompany = useCallback((c: Company) => {
    setResponse(c.reach_out_response ?? '')
    setReachedDM(!!c.reached_decision_maker)
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

  // Server-authoritative "give me my next free lead".
  //
  // We hand the server our ordered, not-yet-called candidate ids and it
  // atomically claims (and returns) the FIRST one no other caller holds — the
  // whole pick-and-lock loop happens in one request, so two callers can never
  // be handed the same company. Returns the index of the claimed company in `q`,
  // or -1 if the queue is exhausted.
  const firstUncalled = useCallback((q: Company[], from: number): number => {
    for (let i = from; i < q.length; i++) if (!calledIdsRef.current.has(q[i].id)) return i
    return -1
  }, [])

  const claimForward = useCallback(async (q: Company[], fromIndex: number): Promise<number> => {
    const caller = sessionCallerRef.current
    // No caller selected yet — just take the next uncalled locally.
    if (!caller) return firstUncalled(q, fromIndex)

    // Build the ordered candidate window (next 100 uncalled companies).
    const candidate_ids: string[] = []
    for (let i = fromIndex; i < q.length && candidate_ids.length < 100; i++) {
      if (!calledIdsRef.current.has(q[i].id)) candidate_ids.push(q[i].id)
    }
    if (candidate_ids.length === 0) return -1

    try {
      const res = await fetch('/api/session/claim-next', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caller_name: caller, candidate_ids }),
      })
      if (!res.ok) throw new Error('claim-next failed')
      const { company_id } = await res.json()
      if (!company_id) return -1 // everything in the window is taken
      const idx = q.findIndex(c => c.id === company_id)
      // Mark anything ahead of the winner as held by others (for "up next").
      for (const id of candidate_ids) {
        if (id === company_id) break
        claimedByOthers.current.add(id)
      }
      return idx !== -1 ? idx : firstUncalled(q, fromIndex)
    } catch {
      // Overlap service unreachable: don't silently double-call — warn and fall
      // back to the next uncalled lead so calling still works.
      toast.error('Overlap check unavailable — coordinate manually')
      return firstUncalled(q, fromIndex)
    }
  }, [firstUncalled])

  // When a caller is selected, make sure the company on screen is actually ours.
  // If the other caller already holds it (e.g. both opened on the same top lead),
  // jump forward to the first free one.
  useEffect(() => {
    if (!sessionCaller) return
    let cancelled = false
    ;(async () => {
      const i = await claimForward(queueRef.current, indexRef.current)
      if (cancelled) return
      if (i === -1) { setDone(true); return }
      if (i !== indexRef.current) { setIndex(i); loadCompany(queueRef.current[i]) }
    })()
    return () => { cancelled = true }
  }, [sessionCaller, claimForward, loadCompany])

  function findNextUncalled(from: number, q: Company[]): number {
    let i = from
    while (i < q.length && (calledIdsRef.current.has(q[i].id) || claimedByOthers.current.has(q[i].id))) i++
    return i < q.length ? i : -1
  }

  async function startRecording() {
    if (recordingRef.current) return // already recording — never run two at once
    if (!navigator.mediaDevices?.getUserMedia) {
      toast.error('Recording not supported on this browser')
      return
    }
    try {
      // Mono mic with echo cancellation — fine for voice and keeps files small.
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      })
      // Pick the best supported format — Safari needs mp4, Chrome/Firefox use webm
      const mimeType = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/mp4',
        'audio/ogg;codecs=opus',
      ].find(t => MediaRecorder.isTypeSupported(t)) ?? ''
      // 24 kbps mono is clearly intelligible for voice and stays well under the
      // upload size limit (~0.18 MB/min → a 20-min call is ~3.5 MB).
      const mr = new MediaRecorder(stream, {
        ...(mimeType ? { mimeType } : {}),
        audioBitsPerSecond: 24000,
      })
      const chunks: Blob[] = []
      mr.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data) }
      // No timeslice: one dataavailable at stop() with the complete, valid file.
      mr.start()
      recordingRef.current = { recorder: mr, chunks, startedAt: Date.now() }
      setIsRecording(true)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error(msg.includes('Permission') || msg.includes('denied') ? 'Microphone access denied' : `Recording error: ${msg}`)
    }
  }

  async function stopRecording() {
    const session = recordingRef.current
    if (!session) return
    recordingRef.current = null // claim it immediately so a double-stop is a no-op
    const { recorder: mr, chunks, startedAt } = session
    setIsRecording(false)
    setRecordingUploading(true)
    // Stop recorder first, then tracks — ensures the final chunk is flushed before onstop.
    await new Promise<void>(resolve => {
      mr.onstop = () => {
        mr.stream.getTracks().forEach(t => t.stop())
        resolve()
      }
      mr.stop()
    })
    const durationSeconds = Math.round((Date.now() - startedAt) / 1000)
    const mimeType = mr.mimeType || 'audio/webm'
    const ext = mimeType.includes('mp4') ? 'mp4' : mimeType.includes('ogg') ? 'ogg' : 'webm'
    const blob = new Blob(chunks, { type: mimeType })
    if (blob.size === 0) {
      toast.error('Recording was empty — try again')
      setRecordingUploading(false)
      return
    }
    // Hard platform limit on the upload body is ~4.5 MB; refuse cleanly above 4 MB
    // rather than failing mid-upload (≈22 min at 24 kbps).
    if (blob.size > 4 * 1024 * 1024) {
      toast.error(`Recording too long to save (${(blob.size / 1024 / 1024).toFixed(1)} MB). Keep calls under ~20 min.`)
      setRecordingUploading(false)
      return
    }
    const upload = async () => {
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
      if (!res.ok) {
        const detail = await res.text().catch(() => '')
        throw new Error(`HTTP ${res.status}${detail ? ` — ${detail.slice(0, 120)}` : ''}`)
      }
      return res.json() as Promise<{ id: string }>
    }
    try {
      // The audio only exists in this blob — retry once before giving up
      let result: { id: string }
      try {
        result = await upload()
      } catch {
        await new Promise(r => setTimeout(r, 1500))
        result = await upload()
      }
      setLastRecordingId(result.id)
      toast.success('Recording saved')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown error'
      toast.error(`Failed to save recording: ${msg}`)
    } finally {
      setRecordingUploading(false)
    }
  }

  async function handleNext(skip = false) {
    if (!company) return
    // Safety net for auto-record: if a recording is still running (e.g. Skip
    // without choosing an outcome), stop + save it before leaving the company.
    if (recordingRef.current) await stopRecording()
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
        payload.reached_decision_maker = reachedDM
        const newCallCount = (company.amount_of_calls ?? 0) + 1
        // "No answer" always comes back in exactly a week; other outcomes use
        // the value-based reschedule (unless a manual callback date is set).
        const autoReschedule = response === 'No answer'
          ? format(new Date(Date.now() + 7 * 86400000), 'yyyy-MM-dd')
          : nextRescheduleDate(company.google_reviews, newCallCount)
        payload.next_reach_out = callbackDate || autoReschedule
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

      // Log this call as an event (independent of the company's latest state)
      // so trend stats — dials-per-demo, DM conversion, time-of-day, callback
      // conversion, revenue-tier performance — can be computed accurately.
      if (!skip && response) {
        fetch('/api/call-events', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            company_id: company.id,
            caller_name: sessionCaller || null,
            response,
            reached_decision_maker: reachedDM,
            revenue_at_call: company.revenue ?? null,
            script: scriptRef.current || null,
          }),
        }).catch(() => {})
      }

      if (!skip) {
        calledIdsRef.current.add(updated.id)
        const filtered = queue.filter(c => !calledIdsRef.current.has(c.id))
        setQueue(filtered)
        const next = await claimForward(filtered, 0)
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
      // Stay on this company — advancing would silently discard the record
      toast.error('Failed to save — still on this company, please try again')
      setSaving(false)
      return
    } finally {
      setSaving(false)
    }
    const next = await claimForward(queue, index + 1)
    if (next === -1) setDone(true)
    else { setIndex(next); loadCompany(queue[next]) }
  }

  // One-click snooze: the lead disappears for the rest of today and pops
  // back up in tomorrow's queue (next_reach_out gates BOTH queue branches).
  // Saves the editable fields too, so notes typed before snoozing survive —
  // but records no outcome and burns no call count: nobody was dialed.
  async function snoozeUntilTomorrow() {
    if (!company || saving) return
    if (recordingRef.current) await stopRecording()
    setSaving(true)
    try {
      const tomorrow = format(new Date(Date.now() + 86400000), 'yyyy-MM-dd')
      await patchCompany(company.id, {
        company_name: companyName || company.company_name,
        notes: notes || null,
        owners_name: ownersName || null,
        phone_number: phoneNumber || null,
        email: emailField || null,
        callback_day: callbackDay || null,
        callback_time: callbackTime || null,
        state: state || null,
        next_reach_out: tomorrow,
      })
      calledIdsRef.current.add(company.id)
      const filtered = queue.filter(c => !calledIdsRef.current.has(c.id))
      setQueue(filtered)
      toast.success('Moved to tomorrow')
      const next = await claimForward(filtered, 0)
      setSaving(false)
      if (next === -1) { setDone(true); return }
      setIndex(next)
      setLastRecordingId(null)
      loadCompany(filtered[next])
    } catch {
      toast.error('Failed to move — still on this company')
      setSaving(false)
    }
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
        <div className="w-16 h-16 rounded-full bg-white flex items-center justify-center">
          <svg className="w-8 h-8 text-black" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
            className="px-4 py-2 bg-white hover:bg-gray-200 text-black rounded-lg text-sm transition-colors">Start over</button>
        </div>
      </div>
    )
  }

  const progress = (index / queue.length) * 100
  const nextIdx = findNextUncalled(index + 1, queue)
  const nextCompany = nextIdx !== -1 ? queue[nextIdx] : null

  return (
    <div className="flex-1 overflow-y-auto flex flex-col items-center justify-start py-4 sm:py-8 px-3 sm:px-4 pb-safe">

      {/* Script toggle button — fixed to the right edge */}
      {!showScript && (
        <button
          onClick={() => setShowScript(true)}
          className="fixed right-0 top-24 z-30 flex items-center gap-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 border-r-0 text-gray-300 text-xs font-medium px-3 py-2 rounded-l-lg shadow-lg transition-colors"
          title="Open your call script"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          Script
        </button>
      )}

      {/* Script side panel */}
      {showScript && (
        <div className="fixed right-0 top-12 bottom-0 z-30 w-full sm:w-96 bg-gray-900 border-l border-gray-800 shadow-2xl flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 shrink-0">
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <span className="text-sm font-semibold text-white">Call Script</span>
            </div>
            <button onClick={() => setShowScript(false)} className="text-gray-500 hover:text-gray-300 text-sm">Close ✕</button>
          </div>
          <textarea
            value={script}
            onChange={e => updateScript(e.target.value)}
            placeholder="Write your pitch here… It stays open while you call and is saved with every logged call so you can see which script wording books demos."
            className="flex-1 w-full bg-transparent text-sm text-gray-200 placeholder-gray-600 px-4 py-3 resize-none focus:outline-none leading-relaxed"
          />
          <p className="text-[10px] text-gray-600 px-4 py-2 border-t border-gray-800 shrink-0">
            Auto-saved · snapshotted onto each call you log
          </p>
        </div>
      )}

      <div className="w-full max-w-2xl space-y-3 sm:space-y-4">

        {/* Session status row — console style */}
        {!sessionCaller ? (
          <div className="border border-gray-700 rounded-xl p-4 flex items-center gap-3 bg-gray-900">
            <span className="w-2 h-2 rounded-full bg-white animate-pulse shrink-0" />
            <span className="text-sm text-gray-200 font-medium">Who is calling today?</span>
            <select value={sessionCaller} onChange={e => setSessionCaller(e.target.value)}
              className="ml-auto bg-black border border-gray-600 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-white">
              <option value="">Select caller…</option>
              {TEAM_MEMBERS.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3 flex-wrap font-mono text-[11px] uppercase tracking-wider">
            <span className="text-gray-500">
              Caller <span className="text-white font-semibold normal-case text-xs">{sessionCaller}</span>
              <button onClick={() => setSessionCaller('')} className="ml-2 text-gray-600 hover:text-gray-400 lowercase underline decoration-gray-700">change</button>
            </span>
            <div className="flex items-center gap-3">
              {(() => {
                const total = 1 + otherSessions.length
                return (
                  <span className="flex items-center gap-1.5 text-gray-400">
                    <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                    {total} online
                  </span>
                )
              })()}
              {otherSessions.map(s => (
                <span key={s.caller_name} className="hidden sm:inline text-gray-600 normal-case">
                  {s.caller_name}{s.company_name ? ` → ${s.company_name}` : ''}
                </span>
              ))}
              <span className="text-gray-400 tabular-nums">{index + 1} / {queue.length}</span>
            </div>
          </div>
        )}

        {/* Queue progress */}
        <div className="w-full bg-gray-800 rounded-full h-1 overflow-hidden">
          <div className="h-1 bg-white rounded-full transition-all duration-300" style={{ width: `${progress}%` }} />
        </div>

        {/* Company card — dialer console */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">

          {/* Name + qualification strip */}
          <div className="px-4 sm:px-6 pt-4 sm:pt-5 pb-4 border-b border-gray-800">
            <input value={companyName} onChange={e => setCompanyName(e.target.value)}
              className="w-full bg-transparent text-2xl sm:text-3xl font-bold tracking-tight text-white focus:outline-none border-b border-transparent focus:border-gray-600 pb-1 transition-colors"
              placeholder="Company name" />

            {/* Why this lead: revenue fit, region, call history — at a glance */}
            <div className="mt-3 flex items-center gap-2 flex-wrap font-mono text-[11px] uppercase tracking-wider">
              {(() => {
                const fit = fitBadge(company?.revenue ?? null)
                const rev = fmtRevenue(company?.revenue ?? null)
                return (
                  <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded border ${
                    fit.hot ? 'border-white bg-white text-black font-bold' : 'border-gray-700 text-gray-400'
                  }`}>
                    {fit.label}{rev ? ` · ${rev}` : ''}
                  </span>
                )
              })()}
              {company?.state && (
                <span className="inline-flex items-center px-2 py-1 rounded border border-gray-700 text-gray-400">
                  {company.state}
                </span>
              )}
              <span className="inline-flex items-center px-2 py-1 rounded border border-gray-700 text-gray-400 tabular-nums">
                {(company?.amount_of_calls ?? 0) === 0 ? 'Never called' : `Called ${company?.amount_of_calls}×`}
              </span>
              {company && callbackMatchesNow(company) && (
                <span className="inline-flex items-center gap-1 px-2 py-1 rounded border border-white text-white font-bold">
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Callback now{company.callback_day ? ` · ${company.callback_day.slice(0,3)}` : ''}{company.callback_time ? ` ${company.callback_time.slice(0,5)}` : ''}
                </span>
              )}
            </div>
          </div>

          {/* Hero action: CALL */}
          <div className="px-4 sm:px-6 py-4 border-b border-gray-800 space-y-3">
            <div className="flex items-stretch gap-2">
              {phoneNumber && telnyxFrom && TELNYX_HERO_BUTTON_ENABLED ? (
                <button
                  type="button"
                  onClick={telnyxCall}
                  disabled={telnyxCalling}
                  className="flex-1 flex items-center justify-center gap-3 h-14 rounded-xl bg-white hover:bg-gray-200 active:bg-gray-300 disabled:opacity-60 text-black transition-colors touch-manipulation">
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/>
                  </svg>
                  <span className="text-base font-bold">{telnyxCalling ? 'Ringer…' : 'Call'}</span>
                  <span className="font-mono text-base font-semibold tabular-nums">{phoneNumber}</span>
                  <span className="text-[10px] font-mono uppercase tracking-widest text-gray-500">
                    {telnyxPool > 1 ? `via ${telnyxPool} numre (rotasjon)` : `via ${telnyxFrom}`} · REC
                  </span>
                </button>
              ) : phoneNumber ? (
                <a href={`tel:${phoneNumber}`}
                  className="flex-1 flex items-center justify-center gap-3 h-14 rounded-xl bg-white hover:bg-gray-200 active:bg-gray-300 text-black transition-colors touch-manipulation">
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/>
                  </svg>
                  <span className="text-base font-bold">Call</span>
                  <span className="font-mono text-base font-semibold tabular-nums">{phoneNumber}</span>
                </a>
              ) : (
                <div className="flex-1 flex items-center justify-center h-14 rounded-xl border border-dashed border-gray-700 text-gray-600 text-sm">
                  No phone number
                </div>
              )}

              {/* Recording control — console REC button */}
              {isRecording ? (
                <button
                  onClick={stopRecording}
                  className="shrink-0 w-24 flex flex-col items-center justify-center gap-1 h-14 rounded-xl border-2 border-white bg-gray-950 text-white transition-colors touch-manipulation"
                >
                  <span className="flex items-center gap-1.5 font-mono text-[10px] font-bold uppercase tracking-widest">
                    <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
                    Rec
                  </span>
                  <span className="text-[10px] text-gray-400">tap to stop</span>
                </button>
              ) : recordingUploading ? (
                <span className="shrink-0 w-24 flex flex-col items-center justify-center gap-1 h-14 rounded-xl border border-gray-700 text-gray-400">
                  <span className="w-3.5 h-3.5 border border-gray-500 border-t-white rounded-full animate-spin" />
                  <span className="font-mono text-[10px] uppercase tracking-widest">Saving</span>
                </span>
              ) : lastRecordingId ? (
                <a href="/recordings"
                  className="shrink-0 w-24 flex flex-col items-center justify-center gap-1 h-14 rounded-xl border border-gray-700 text-gray-300 hover:border-gray-500 transition-colors">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <span className="font-mono text-[10px] uppercase tracking-widest">Saved</span>
                </a>
              ) : (
                <button
                  onClick={startRecording}
                  className="shrink-0 w-24 flex flex-col items-center justify-center gap-1 h-14 rounded-xl border border-gray-700 bg-gray-950 text-gray-300 hover:border-gray-500 hover:text-white transition-colors touch-manipulation"
                >
                  <span className="w-2.5 h-2.5 rounded-full border-2 border-current" />
                  <span className="font-mono text-[10px] font-bold uppercase tracking-widest">Rec</span>
                </button>
              )}
            </div>
            {telnyxStatus && (
              <p className="text-xs text-gray-400">{telnyxStatus}</p>
            )}

            {/* Auto-record toggle */}
            <button
              type="button"
              onClick={() => setAutoRecord(!autoRecord)}
              className="flex items-center gap-2 text-xs text-gray-400 hover:text-gray-200 transition-colors"
              title="Automatically record each call and save it when you pick an outcome"
            >
              <span
                className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${autoRecord ? 'bg-white' : 'bg-gray-700'}`}
              >
                <span className={`inline-block h-3 w-3 transform rounded-full transition-transform ${autoRecord ? 'translate-x-3.5 bg-black' : 'translate-x-0.5 bg-white'}`} />
              </span>
              <span className="font-mono text-[11px] uppercase tracking-wider">Auto-record {autoRecord ? 'on' : 'off'}</span>
            </button>
          </div>

          {/* Details */}
          <div className="px-4 sm:px-6 py-4 sm:py-5 grid grid-cols-2 gap-3 sm:gap-4">
            <Field label="Phone">
              <input value={phoneNumber} onChange={e => setPhoneNumber(e.target.value)}
                placeholder="—"
                className="w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-sm font-mono text-white focus:outline-none focus:border-white" />
            </Field>

            <Field label="Region">
              <select value={state} onChange={e => setState(e.target.value)}
                className="w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-white">
                <option value="">—</option>
                {REGIONS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>

            <Field label="Owner / Daglig leder">
              <input value={ownersName} onChange={e => setOwnersName(e.target.value)}
                placeholder="Unknown"
                className="w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-white" />
            </Field>

            <Field label="Email">
              <input value={emailField} onChange={e => setEmailField(e.target.value)}
                placeholder="—" type="email"
                className="w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-white" />
            </Field>
          </div>

          {/* Notes */}
          <div className="px-4 sm:px-6 pb-4 sm:pb-5 space-y-2">
            <Field label="Notes">
              <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
                placeholder="Add notes…"
                className="w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-white resize-none" />
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
              <div className="flex gap-2">
                <button
                  onClick={() => setShowCallback(true)}
                  className="flex-1 flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed border-gray-600 text-sm text-gray-400 hover:border-gray-400 hover:text-gray-200 transition-colors touch-manipulation"
                >
                  <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Set callback date/time
                </button>
                <button
                  onClick={() => void snoozeUntilTomorrow()}
                  disabled={saving}
                  title="Skjul dette leadet til i morgen — ingen samtale registreres"
                  className="shrink-0 flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed border-gray-600 text-sm text-gray-400 hover:border-gray-400 hover:text-gray-200 disabled:opacity-50 transition-colors touch-manipulation"
                >
                  <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
                  </svg>
                  Tomorrow
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <Field label="Callback Date">
                  <input type="date" value={callbackDate} onChange={e => setCallbackDate(e.target.value)}
                    className="w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-white [color-scheme:dark]" />
                </Field>
                <Field label="Preferred Day & Time">
                  <div className="flex gap-2 flex-wrap">
                    <select value={callbackDay} onChange={e => setCallbackDay(e.target.value)}
                      className="flex-1 min-w-[120px] bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-white">
                      <option value="">Any day</option>
                      {['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'].map(d => (
                        <option key={d} value={d}>{d}</option>
                      ))}
                    </select>
                    <input type="time" value={callbackTime} onChange={e => setCallbackTime(e.target.value)}
                      className="flex-1 min-w-[120px] bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-white [color-scheme:dark]" />
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
            <button
              type="button"
              onClick={() => setReachedDM(!reachedDM)}
              className="flex items-center gap-2 text-xs text-gray-400 hover:text-gray-200 transition-colors"
              title="Did you speak with the owner / daglig leder (not a gatekeeper or voicemail)?"
            >
              <span className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${reachedDM ? 'bg-white' : 'bg-gray-700'}`}>
                <span className={`inline-block h-3 w-3 transform rounded-full transition-transform ${reachedDM ? 'translate-x-3.5 bg-black' : 'translate-x-0.5 bg-white'}`} />
              </span>
              <span className="font-mono text-[11px] uppercase tracking-wider">Reached decision-maker</span>
            </button>

            <Field label="Call Outcome">
              <div className="grid grid-cols-2 gap-2 mt-1">
                {RESPONSE_STATUSES.map(r => (
                  <button key={r} onClick={() => { setResponse(r); if (recordingRef.current) stopRecording() }}
                    className={`text-left px-3 py-3 rounded-lg border text-sm transition-colors touch-manipulation ${
                      response === r
                        ? 'border-white bg-white text-black font-semibold'
                        : 'border-gray-700 bg-gray-950 text-gray-400 hover:border-gray-500 hover:text-gray-200'
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
                className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-white hover:bg-gray-200 active:bg-gray-300 disabled:opacity-40 disabled:cursor-not-allowed text-black font-semibold text-sm transition-colors touch-manipulation">
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
      <label className="font-mono text-[10px] text-gray-500 uppercase tracking-widest font-medium">{label}</label>
      {children}
    </div>
  )
}
