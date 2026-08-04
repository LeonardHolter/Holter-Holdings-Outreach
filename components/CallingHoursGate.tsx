'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { CALL_CUTOFF_HOUR, isCallingClosed } from '@/lib/callingHours'

// Wraps the calling surface on /call. After 16:00 Oslo time the dialer —
// hero call button, manual dial panel, tel: links, everything — is replaced
// with a closed screen until midnight. Re-checked every 30s so a session
// left open at 15:59 closes itself at 16:00 instead of quietly allowing
// one more dial.

export function CallingHoursGate({ children }: { children: ReactNode }) {
  // Start closed=false and correct after mount: the server renders this at
  // request time, and a mismatched first client render would trip hydration.
  const [closed, setClosed] = useState(false)

  useEffect(() => {
    const check = () => setClosed(isCallingClosed())
    check()
    const id = setInterval(check, 30_000)
    return () => clearInterval(id)
  }, [])

  if (!closed) return <>{children}</>

  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-6 text-center px-4">
      <div className="w-16 h-16 rounded-full bg-gray-800 border border-gray-700 flex items-center justify-center">
        <svg className="w-8 h-8 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      </div>
      <div>
        <h2 className="text-2xl font-bold text-white">Ringetiden er over</h2>
        <p className="text-gray-400 mt-1">
          Ingen samtaler etter kl. {CALL_CUTOFF_HOUR}:00 — køen åpner igjen i morgen.
        </p>
      </div>
      <div className="flex gap-3">
        <a href="/stats" className="px-4 py-2 bg-white hover:bg-gray-200 text-black rounded-lg text-sm transition-colors">
          Se dagens stats
        </a>
        <a href="/lead-behandling" className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-lg text-sm transition-colors">
          Lead behandling
        </a>
      </div>
    </div>
  )
}
