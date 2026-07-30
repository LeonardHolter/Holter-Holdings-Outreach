'use client'

import { useState } from 'react'
import { toast } from 'sonner'

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
  who_called: string | null
  phone_number: string | null
  last_reach_out: string | null
}

export function WonRow({ company }: { company: WonCompany }) {
  const [saving, setSaving] = useState(false)
  const [gone, setGone] = useState(false)

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
          {company.who_called && <span>· closed by {company.who_called}</span>}
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
