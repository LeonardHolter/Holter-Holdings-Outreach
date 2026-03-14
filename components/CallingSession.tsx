'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { format } from 'date-fns'
import type { Company } from '@/types'
import { RESPONSE_STATUSES, TEAM_MEMBERS, STATES } from '@/types'
import { createClient } from '@/lib/supabase/client'

interface Props {
  initialQueue: Company[]
}

interface PresencePayload {
  companyId: string
  callerName: string
}

type CallStatus = 'idle' | 'connecting' | 'connected' | 'ended'

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

export function CallingSession({ initialQueue }: Props) {
  const [queue, setQueue]             = useState<Company[]>(initialQueue)
  const [index, setIndex]             = useState(0)
  const [saving, setSaving]           = useState(false)
  const [done, setDone]               = useState(false)
  const [sessionCaller, setSessionCaller] = useState('')

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
  const [state, setState]             = useState('')
  const [companyName, setCompanyName] = useState('')
  const [searchingOwner, setSearchingOwner] = useState(false)

  // Twilio
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const deviceRef    = useRef<any>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const activeCallRef = useRef<any>(null)
  const [callStatus, setCallStatus]   = useState<CallStatus>('idle')
  const [callSid, setCallSid]         = useState('')
  const [callerId, setCallerId]       = useState('')
  const [isMuted, setIsMuted]         = useState(false)
  const [duration, setDuration]       = useState(0)
  const timerRef   = useRef<ReturnType<typeof setInterval> | null>(null)
  const [deviceReady, setDeviceReady] = useState(false)
  const [showDialpad, setShowDialpad] = useState(false)
  const [dialpadInput, setDialpadInput] = useState('')


  const company = queue[index]

  // ── Owner lookup ─────────────────────────────────────────────
  const lookupOwner = useCallback(async (name: string, companyState: string) => {
    setSearchingOwner(true)
    try {
      const res = await fetch('/api/enrich-owner', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyName: name, state: companyState }),
      })
      if (!res.ok) return
      const data = await res.json()
      if (data.owner) { setOwnersName(data.owner); toast.success(`Found owner: ${data.owner}`) }
    } catch { /* silent */ } finally { setSearchingOwner(false) }
  }, [])

  const loadCompany = useCallback((c: Company) => {
    setResponse(c.reach_out_response ?? '')
    setNotes(c.notes ?? '')
    setOwnersName(c.owners_name ?? '')
    setPhoneNumber(c.phone_number ?? '')
    setState(c.state ?? '')
    setCompanyName(c.company_name ?? '')
    setCallStatus('idle')
    setCallSid('')
    setDuration(0)
    const noOwner = !c.owners_name || c.owners_name === 'Not found'
    if (noOwner && c.company_name) lookupOwner(c.company_name, c.state ?? '')
  }, [lookupOwner])

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
          body: JSON.stringify({ callerName: sessionCaller }),
        })
        if (!res.ok) { console.warn('Twilio token failed — calling disabled'); return }
        const { token, callerId: cid } = await res.json()
        if (destroyed) return
        setCallerId(cid)
        const device = new Device(token, { logLevel: 1, enableImprovedSignalingErrorPrecision: true })
        // Explicitly request echo cancellation + noise suppression on the mic
        // This is the #1 cause of echo in browser-based VoIP
        if (device.audio) {
          await device.audio.setAudioConstraints({
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          })
        }
        device.on('error', (err: Error) => toast.error(`Twilio: ${err.message}`))
        await device.register()
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

  // ── Call actions ─────────────────────────────────────────────
  async function handleCall() {
    if (!deviceRef.current || !phoneNumber || callStatus !== 'idle') return

    // Normalize to E.164 — strip all non-digits then prepend +1 if US
    const digits = phoneNumber.replace(/\D/g, '')
    const e164   = digits.startsWith('1') ? `+${digits}` : `+1${digits}`

    try {
      setCallStatus('connecting')
      const call = await deviceRef.current.connect({
        params: { To: e164, CallerId: callerId },
      })
      activeCallRef.current = call

      call.on('accept', () => {
        setCallStatus('connected')
        const sid = call.parameters?.CallSid ?? ''
        setCallSid(sid)
        // Persist callSid on the company so the recording webhook can match it
        if (company && sid) {
          patchCompany(company.id, { last_call_sid: sid } as Partial<Company>).catch(() => null)
        }
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
    } catch (err) {
      setCallStatus('idle')
      toast.error(`Could not start call: ${String(err)}`)
    }
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
    <div className="flex-1 overflow-y-auto flex flex-col items-center justify-start py-8 px-4">
      <div className="w-full max-w-2xl space-y-4">

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
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-500">
              Calling as <span className="text-gray-300 font-medium">{sessionCaller}</span>
              {callerId && <span className="text-gray-600 ml-1">via {callerId}</span>}
              <button onClick={() => setSessionCaller('')} className="ml-2 text-gray-600 hover:text-gray-400 text-xs underline">change</button>
            </span>
            <span className="text-sm text-gray-500">{index + 1} / {queue.length}</span>
          </div>
        )}

        {/* Progress */}
        <div className="w-full bg-gray-800 rounded-full h-1.5 overflow-hidden">
          <div className="h-1.5 bg-blue-500 rounded-full transition-all duration-300" style={{ width: `${progress}%` }} />
        </div>

        {/* Company card */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">

          {/* Name */}
          <div className="px-6 pt-6 pb-4 border-b border-gray-800">
            <label className="text-xs text-gray-500 uppercase tracking-wide font-medium">Company</label>
            <input value={companyName} onChange={e => setCompanyName(e.target.value)}
              className="mt-1 w-full bg-transparent text-2xl font-bold text-white focus:outline-none border-b border-transparent focus:border-gray-600 pb-1 transition-colors"
              placeholder="Company name" />
          </div>

          <div className="px-6 py-5 grid grid-cols-2 gap-5">

            {/* Phone + call controls */}
            <Field label="Phone Number">
              {callStatus === 'idle' || callStatus === 'ended' ? (
                <div className="flex items-center gap-2">
                  <a href={`tel:${phoneNumber}`} onClick={e => phoneNumber ? undefined : e.preventDefault()}
                    className="text-blue-400 hover:text-blue-300 text-base font-semibold transition-colors flex-1 truncate">
                    {phoneNumber || '—'}
                  </a>
                  {/* Twilio call button */}
                  {deviceReady && phoneNumber && (
                    <button onClick={handleCall}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 hover:bg-green-500 text-white rounded-lg text-xs font-semibold transition-colors">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
                      <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
                      </span>
                      {callStatus === 'connecting' ? 'Connecting…' : `In call · ${fmtDuration(duration)}`}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={handleMute}
                      className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                        isMuted ? 'border-yellow-600 bg-yellow-950/40 text-yellow-300' : 'border-gray-600 bg-gray-800 text-gray-300 hover:bg-gray-700'
                      }`}>
                      {isMuted ? '🔇 Muted' : '🎤 Mute'}
                    </button>
                    <button onClick={() => setShowDialpad(d => !d)}
                      className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                        showDialpad ? 'border-blue-600 bg-blue-950/40 text-blue-300' : 'border-gray-600 bg-gray-800 text-gray-300 hover:bg-gray-700'
                      }`}>
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                          d="M12 4v1m0 14v1M4 12H3m18 0h-1M6.34 6.34l-.7-.7m12.72 12.72l-.7-.7M6.34 17.66l-.7.7M19.06 4.94l-.7.7" />
                      </svg>
                      Keypad
                    </button>
                    <button onClick={handleHangup}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-red-700 bg-red-950/40 text-red-300 hover:bg-red-900/40 text-xs font-medium transition-colors">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                          d="M16 8l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2M5 3a16.003 16.003 0 0114 14m-1.34-3.34l-2.12-.36a2 2 0 00-1.9.7L12.5 15.5A15.045 15.045 0 018.5 11.5l1.47-2.07a2 2 0 00.7-1.9l-.36-2.12A2 2 0 008.35 3.5H5.5a2 2 0 00-2 2C3.5 14.314 9.686 20.5 18.5 20.5a2 2 0 002-2v-2.84a2 2 0 00-1.66-1.98z" />
                      </svg>
                      Hang up
                    </button>
                  </div>

                  {/* Dialpad */}
                  {showDialpad && (
                    <div className="mt-2 bg-gray-950 border border-gray-700 rounded-xl p-3 space-y-1.5">
                      {/* Display */}
                      <div className="h-7 flex items-center px-2 bg-gray-900 rounded-lg">
                        <span className="text-sm font-mono text-gray-300 tracking-widest flex-1 text-right">
                          {dialpadInput || <span className="text-gray-600">—</span>}
                        </span>
                        {dialpadInput && (
                          <button onClick={() => setDialpadInput(prev => prev.slice(0, -1))}
                            className="ml-2 text-gray-500 hover:text-gray-300 transition-colors">
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2M3 12l6.414 6.414a2 2 0 001.414.586H19a2 2 0 002-2V7a2 2 0 00-2-2h-8.172a2 2 0 00-1.414.586L3 12z" />
                            </svg>
                          </button>
                        )}
                      </div>
                      {/* Keys */}
                      {[['1','2','3'],['4','5','6'],['7','8','9'],['*','0','#']].map((row, ri) => (
                        <div key={ri} className="grid grid-cols-3 gap-1.5">
                          {row.map(key => (
                            <button key={key} onClick={() => sendDigit(key)}
                              className="h-9 rounded-lg bg-gray-800 hover:bg-gray-700 active:bg-gray-600 text-white font-semibold text-sm transition-colors border border-gray-700">
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
                className="mt-1 w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500 disabled:opacity-40" />
            </Field>

            {/* State */}
            <Field label="State">
              <select value={state} onChange={e => setState(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500">
                <option value="">—</option>
                {STATES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>

            {/* Owner */}
            <Field label={searchingOwner ? "Owner's Name (searching…)" : "Owner's Name"}>
              <div className="relative">
                <input value={ownersName} onChange={e => setOwnersName(e.target.value)}
                  placeholder={searchingOwner ? 'Searching…' : 'Unknown'}
                  className={`w-full bg-gray-800 border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 ${
                    searchingOwner ? 'border-blue-600 animate-pulse' : 'border-gray-700'
                  }`} />
                {searchingOwner && (
                  <div className="absolute right-2 top-1/2 -translate-y-1/2">
                    <svg className="w-4 h-4 animate-spin text-blue-400" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                    </svg>
                  </div>
                )}
              </div>
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
              <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
                placeholder="Add notes…"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 resize-none" />
            </Field>
          </div>

          {/* Outcome */}
          <div className="px-6 pb-6 border-t border-gray-800 pt-5 space-y-4">
            <Field label="Call Outcome">
              <div className="grid grid-cols-2 gap-2 mt-1">
                {RESPONSE_STATUSES.map(r => (
                  <button key={r} onClick={() => setResponse(r)}
                    className={`text-left px-3 py-2 rounded-lg border text-sm transition-colors ${
                      response === r ? getResponseButtonStyle(r) : 'border-gray-700 bg-gray-800 text-gray-400 hover:border-gray-600 hover:text-gray-300'
                    }`}>{r}</button>
                ))}
              </div>
            </Field>

            <div className="flex items-center gap-3 pt-2">
              <button onClick={handleBack} disabled={index === 0 || saving}
                className="px-4 py-2.5 rounded-xl border border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed text-sm font-medium transition-colors">
                ← Back
              </button>
              <button onClick={() => handleNext(true)} disabled={saving}
                className="px-4 py-2.5 rounded-xl border border-gray-700 bg-gray-800 text-gray-400 hover:bg-gray-700 disabled:opacity-50 text-sm font-medium transition-colors">
                Skip
              </button>
              <button onClick={() => handleNext(false)} disabled={saving || !response}
                className="flex-1 flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold text-sm transition-colors">
                {saving ? (
                  <><svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                  </svg>Saving…</>
                ) : (
                  <>Log & Next <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg></>
                )}
              </button>
            </div>
            {!response && <p className="text-xs text-gray-600 text-center">Select a call outcome to log and advance</p>}
          </div>

          {/* Link to recordings page */}
          <div className="border-t border-gray-800 px-6 py-3">
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
