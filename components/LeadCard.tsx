'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { format, parseISO } from 'date-fns'

// One parked lead on /lead-behandling.
//
// The whole page is two fields: what happened, and when we touch it next. So
// the card commits both in a single action — you write the follow-up, pick the
// next date, and hit save once. Logging without a date is allowed (some calls
// end with "ring meg neste kvartal, ikke før"), but the card keeps saying it's
// undated so the lead can't quietly rot.
//
// Notes go to company_notes, the same log the dialer and DemoCard write to, so
// the lead's history stays in one place no matter which screen produced it.

export interface ConsideringLead {
  id: string
  company_name: string | null
  state: string | null
  phone_number: string | null
  owners_name: string | null
  next_reach_out: string | null
  last_reach_out: string | null
  who_called: string | null
  last_note: string | null
  last_note_by: string | null
  last_note_at: string | null
  note_count: number
}

interface Note {
  id: string
  note: string
  caller_name: string | null
  created_at: string
}

/** Day offsets for the quick-pick row — the cadence people actually use when
 *  a lead says "get back to me later". */
const PRESETS: { label: string; days: number }[] = [
  { label: '+3 d', days: 3 },
  { label: '+1 uke', days: 7 },
  { label: '+2 uker', days: 14 },
  { label: '+1 mnd', days: 30 },
]

function addDaysStr(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

function fmt(d: string | null): string | null {
  if (!d) return null
  try { return format(parseISO(d), 'd. MMM yyyy') } catch { return d }
}

function fmtStamp(iso: string | null): string | null {
  if (!iso) return null
  try { return format(new Date(iso), 'd. MMM yyyy') } catch { return iso }
}

export function LeadCard({ lead, today }: { lead: ConsideringLead; today: string }) {
  const [l, setL] = useState(lead)
  const [gone, setGone] = useState(false)
  const [saving, setSaving] = useState(false)
  const [expanded, setExpanded] = useState(false)

  const [note, setNote] = useState('')
  const [date, setDate] = useState(lead.next_reach_out ?? '')

  const [history, setHistory] = useState<Note[]>([])
  const [historyLoaded, setHistoryLoaded] = useState(false)
  const [loadingHistory, setLoadingHistory] = useState(false)

  const due = !!l.next_reach_out && l.next_reach_out <= today
  const undated = !l.next_reach_out

  async function patch(fields: Record<string, unknown>): Promise<boolean> {
    const res = await fetch(`/api/companies/${l.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fields),
    })
    return res.ok
  }

  /** The card's one action: append the follow-up to the log and move the next
   *  date, in that order. The note is the thing you'd hate to lose, so it goes
   *  first and the date only moves if it saved. */
  async function saveFollowUp() {
    const text = note.trim()
    const nextDate = date || null
    if (!text && nextDate === l.next_reach_out) {
      toast.error('Skriv en oppfølging eller sett en ny dato')
      return
    }
    setSaving(true)
    try {
      if (text) {
        const caller = typeof window !== 'undefined' ? localStorage.getItem('sessionCaller') : null
        const res = await fetch(`/api/companies/${l.id}/notes`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ note: text, caller_name: caller }),
        })
        if (!res.ok) throw new Error('note')
        const created: Note = await res.json()
        setHistory(prev => [created, ...prev])
        setL(prev => ({
          ...prev,
          last_note: created.note,
          last_note_by: created.caller_name,
          last_note_at: created.created_at,
          note_count: prev.note_count + 1,
        }))
        setNote('')
      }

      if (nextDate !== l.next_reach_out) {
        if (!(await patch({ next_reach_out: nextDate }))) throw new Error('date')
        setL(prev => ({ ...prev, next_reach_out: nextDate }))
      }

      toast.success(nextDate ? `Oppfølging lagret — neste ${fmt(nextDate)}` : 'Oppfølging lagret')
    } catch (err) {
      toast.error(
        err instanceof Error && err.message === 'date'
          ? 'Notatet ble lagret, men datoen feilet'
          : 'Kunne ikke lagre — prøv igjen',
      )
    } finally {
      setSaving(false)
    }
  }

  /** Resolve or un-park. Won/Lost close the lead out; clearing the outcome
   *  sends it back to the active demo list on /demos. Either way it leaves
   *  this page, so the row disappears. */
  async function resolve(outcome: string | null, label: string) {
    setSaving(true)
    try {
      if (!(await patch({ demo_outcome: outcome }))) throw new Error()
      setGone(true)
      toast.success(`${l.company_name ?? 'Lead'} → ${label}`)
    } catch {
      toast.error('Kunne ikke lagre — prøv igjen')
      setSaving(false)
    }
  }

  async function loadHistory() {
    if (historyLoaded || loadingHistory) return
    setLoadingHistory(true)
    try {
      const res = await fetch(`/api/companies/${l.id}/notes`)
      if (res.ok) setHistory(await res.json())
      setHistoryLoaded(true)
    } catch {
      /* history is context, not the point of the page — fail quiet */
    } finally {
      setLoadingHistory(false)
    }
  }

  function toggle() {
    const next = !expanded
    setExpanded(next)
    if (next) void loadHistory()
  }

  if (gone) return null

  return (
    <div className={`border rounded-xl overflow-hidden transition-all ${
      due ? 'bg-gray-900 border-amber-400/60' : 'bg-gray-900 border-gray-800'
    }`}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={expanded}
        className="w-full flex items-center gap-3 p-4 text-left"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-white truncate">
              {l.company_name ?? 'Unnamed company'}
            </span>
            {due && (
              <span className="shrink-0 rounded bg-amber-400 px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-black">
                Due
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-[11px] text-gray-500 mt-0.5">
            {l.state && <span>{l.state}</span>}
            {l.owners_name && <span>· {l.owners_name}</span>}
            <span className={undated ? 'text-gray-600 italic' : due ? 'text-amber-300' : ''}>
              · {undated ? 'ingen dato satt' : `neste ${fmt(l.next_reach_out)}`}
            </span>
            {l.note_count > 0 && <span>· {l.note_count} notat{l.note_count !== 1 ? 'er' : ''}</span>}
          </div>
          {l.last_note && !expanded && (
            <p className="mt-1 truncate text-xs text-gray-400">
              <span className="text-gray-600">
                {l.last_note_by ?? 'Ukjent'}
                {l.last_note_at ? ` ${fmtStamp(l.last_note_at)}` : ''}:
              </span>{' '}
              {l.last_note}
            </p>
          )}
        </div>
        {l.phone_number && (
          <a
            href={`tel:${l.phone_number}`}
            onClick={e => e.stopPropagation()}
            className="shrink-0 font-mono text-xs text-gray-400 hover:text-white transition-colors"
          >
            {l.phone_number}
          </a>
        )}
        <span className={`shrink-0 text-gray-600 transition-transform ${expanded ? 'rotate-180' : ''}`} aria-hidden>
          ▾
        </span>
      </button>

      {expanded && (
        <div className="border-t border-gray-800 p-4 space-y-4">

          {/* Log a follow-up + set the next date — one save for both */}
          <div className="space-y-2">
            <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">Logg oppfølging</p>
            <textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              rows={3}
              placeholder="Hva sa de? Hva venter vi på?"
              disabled={saving}
              className="w-full resize-y rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-white focus:outline-none disabled:opacity-40"
            />

            <div className="flex flex-wrap items-center gap-1.5">
              <input
                type="date"
                value={date}
                onChange={e => setDate(e.target.value)}
                disabled={saving}
                aria-label="Neste oppfølgingsdato"
                className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white [color-scheme:dark] focus:border-white focus:outline-none disabled:opacity-40"
              />
              {PRESETS.map(p => (
                <button
                  key={p.label}
                  type="button"
                  disabled={saving}
                  onClick={() => setDate(addDaysStr(p.days))}
                  className="rounded-md border border-gray-700 px-2 py-1.5 text-[11px] text-gray-400 hover:border-gray-500 hover:text-gray-200 disabled:opacity-40"
                >
                  {p.label}
                </button>
              ))}
              {date && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => setDate('')}
                  className="rounded-md px-2 py-1.5 text-[11px] text-gray-600 hover:text-gray-400 disabled:opacity-40"
                >
                  fjern dato
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={saveFollowUp}
              disabled={saving}
              className="w-full rounded-lg bg-white px-3 py-2 text-sm font-semibold text-black hover:bg-gray-200 disabled:opacity-40"
            >
              {saving ? 'Lagrer…' : 'Lagre oppfølging'}
            </button>
          </div>

          {/* Way out of the holding pen */}
          <div className="pt-3 border-t border-gray-800">
            <p className="text-xs text-gray-500 uppercase tracking-wide font-medium mb-2">Avslutt behandling</p>
            <div className="grid grid-cols-3 gap-1.5">
              <button
                type="button"
                disabled={saving}
                onClick={() => resolve('Won', 'Won')}
                className="rounded-lg border border-white bg-white px-2 py-1.5 text-xs font-bold text-black hover:bg-gray-200 disabled:opacity-40"
              >
                Won
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => resolve('Lost', 'Lost')}
                className="rounded-lg border border-gray-700 bg-gray-800 px-2 py-1.5 text-xs text-gray-400 hover:border-gray-500 hover:text-gray-200 disabled:opacity-40"
              >
                Lost
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => resolve(null, 'tilbake til Demos')}
                title="Fjerner utfallet og sender leaden tilbake til den aktive demo-listen."
                className="rounded-lg border border-gray-700 bg-gray-800 px-2 py-1.5 text-xs text-gray-400 hover:border-gray-500 hover:text-gray-200 disabled:opacity-40"
              >
                Til Demos
              </button>
            </div>
          </div>

          {/* Full log */}
          <div className="pt-3 border-t border-gray-800">
            <p className="text-xs text-gray-500 uppercase tracking-wide font-medium mb-2">Historikk</p>
            {loadingHistory && <p className="text-xs text-gray-500">Laster…</p>}
            {!loadingHistory && history.length === 0 && (
              <p className="text-xs text-gray-600">Ingen notater ennå.</p>
            )}
            <div className="space-y-2">
              {history.map(n => (
                <div key={n.id} className="rounded-lg bg-gray-800/60 px-3 py-2">
                  <div className="flex items-baseline gap-2">
                    <span className="text-xs font-medium text-gray-300">{n.caller_name ?? 'Ukjent'}</span>
                    <span className="text-[10px] text-gray-600">{fmtStamp(n.created_at)}</span>
                  </div>
                  <p className="mt-0.5 whitespace-pre-wrap text-xs text-gray-400">{n.note}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
