'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { format } from 'date-fns'
import type { Company, CompanyNote } from '@/types'
import { RESPONSE_STATUSES, TEAM_MEMBERS, STATES } from '@/types'
import { createClient } from '@/lib/supabase/client'

interface Props {
  initialQueue: Company[]
  dialNumber?: string
}

interface PresencePayload {
  companyId: string
  callerName: string
}

type CallStatus = 'idle' | 'connecting' | 'connected' | 'ended'
type IncomingCallState = { call: unknown; from: string } | null

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

/**
 * Returns true if this company's callback window is active right now.
 * Window = matching day of week (if set) AND within 2 hours before/after callback_time (if set).
 */
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

/**
 * Priority:
 * 1. Not-yet-called  AND callback matches now
 * 2. Not-yet-called  (no callback or not matching)
 * 3. Previously-called AND callback matches now
 * 4. Previously-called (oldest contact first)
 *
 * Within each priority tier, companies are ordered by google_reviews descending
 * so the highest-reviewed companies are called first.
 */
function sortQueueByCallback(q: Company[]): Company[] {
  const score = (c: Company): number => {
    const notCalled = c.reach_out_response === 'Not called' || !c.reach_out_response
    const matches   = callbackMatchesNow(c)
    if (notCalled && matches) return 0
    if (notCalled)            return 1
    if (matches)              return 2
    return 3
  }
  return [...q].sort((a, b) => {
    const sd = score(a) - score(b)
    if (sd !== 0) return sd
    // Within each tier, show companies with most reviews first
    const ra = a.google_reviews ?? 0
    const rb = b.google_reviews ?? 0
    return rb - ra
  })
}
function twoWeeksStr() {
  const d = new Date(); d.setDate(d.getDate() + 14)
  return format(d, 'yyyy-MM-dd')
}
function fmtDuration(s: number) {
  const m = Math.floor(s / 60), sec = s % 60
  return `${m}:${sec.toString().padStart(2, '0')}`
}

const SESSION_ID =
  typeof crypto !== 'undefined' ? crypto.randomUUID() : Math.random().toString(36).slice(2)

export function CallingSession({ initialQueue, dialNumber }: Props) {
  const [queue, setQueue]             = useState<Company[]>(() => {
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
  const [index, setIndex]             = useState(0)
  const [saving, setSaving]           = useState(false)
  const [done, setDone]               = useState(false)
  const [sessionCaller, setSessionCallerState] = useState('')

  // Restore from localStorage after hydration (avoids SSR/client mismatch)
  useEffect(() => {
    const saved = localStorage.getItem('sessionCaller')
    if (saved) setSessionCallerState(saved)
  }, [])

  function setSessionCaller(name: string) {
    setSessionCallerState(name)
    if (name) localStorage.setItem('sessionCaller', name)
    else localStorage.removeItem('sessionCaller')
  }

  // Presence
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const channelRef                    = useRef<any>(null)
  const [claimedByOthers, setClaimedByOthers] = useState<Map<string, string>>(new Map())
  const [activeCallers, setActiveCallers]     = useState(0)

  // Editable fields
  const [response, setResponse]       = useState('')
  const [notes, setNotes]             = useState('')
  const [ownersName, setOwnersName]   = useState('')
  const [phoneNumber, setPhoneNumber] = useState('')
  const [emailField, setEmailField]   = useState('')
  const [showEmailInput, setShowEmailInput] = useState(false)
  const [callbackDay, setCallbackDay]   = useState('')
  const [callbackTime, setCallbackTime] = useState('')
  const [showCallback, setShowCallback] = useState(false)
  const [state, setState]             = useState('')
  const [companyName, setCompanyName] = useState('')
  const [originalNotes, setOriginalNotes]   = useState('')
  const [noteHistory, setNoteHistory]       = useState<CompanyNote[]>([])
  const [showHistory, setShowHistory]       = useState(false)
  const [loadingHistory, setLoadingHistory] = useState(false)

  // Twilio
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const deviceRef    = useRef<any>(null)
  const audioRef     = useRef<HTMLAudioElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const activeCallRef = useRef<any>(null)
  const [callStatus, setCallStatus]   = useState<CallStatus>('idle')
  const [callSid, setCallSid]         = useState('')
  const [callerId, setCallerId]       = useState('')
  const [_usageToday, setUsageToday]  = useState(0)
  const [dailyCap]                    = useState(80)
  const [allUsage, setAllUsage]       = useState<{ number: string; count: number }[]>([])
  const [healthData, setHealthData]   = useState<Record<string, { isSpam: boolean; reportCount: number; lastReported: string | null; error?: string }>>({})
  const [checkingHealth, setCheckingHealth] = useState(false)
  const [isMuted, setIsMuted]         = useState(false)
  const [duration, setDuration]       = useState(0)
  const timerRef   = useRef<ReturnType<typeof setInterval> | null>(null)
  const [deviceReady, setDeviceReady] = useState(false)
  const [showDialpad, setShowDialpad] = useState(false)
  const [dialpadInput, setDialpadInput] = useState('')
  const [incomingCall, setIncomingCall] = useState<IncomingCallState>(null)


  const company = queue[index]

  const loadCompany = useCallback((c: Company) => {
    setResponse(c.reach_out_response ?? '')
    setNotes(c.notes ?? '')
    setOriginalNotes(c.notes ?? '')
    setOwnersName(c.owners_name ?? '')
    setPhoneNumber(c.phone_number ?? '')
    setEmailField(c.email ?? '')
    setShowEmailInput(!!c.email)
    setCallbackDay(c.callback_day ?? '')
    setCallbackTime(c.callback_time ?? '')
    setShowCallback(!!(c.callback_day || c.callback_time))
    setState(c.state ?? '')
    setCompanyName(c.company_name ?? '')
    setCallStatus('idle')
    setCallSid('')
    setDuration(0)
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

  // ── Realtime presence ────────────────────────────────────────
  useEffect(() => {
    const supabase = createClient()
    const channel = supabase.channel('calling-session', {
      config: { presence: { key: SESSION_ID } },
    })
    channel.on('presence', { event: 'sync' }, () => {
      const ps = channel.presenceState<PresencePayload>()
      const claimed = new Map<string, string>()
      let others = 0
      for (const [key, presences] of Object.entries(ps)) {
        if (key === SESSION_ID) continue
        others++
        for (const p of presences as PresencePayload[]) {
          if (p.companyId) claimed.set(p.companyId, p.callerName || 'Someone')
        }
      }
      setClaimedByOthers(claimed)
      setActiveCallers(others)
    })
    channel.subscribe(async (status: string) => {
      if (status === 'SUBSCRIBED' && initialQueue[0]) {
        await channel.track({ companyId: initialQueue[0].id, callerName: '' })
      }
    })
    channelRef.current = channel
    return () => { channel.untrack(); channel.unsubscribe() }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const ch = channelRef.current
    if (!ch || !company) return
    ch.track({ companyId: company.id, callerName: sessionCaller })
  }, [company?.id, sessionCaller]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!company || !claimedByOthers.has(company.id)) return
    const callerName = claimedByOthers.get(company.id)
    toast.warning(`${callerName} is already calling ${company.company_name} — moving you to next`)
    const next = findNextUnclaimed(index + 1, queue, claimedByOthers)
    if (next === -1) setDone(true)
    else { setIndex(next); loadCompany(queue[next]) }
  }, [claimedByOthers]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Twilio Device ────────────────────────────────────────────
  useEffect(() => {
    if (!sessionCaller) return

    let destroyed = false

    async function initDevice() {
      try {
        const { Device } = await import('@twilio/voice-sdk')
        const res = await fetch('/api/twilio/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ callerName: sessionCaller, clientId: SESSION_ID }),
        })
        if (!res.ok) { console.warn('Twilio token failed — calling disabled'); return }
        const { token, callerId: cid, usageToday: usage, allUsage: all } = await res.json()
        if (destroyed) return
        setCallerId(cid)
        setUsageToday(usage ?? 0)
        setAllUsage(all ?? [])
        const device = new Device(token, {
          logLevel: 1,
          enableImprovedSignalingErrorPrecision: true,
          allowIncomingWhileBusy: true,
        })

        if (device.audio) {
          await device.audio.setAudioConstraints({
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          })

          // Pre-initialize the speaker output BEFORE registering.
          // The _onAddTrack error happens when the SDK's internal
          // PeerConnection tries to setSinkId on its <audio> element
          // but no output device has been configured yet.
          try {
            await device.audio.speakerDevices.set('default')
          } catch {
            // setSinkId not supported or no audio devices — non-fatal
          }
        }

        device.on('error', (err: Error) => {
          console.error('[TwilioDevice] error:', err)
          toast.error(`Twilio: ${err.message}`)
        })

        await device.register()

        // Second speaker init after register as a safety net —
        // some browsers only allow setSinkId after getUserMedia
        device.audio?.speakerDevices.set('default').catch(() => {})

        // ── Inbound call handler ──────────────────────────────────
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        device.on('incoming', (call: any) => {
          // If already in a call, auto-reject
          if (activeCallRef.current) { call.reject(); return }
          const from = call.parameters?.From ?? 'Unknown'
          setIncomingCall({ call, from })
          // Clear the overlay if the caller hangs up before we answer
          call.on('cancel', () => setIncomingCall(null))
        })
        if (!destroyed) { deviceRef.current = device; setDeviceReady(true) }
      } catch (err) {
        console.warn('Twilio init failed:', err)
      }
    }

    initDevice()

    return () => {
      destroyed = true
      deviceRef.current?.destroy()
      deviceRef.current = null
      setDeviceReady(false)
    }
  }, [sessionCaller])

  // Auto-dial when navigating from pipeline with ?dial= param
  const autoDialFired = useRef(false)
  useEffect(() => {
    if (!dialNumber || autoDialFired.current || !deviceReady || callStatus !== 'idle' || !phoneNumber) return
    autoDialFired.current = true
    // Small delay to let UI settle after device init
    const t = setTimeout(() => handleCall(), 300)
    return () => clearTimeout(t)
  }, [deviceReady, phoneNumber, callStatus]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Call actions ─────────────────────────────────────────────
  async function handleCall() {
    if (!deviceRef.current || !phoneNumber || callStatus !== 'idle') return

    // Normalize to E.164
    const digits = phoneNumber.replace(/\D/g, '')
    // 11 digits starting with 1 → US long form (+1XXXXXXXXXX)
    // 10 digits with valid US area code (2-9) → prepend +1
    // Anything else with ≥10 digits → pass as +digits and let Twilio decide
    // Fewer than 10 digits → too short to be valid
    let e164: string
    if (digits.length === 11 && digits.startsWith('1')) {
      e164 = `+${digits}`
    } else if (digits.length === 10 && /^[2-9]/.test(digits)) {
      e164 = `+1${digits}`
    } else if (digits.length >= 10) {
      e164 = `+${digits}`
    } else {
      toast.error(`Phone number too short: ${phoneNumber}`)
      return
    }

    try {
      setCallStatus('connecting')
      const call = await deviceRef.current.connect({
        params: { To: e164, CallerId: callerId, CallerName: sessionCaller },
      })
      activeCallRef.current = call

      // Optimistically increment local usage counter when call connects
      setUsageToday(u => u + 1)
      setAllUsage(prev => prev.map(n => n.number === callerId ? { ...n, count: n.count + 1 } : n))

      let didConnect = false

      call.on('accept', () => {
        didConnect = true
        setCallStatus('connected')
        const sid = call.parameters?.CallSid ?? ''
        setCallSid(sid)
        if (company && sid) {
          patchCompany(company.id, { last_call_sid: sid } as Partial<Company>).catch(() => null)
        }
        timerRef.current = setInterval(() => setDuration(d => d + 1), 1000)
      })

      call.on('disconnect', () => {
        clearInterval(timerRef.current!)
        activeCallRef.current = null
        if (audioRef.current) { audioRef.current.srcObject = null }
        if (!didConnect) {
          setCallStatus('idle')
          toast.error(`Call failed — number may be invalid or unreachable: ${phoneNumber}`)
        } else {
          setCallStatus('ended')
        }
      })

      call.on('error', (err: Error) => {
        clearInterval(timerRef.current!)
        setCallStatus('idle')
        activeCallRef.current = null
        if (audioRef.current) { audioRef.current.srcObject = null }
        toast.error(`Call error: ${err.message}`)
      })
    } catch (err) {
      setCallStatus('idle')
      toast.error(`Could not start call: ${String(err)}`)
    }
  }

  // ── Inbound call accept / reject ────────────────────────────
  function handleAcceptIncoming() {
    if (!incomingCall) return
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const call = incomingCall.call as any
    // Wire events BEFORE accepting
    call.on('accept', () => {
      setCallStatus('connected')
      const sid = call.parameters?.CallSid ?? ''
      setCallSid(sid)
      timerRef.current = setInterval(() => setDuration(d => d + 1), 1000)
    })
    call.on('disconnect', () => {
      clearInterval(timerRef.current!)
      setCallStatus('ended')
      activeCallRef.current = null
    })
    call.on('error', (err: Error) => {
      clearInterval(timerRef.current!)
      setCallStatus('idle')
      activeCallRef.current = null
      toast.error(`Call error: ${err.message}`)
    })
    activeCallRef.current = call
    setCallStatus('connecting')
    setDuration(0)
    setIncomingCall(null)
    call.accept()
  }

  function handleRejectIncoming() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(incomingCall?.call as any)?.reject()
    setIncomingCall(null)
  }

  async function checkNumberHealth() {    setCheckingHealth(true)
    try {
      const res = await fetch('/api/number-health')
      if (!res.ok) { toast.error('Health check failed'); return }
      const data: { raw: string; isSpam: boolean; reportCount: number; lastReported: string | null; error?: string }[] = await res.json()
      const map: typeof healthData = {}
      for (const d of data) map[d.raw] = { isSpam: d.isSpam, reportCount: d.reportCount, lastReported: d.lastReported, error: d.error }
      setHealthData(map)
    } catch { toast.error('Health check failed') }
    finally { setCheckingHealth(false) }
  }

  function handleMute() {
    if (!activeCallRef.current) return
    const next = !isMuted
    activeCallRef.current.mute(next)
    setIsMuted(next)
  }

  function handleHangup() {
    activeCallRef.current?.disconnect()
    setShowDialpad(false)
    setDialpadInput('')
  }

  function sendDigit(digit: string) {
    activeCallRef.current?.sendDigits(digit)
    setDialpadInput(prev => prev + digit)
  }

  // ── Navigation ───────────────────────────────────────────────
  function findNextUnclaimed(from: number, q: Company[], claimed: Map<string, string>): number {
    let i = from
    while (i < q.length && claimed.has(q[i].id)) i++
    return i < q.length ? i : -1
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
        last_call_sid: callSid || company.last_call_sid,
      }
      if (!skip && response) {
        payload.reach_out_response = response
        payload.who_called = sessionCaller || null
        payload.last_reach_out = todayStr()
        payload.next_reach_out = twoWeeksStr()
        payload.amount_of_calls = (company.amount_of_calls ?? 0) + 1
      }
      const updated = await patchCompany(company.id, payload)
      setQueue(q => q.map(c => c.id === updated.id ? updated : c))

      // Log note to history if it changed
      if (!skip && notes.trim() && notes.trim() !== originalNotes.trim()) {
        fetch(`/api/companies/${company.id}/notes`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ note: notes.trim(), caller_name: sessionCaller || null }),
        }).catch(() => {})
      }

      toast.success(skip ? 'Skipped' : 'Saved')
    } catch {
      toast.error('Failed to save')
    } finally {
      setSaving(false)
    }
    const next = findNextUnclaimed(index + 1, queue, claimedByOthers)
    if (next === -1) setDone(true)
    else { setIndex(next); loadCompany(queue[next]) }
  }

  function handleBack() {
    if (index === 0) return
    const p = index - 1; setIndex(p); loadCompany(queue[p])
  }

  // ── Done ─────────────────────────────────────────────────────
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
          <a href="/" className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-lg text-sm transition-colors">Back to Pipeline</a>
          <button onClick={() => { setIndex(0); setDone(false); if (queue[0]) loadCompany(queue[0]) }}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm transition-colors">Start over</button>
        </div>
      </div>
    )
  }

  const progress = (index / queue.length) * 100
  const inCall = callStatus === 'connected' || callStatus === 'connecting'

  return (
    <div className="flex-1 overflow-y-auto flex flex-col items-center justify-start py-4 sm:py-8 px-3 sm:px-4 pb-safe">
      {/* Hidden audio element — keeps Twilio's remote stream attached to the DOM */}
      <audio ref={audioRef} autoPlay style={{ display: 'none' }} />

      {/* ── Incoming call overlay ── */}
      {incomingCall && (
        <div className="fixed inset-x-0 top-0 z-50 flex justify-center px-4 pt-4 pointer-events-none">
          <div className="w-full max-w-sm pointer-events-auto">
            <div className="bg-gray-900 border-2 border-green-600 rounded-2xl shadow-2xl shadow-green-900/40 overflow-hidden animate-bounce-in">
              {/* Pulsing top bar */}
              <div className="h-1 bg-green-500 animate-pulse" />
              <div className="px-5 py-4">
                <div className="flex items-center gap-3 mb-4">
                  {/* Ringing icon */}
                  <div className="relative shrink-0">
                    <div className="w-12 h-12 rounded-full bg-green-900/50 border border-green-700 flex items-center justify-center">
                      <svg className="w-6 h-6 text-green-400 animate-pulse" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/>
                      </svg>
                    </div>
                    <span className="absolute -top-1 -right-1 w-4 h-4 bg-green-500 rounded-full animate-ping" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-green-400 font-medium uppercase tracking-wide">Incoming call</p>
                    <p className="text-white font-bold text-lg truncate">{incomingCall.from}</p>
                  </div>
                </div>
                {/* Accept / Decline */}
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={handleRejectIncoming}
                    className="flex items-center justify-center gap-2 py-3 rounded-xl bg-red-900/60 border border-red-700 text-red-300 font-semibold text-sm hover:bg-red-900/80 transition-colors touch-manipulation"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 8l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2M5 3a16.003 16.003 0 0114 14m-1.34-3.34l-2.12-.36a2 2 0 00-1.9.7L12.5 15.5A15.045 15.045 0 018.5 11.5l1.47-2.07a2 2 0 00.7-1.9l-.36-2.12A2 2 0 008.35 3.5H5.5a2 2 0 00-2 2C3.5 14.314 9.686 20.5 18.5 20.5a2 2 0 002-2v-2.84a2 2 0 00-1.66-1.98z" />
                    </svg>
                    Decline
                  </button>
                  <button
                    onClick={handleAcceptIncoming}
                    className="flex items-center justify-center gap-2 py-3 rounded-xl bg-green-700 hover:bg-green-600 border border-green-600 text-white font-semibold text-sm transition-colors touch-manipulation"
                  >
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/>
                    </svg>
                    Accept
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="w-full max-w-2xl space-y-3 sm:space-y-4">

        {/* Active callers */}
        {activeCallers > 0 && (
          <div className="flex items-center gap-2 px-3 py-2 bg-green-950/30 border border-green-800/40 rounded-lg">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
            </span>
            <span className="text-xs text-green-400 font-medium">
              {activeCallers} other caller{activeCallers > 1 ? 's' : ''} active — duplicates skipped automatically
            </span>
          </div>
        )}

        {/* Caller picker */}
        {!sessionCaller && (
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
        )}

        {sessionCaller && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-500">
                Calling as <span className="text-gray-300 font-medium">{sessionCaller}</span>
                <button onClick={() => setSessionCaller('')} className="ml-2 text-gray-600 hover:text-gray-400 text-xs underline">change</button>
              </span>
              <span className="text-sm text-gray-500">{index + 1} / {queue.length}</span>
            </div>

            {/* Number health panel */}
            {allUsage.length > 0 && (
              <div className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-3 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">Number rotation — today</p>
                  <button onClick={checkNumberHealth} disabled={checkingHealth}
                    className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300 transition-colors disabled:opacity-50">
                    {checkingHealth
                      ? <><svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>Checking…</>
                      : <><svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>Spam check</>
                    }
                  </button>
                </div>
                <div className="space-y-1.5">
                  {allUsage.map(({ number, count }) => {
                    const pct      = Math.min((count / dailyCap) * 100, 100)
                    const active   = number === callerId
                    const warning  = pct >= 75
                    const danger   = pct >= 95
                    const barColor = danger ? 'bg-red-500' : warning ? 'bg-yellow-500' : 'bg-green-500'
                    const dialLabel = danger ? 'At cap' : warning ? 'Near cap' : 'Healthy'
                    const health   = healthData[number]
                    return (
                      <div key={number} className={`rounded-lg px-3 py-2 ${active ? 'bg-gray-800 border border-gray-700' : ''}`}>
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2">
                            <span className={`text-xs font-mono ${active ? 'text-white font-semibold' : 'text-gray-400'}`}>
                              {number}
                              {active && <span className="ml-1.5 text-blue-400 text-[10px] font-normal">← yours today</span>}
                            </span>
                            {/* Spam health badge */}
                            {health && !health.error && (
                              health.isSpam || health.reportCount > 0 ? (
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-950/60 border border-red-800 text-red-300">
                                  ⚠ {health.reportCount} report{health.reportCount !== 1 ? 's' : ''}
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-950/60 border border-green-800 text-green-400">
                                  ✓ Clean
                                </span>
                              )
                            )}
                            {health?.error && (
                              <span className="text-[10px] text-gray-600">check failed</span>
                            )}
                          </div>
                          <span className={`text-xs ${danger ? 'text-red-400' : warning ? 'text-yellow-400' : 'text-gray-500'}`}>
                            {count}/{dailyCap} · {dialLabel}
                          </span>
                        </div>
                        <div className="w-full h-1 bg-gray-700 rounded-full overflow-hidden">
                          <div className={`h-1 rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    )
                  })}
                </div>
                <p className="text-[10px] text-gray-600">Rotates daily · 80 dials/number cap · auto-switches if cap hit</p>
              </div>
            )}
          </div>
        )}

        {/* Progress */}
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

            {/* Phone + call controls — full width on mobile */}
            <div className="col-span-2">
            <Field label="Phone Number">
              {callStatus === 'idle' || callStatus === 'ended' ? (
                <div className="flex items-center gap-2 flex-wrap">
                  <a href={`tel:${phoneNumber}`} onClick={e => phoneNumber ? undefined : e.preventDefault()}
                    className="text-blue-400 hover:text-blue-300 text-base font-semibold transition-colors flex-1 truncate min-w-0">
                    {phoneNumber || '—'}
                  </a>
                  {deviceReady && phoneNumber && (
                    <button onClick={handleCall}
                      className="flex items-center gap-2 px-4 py-2.5 bg-green-600 hover:bg-green-500 active:bg-green-700 text-white rounded-xl text-sm font-semibold transition-colors touch-manipulation">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                          d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                      </svg>
                      Call
                    </button>
                  )}
                  {callStatus === 'ended' && (
                    <span className="text-xs text-gray-500 font-medium">Ended {fmtDuration(duration)}</span>
                  )}
                </div>
              ) : (
                /* In-call controls */
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="flex items-center gap-1.5 text-sm font-semibold text-green-400">
                      <span className="relative flex h-2.5 w-2.5">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
                      </span>
                      {callStatus === 'connecting' ? 'Connecting…' : `In call · ${fmtDuration(duration)}`}
                    </span>
                  </div>
                  {/* Bigger touch targets for mobile call controls */}
                  <div className="grid grid-cols-3 gap-2">
                    <button onClick={handleMute}
                      className={`flex flex-col items-center justify-center gap-1 py-3 rounded-xl border text-xs font-medium transition-colors touch-manipulation ${
                        isMuted ? 'border-yellow-600 bg-yellow-950/40 text-yellow-300' : 'border-gray-600 bg-gray-800 text-gray-300'
                      }`}>
                      <span className="text-lg">{isMuted ? '🔇' : '🎤'}</span>
                      <span>{isMuted ? 'Muted' : 'Mute'}</span>
                    </button>
                    <button onClick={() => setShowDialpad(d => !d)}
                      className={`flex flex-col items-center justify-center gap-1 py-3 rounded-xl border text-xs font-medium transition-colors touch-manipulation ${
                        showDialpad ? 'border-blue-600 bg-blue-950/40 text-blue-300' : 'border-gray-600 bg-gray-800 text-gray-300'
                      }`}>
                      <span className="text-lg">⌨️</span>
                      <span>Keypad</span>
                    </button>
                    <button onClick={handleHangup}
                      className="flex flex-col items-center justify-center gap-1 py-3 rounded-xl border border-red-700 bg-red-950/40 text-red-300 text-xs font-medium transition-colors touch-manipulation">
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                          d="M16 8l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2M5 3a16.003 16.003 0 0114 14m-1.34-3.34l-2.12-.36a2 2 0 00-1.9.7L12.5 15.5A15.045 15.045 0 018.5 11.5l1.47-2.07a2 2 0 00.7-1.9l-.36-2.12A2 2 0 008.35 3.5H5.5a2 2 0 00-2 2C3.5 14.314 9.686 20.5 18.5 20.5a2 2 0 002-2v-2.84a2 2 0 00-1.66-1.98z" />
                      </svg>
                      <span>Hang up</span>
                    </button>
                  </div>

                  {/* Dialpad — bigger keys on mobile */}
                  {showDialpad && (
                    <div className="bg-gray-950 border border-gray-700 rounded-xl p-3 space-y-2">
                      <div className="h-8 flex items-center px-3 bg-gray-900 rounded-lg">
                        <span className="text-base font-mono text-gray-300 tracking-widest flex-1 text-right">
                          {dialpadInput || <span className="text-gray-600">—</span>}
                        </span>
                        {dialpadInput && (
                          <button onClick={() => setDialpadInput(prev => prev.slice(0, -1))}
                            className="ml-2 text-gray-500 hover:text-gray-300 p-1 touch-manipulation">
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2M3 12l6.414 6.414a2 2 0 001.414.586H19a2 2 0 002-2V7a2 2 0 00-2-2h-8.172a2 2 0 00-1.414.586L3 12z" />
                            </svg>
                          </button>
                        )}
                      </div>
                      {[['1','2','3'],['4','5','6'],['7','8','9'],['*','0','#']].map((row, ri) => (
                        <div key={ri} className="grid grid-cols-3 gap-2">
                          {row.map(key => (
                            <button key={key} onClick={() => sendDigit(key)}
                              className="h-12 sm:h-10 rounded-xl bg-gray-800 hover:bg-gray-700 active:bg-gray-600 text-white font-semibold text-lg transition-colors border border-gray-700 touch-manipulation">
                              {key}
                            </button>
                          ))}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <input value={phoneNumber} onChange={e => setPhoneNumber(e.target.value)}
                placeholder="Edit phone…" disabled={inCall}
                className="mt-2 w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 disabled:opacity-40" />
            </Field>
            </div>

            {/* State */}
            <Field label="State">
              <select value={state} onChange={e => setState(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500">
                <option value="">—</option>
                {STATES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>

            {/* Owner */}
            <Field label="Owner's Name">
              <input value={ownersName} onChange={e => setOwnersName(e.target.value)}
                placeholder="Unknown"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500" />
            </Field>

            {/* Google reviews */}
            <Field label="Google Reviews">
              <span className="text-white font-semibold text-lg">
                {company?.google_reviews?.toLocaleString() ?? '—'}
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

            {/* Note history toggle */}
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

          {/* Email */}
          <div className="px-4 sm:px-6 pb-4 sm:pb-5">
            {!showEmailInput ? (
              <button
                onClick={() => setShowEmailInput(true)}
                className="flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed border-gray-600 text-sm text-gray-400 hover:border-blue-500 hover:text-blue-400 transition-colors touch-manipulation w-full"
              >
                <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                Email provided — tap to enter
              </button>
            ) : (
              <Field label="Email">
                <div className="flex gap-2">
                  <input
                    type="email"
                    value={emailField}
                    onChange={e => setEmailField(e.target.value)}
                    placeholder="owner@example.com"
                    className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                    autoFocus
                  />
                  {!emailField && (
                    <button
                      onClick={() => setShowEmailInput(false)}
                      className="px-2 text-gray-600 hover:text-gray-400 transition-colors"
                      title="Cancel"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>
              </Field>
            )}
          </div>

          {/* Callback time */}
          <div className="px-4 sm:px-6 pb-4 sm:pb-5">
            {!showCallback ? (
              <button
                onClick={() => setShowCallback(true)}
                className="flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed border-gray-600 text-sm text-gray-400 hover:border-yellow-500 hover:text-yellow-400 transition-colors touch-manipulation w-full"
              >
                <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Best callback time — tap to set
              </button>
            ) : (
              <Field label="Best Callback Time">
                <div className="flex gap-2 flex-wrap">
                  <select
                    value={callbackDay}
                    onChange={e => setCallbackDay(e.target.value)}
                    className="flex-1 min-w-[120px] bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-yellow-500"
                  >
                    <option value="">Any day</option>
                    {['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'].map(d => (
                      <option key={d} value={d}>{d}</option>
                    ))}
                  </select>
                  <input
                    type="time"
                    value={callbackTime}
                    onChange={e => setCallbackTime(e.target.value)}
                    className="flex-1 min-w-[120px] bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-yellow-500"
                  />
                  <button
                    onClick={() => { setCallbackDay(''); setCallbackTime(''); setShowCallback(false) }}
                    className="px-2 text-gray-600 hover:text-gray-400 transition-colors"
                    title="Clear"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </Field>
            )}
          </div>

          {/* Outcome */}
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
                ) : (
                  <>Log & Next →</>
                )}
              </button>
            </div>
            {!response && <p className="text-xs text-gray-600 text-center">Select a call outcome to log</p>}
          </div>

          {/* Link to recordings page */}
          <div className="border-t border-gray-800 px-4 sm:px-6 py-3">
            <a href="/recordings"
              className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-300 transition-colors">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
              </svg>
              View all recordings →
            </a>
          </div>
        </div>

        {/* Up next */}
        {(() => {
          const nextIdx = findNextUnclaimed(index + 1, queue, claimedByOthers)
          const next = nextIdx !== -1 ? queue[nextIdx] : null
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

function getResponseButtonStyle(r: string): string {
  if (r === 'Intro-meeting wanted') return 'border-green-600 bg-green-950/50 text-green-300'
  if (r === 'Owner is not interested' || r === 'Already acquired') return 'border-red-700 bg-red-950/50 text-red-300'
  if (r === 'Left a message to the owner' || r === 'Call back on Monday') return 'border-yellow-600 bg-yellow-950/50 text-yellow-300'
  if (r === 'Not called') return 'border-gray-600 bg-gray-800 text-gray-300'
  return 'border-blue-600 bg-blue-950/50 text-blue-300'
}
