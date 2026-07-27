'use client'

import { useEffect, useState } from 'react'

// Click-to-call over Telnyx: pick an eligible from-number (the account's
// numbers minus every line serving a KI Consult customer — enforced
// server-side, this UI just mirrors it), enter/receive the lead's number,
// and the system rings YOUR phone first, then bridges to the lead.
// Collapsed by default so the Twilio flow keeps its screen estate.

type FromNumber = { id: string; phoneNumber: string; digits: string }
type NumbersResp = { configured: boolean; reason?: string; numbers: FromNumber[]; error?: string }

export function TelnyxDialPanel({ prefillNumber }: { prefillNumber?: string }) {
  const [open, setOpen] = useState(false)
  const [info, setInfo] = useState<NumbersResp | null>(null)
  const [from, setFrom] = useState('')
  const [lead, setLead] = useState(prefillNumber ?? '')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string | null>(null)

  useEffect(() => {
    if (!open || info) return
    fetch('/api/telnyx/numbers', { cache: 'no-store' })
      .then(r => r.json())
      .then((d: NumbersResp) => {
        setInfo(d)
        if (d.numbers?.length === 1) setFrom(d.numbers[0].phoneNumber)
      })
      .catch(() => setInfo({ configured: true, numbers: [], error: 'Kunne ikke hente numre' }))
  }, [open, info])

  async function call() {
    setBusy(true)
    setStatus(null)
    try {
      const res = await fetch('/api/telnyx/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: lead }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? 'Oppringing feilet')
      setStatus(`Ringer telefonen din nå fra ${body.from} - svar, så kobles leadet på.`)
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Noe gikk galt')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="shrink-0 border-b border-gray-800 bg-gray-900/60">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-2 px-4 py-1.5 text-xs font-semibold text-gray-400 hover:text-gray-200"
      >
        <span>{open ? '▾' : '▸'}</span> Telnyx-oppringing (eget nummer, aldri kundenes)
      </button>

      {open && (
        <div className="px-4 pb-3 flex flex-wrap items-center gap-2 text-sm">
          {!info ? (
            <span className="text-gray-500 text-xs">Henter numre…</span>
          ) : !info.configured ? (
            <span className="text-amber-400 text-xs">{info.reason}</span>
          ) : info.error ? (
            <span className="text-red-400 text-xs">
              {info.error} - ringer ikke uten verifisert nummerliste.
            </span>
          ) : info.numbers.length === 0 ? (
            <span className="text-amber-400 text-xs">
              Ingen ledige Telnyx-numre - alle er i bruk av kunder. Kjøp et eget outreach-nummer i Telnyx-portalen.
            </span>
          ) : (
            <>
              <select
                value={from}
                onChange={e => setFrom(e.target.value)}
                className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-gray-200 text-xs"
              >
                <option value="">Fra-nummer…</option>
                {info.numbers.map(n => (
                  <option key={n.id} value={n.phoneNumber}>{n.phoneNumber}</option>
                ))}
              </select>
              <input
                value={lead}
                onChange={e => setLead(e.target.value)}
                placeholder="Leadets nummer (+47…)"
                className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-gray-200 text-xs w-44"
              />
              <button
                type="button"
                onClick={call}
                disabled={busy || !from || lead.replace(/\D/g, '').length < 8}
                className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-xs font-semibold rounded px-3 py-1"
              >
                {busy ? 'Ringer…' : 'Ring via Telnyx'}
              </button>
            </>
          )}
          {status && <span className="text-gray-300 text-xs w-full">{status}</span>}
        </div>
      )}
    </div>
  )
}
