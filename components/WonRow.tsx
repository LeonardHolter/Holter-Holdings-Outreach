'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { TEAM_MEMBERS } from '@/types'

// A won customer, with a way back out.
//
// Why this needs to exist: the active demo list excludes Won/Lost, so the
// moment an outcome is set the DemoCard — and with it the only control that
// could unset that outcome — disappears from the app. A demo marked Won by
// mistake was unreachable. "Undo win" clears demo_outcome, which returns the
// company to the active list where the full card takes over again.

export interface WonCompany {
  id: string
  company_name: string | null
  state: string | null
  phone_number: string | null
  last_reach_out: string | null
  /** Best-effort attribution: whoever booked the demo, else the last caller,
   *  else the only person who ever dialled it. Null when nothing was logged —
   *  which happens when a company is marked Won by hand in the Companies
   *  table, since who_called is only written by the dialer. */
  closedBy: string | null
}

export function WonRow({ company }: { company: WonCompany }) {
  const [saving, setSaving] = useState(false)
  const [gone, setGone] = useState(false)
  const [closedBy, setClosedBy] = useState(company.closedBy)

  /** Attribute (or re-attribute) the win. Writes who_called, which is the
   *  field the dialer would have set — so a hand-marked win can be credited
   *  without touching the Companies table.
   *
   *  Caveat worth knowing: if a 'Demo booked' call_event exists with a
   *  different caller, that event still wins on reload, because whoever
   *  actually booked the demo is better evidence than a manual edit. In
   *  practice the rows that show no closer have no such event. */
  async function setCloser(name: string) {
    const next = name || null
    setSaving(true)
    try {
      const res = await fetch(`/api/companies/${company.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ who_called: next }),
      })
      if (!res.ok) throw new Error('failed')
      setClosedBy(next)
      toast.success(next ? `Credited to ${next}` : 'Closer cleared')
    } catch {
      toast.error('Could not save — try again')
    } finally {
      setSaving(false)
    }
  }

  async function undoWin() {
    setSaving(true)
    try {
      const res = await fetch(`/api/companies/${company.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ demo_outcome: null }),
      })
      if (!res.ok) throw new Error('failed')
      setGone(true)
      toast.success(`${company.company_name ?? 'Company'} moved back to booked demos`)
    } catch {
      toast.error('Could not undo — try again')
    } finally {
      setSaving(false)
    }
  }

  if (gone) return null

  return (
    <div className="flex items-center gap-3 px-4 py-3 bg-gray-900/40">
      <span className="text-sm shrink-0" aria-hidden>🏆</span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-white truncate">
          {company.company_name ?? 'Unnamed company'}
        </div>
        <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-[11px] text-gray-500">
          {company.state && <span>{company.state}</span>}
          {/* Editable in place: a win with no closer used to send you off to
              the Companies table to fix it. Now you credit it where you see
              the gap. */}
          <span className="flex items-center gap-1">
            <span aria-hidden>·</span>
            <select
              value={closedBy ?? ''}
              disabled={saving}
              onChange={e => void setCloser(e.target.value)}
              aria-label="Who closed this deal"
              title="Who closed this deal. Blank means nothing was logged — who_called is only written automatically when an outcome is saved through the dialer."
              className={`cursor-pointer rounded border border-transparent bg-transparent py-0 pl-0 pr-4 text-[11px] hover:border-gray-700 focus:border-gray-600 focus:outline-none disabled:opacity-40 ${
                closedBy ? 'text-gray-500' : 'italic text-gray-600'
              }`}
            >
              <option value="">closer not set</option>
              {TEAM_MEMBERS.map(m => (
                <option key={m} value={m}>closed by {m}</option>
              ))}
            </select>
          </span>
          {company.last_reach_out && <span>· {company.last_reach_out}</span>}
        </div>
      </div>
      {company.phone_number && (
        <a
          href={`tel:${company.phone_number}`}
          className="shrink-0 font-mono text-xs text-gray-400 hover:text-white transition-colors"
        >
          {company.phone_number}
        </a>
      )}
      <button
        type="button"
        onClick={undoWin}
        disabled={saving}
        title="Clears the Won outcome and returns this company to the booked-demo list, where you can change the outcome or drop it entirely."
        className="shrink-0 rounded-md border border-gray-700 px-2 py-1 text-[11px] text-gray-400 hover:border-gray-500 hover:text-gray-200 disabled:opacity-40"
      >
        {saving ? 'Undoing…' : 'Undo win'}
      </button>
    </div>
  )
}
