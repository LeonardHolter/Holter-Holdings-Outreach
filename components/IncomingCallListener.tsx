'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { toast } from 'sonner'

function fmt(s: number) {
  const m = Math.floor(s / 60), sec = s % 60
  return `${m}:${sec.toString().padStart(2, '0')}`
}

function fmtNumber(n: string): string {
  const d = n.replace(/\D/g, '')
  if (d.length === 11 && d[0] === '1') return `+1 (${d.slice(1,4)}) ${d.slice(4,7)}-${d.slice(7)}`
  if (d.length === 10) return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`
  return n
}

export default function IncomingCallListener() {
  const pathname = usePathname()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const deviceRef    = useRef<any>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const activeCallRef = useRef<any>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const [incomingFrom, setIncomingFrom] = useState<string | null>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [pendingCall, setPendingCall] = useState<any>(null)
  const [callStatus, setCallStatus] = useState<'idle' | 'connecting' | 'connected'>('idle')
  const [duration, setDuration] = useState(0)
  const [isMuted, setIsMuted] = useState(false)

  // Skip on /call — CallingSession handles it there to avoid duplicate devices
  const isOnCallPage = pathname === '/call'

  useEffect(() => {
    if (isOnCallPage) return

    let destroyed = false
    const caller = localStorage.getItem('sessionCaller')
    if (!caller) return

    async function init() {
      try {
        const { Device } = await import('@twilio/voice-sdk')
        const res = await fetch('/api/twilio/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ callerName: caller }),
        })
        if (!res.ok || destroyed) return
        const { token } = await res.json()
        if (destroyed) return

        const device = new Device(token, { logLevel: 1, enableImprovedSignalingErrorPrecision: true })
        if (device.audio) {
          await device.audio.setAudioConstraints({
            echoCancellation: true, noiseSuppression: true, autoGainControl: true,
          })
        }
        await device.register()
        if (destroyed) { device.destroy(); return }
        deviceRef.current = device

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        device.on('incoming', (call: any) => {
          if (activeCallRef.current) { call.reject(); return }
          const from = call.parameters?.From ?? 'Unknown'
          setIncomingFrom(from)
          setPendingCall(call)
          call.on('cancel', () => { setIncomingFrom(null); setPendingCall(null) })
        })
      } catch (e) {
        console.warn('IncomingCallListener init failed:', e)
      }
    }

    init()
    return () => {
      destroyed = true
      clearInterval(timerRef.current!)
      deviceRef.current?.destroy()
      deviceRef.current = null
    }
  }, [isOnCallPage])

  function handleAccept() {
    if (!pendingCall) return
    const call = pendingCall
    call.on('accept', () => {
      setCallStatus('connected')
      timerRef.current = setInterval(() => setDuration(d => d + 1), 1000)
    })
    call.on('disconnect', () => {
      clearInterval(timerRef.current!)
      activeCallRef.current = null
      setCallStatus('idle')
      setDuration(0)
      setIsMuted(false)
      toast('Call ended')
    })
    call.on('error', (err: Error) => {
      clearInterval(timerRef.current!)
      activeCallRef.current = null
      setCallStatus('idle')
      toast.error(`Call error: ${err.message}`)
    })
    activeCallRef.current = call
    setCallStatus('connecting')
    setIncomingFrom(null)
    setPendingCall(null)
    call.accept()
  }

  function handleReject() {
    pendingCall?.reject()
    setIncomingFrom(null)
    setPendingCall(null)
  }

  function handleHangup() {
    activeCallRef.current?.disconnect()
  }

  function handleMute() {
    if (!activeCallRef.current) return
    const next = !isMuted
    activeCallRef.current.mute(next)
    setIsMuted(next)
  }

  // Nothing to show
  if (isOnCallPage || (!incomingFrom && callStatus === 'idle')) return null

  return (
    <div className="fixed inset-x-0 top-0 z-50 flex justify-center px-4 pt-4 pointer-events-none">
      <div className="w-full max-w-sm pointer-events-auto">

        {/* ── Incoming call ── */}
        {incomingFrom && callStatus === 'idle' && (
          <div className="bg-gray-900 border-2 border-green-600 rounded-2xl shadow-2xl shadow-green-900/40 overflow-hidden">
            <div className="h-1 bg-green-500 animate-pulse" />
            <div className="px-5 py-4">
              <div className="flex items-center gap-3 mb-4">
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
                  <p className="text-white font-bold text-lg truncate">{fmtNumber(incomingFrom)}</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <button onClick={handleReject}
                  className="flex items-center justify-center gap-2 py-3 rounded-xl bg-red-900/60 border border-red-700 text-red-300 font-semibold text-sm hover:bg-red-900/80 transition-colors touch-manipulation">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 8l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2M5 3a16.003 16.003 0 0114 14m-1.34-3.34l-2.12-.36a2 2 0 00-1.9.7L12.5 15.5A15.045 15.045 0 018.5 11.5l1.47-2.07a2 2 0 00.7-1.9l-.36-2.12A2 2 0 008.35 3.5H5.5a2 2 0 00-2 2C3.5 14.314 9.686 20.5 18.5 20.5a2 2 0 002-2v-2.84a2 2 0 00-1.66-1.98z" />
                  </svg>
                  Decline
                </button>
                <button onClick={handleAccept}
                  className="flex items-center justify-center gap-2 py-3 rounded-xl bg-green-700 hover:bg-green-600 border border-green-600 text-white font-semibold text-sm transition-colors touch-manipulation">
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/>
                  </svg>
                  Accept
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Active call mini-bar ── */}
        {callStatus !== 'idle' && (
          <div className="bg-gray-900 border border-green-700 rounded-2xl shadow-2xl overflow-hidden">
            <div className="h-1 bg-green-500" />
            <div className="px-4 py-3 flex items-center gap-3">
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <span className="relative flex h-2.5 w-2.5 shrink-0">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
                </span>
                <span className="text-sm font-semibold text-green-400">
                  {callStatus === 'connecting' ? 'Connecting…' : `In call · ${fmt(duration)}`}
                </span>
              </div>
              <button onClick={handleMute}
                className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors touch-manipulation ${
                  isMuted ? 'border-yellow-600 bg-yellow-950/40 text-yellow-300' : 'border-gray-600 bg-gray-800 text-gray-300'
                }`}>
                {isMuted ? '🔇 Muted' : '🎤 Mute'}
              </button>
              <button onClick={handleHangup}
                className="px-3 py-1.5 rounded-lg border border-red-700 bg-red-950/40 text-red-300 text-xs font-medium transition-colors touch-manipulation">
                Hang up
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
