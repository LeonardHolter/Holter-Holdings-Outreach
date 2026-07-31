export const dynamic = 'force-dynamic'

import { query } from '@/lib/db'
import { Nav } from '@/components/Nav'
import { LeadCard, type ConsideringLead } from '@/components/LeadCard'
import { UNDER_CONSIDERATION } from '@/types'

// Lead behandling — the holding pen for demos parked "Under consideration".
//
// A lead lands here the moment its demo outcome is set to that, which also
// takes it off /demos: the fixed post-demo touchpoint cadence has run its
// course and what's left is open-ended nurturing. So this page runs on two
// fields instead — a logged follow-up (company_notes) and a next follow-up
// date (companies.next_reach_out) — and the lead leaves the moment it turns
// into Won or Lost.
//
// Ordered by next follow-up, soonest first, with undated leads last: the ones
// you owe a call today belong at the top, and a lead with no date at all is
// the one nobody has decided about.

async function fetchConsideringLeads(): Promise<ConsideringLead[]> {
  const rows = await query(
    `SELECT c.id, c.company_name, c.state, c.phone_number, c.owners_name,
            c.next_reach_out, c.last_reach_out, c.who_called,
            n.last_note, n.last_note_by, n.last_note_at,
            COALESCE(n.note_count, 0)::int AS note_count
     FROM companies c
     LEFT JOIN LATERAL (
       SELECT
         (ARRAY_AGG(note ORDER BY created_at DESC))[1]        AS last_note,
         (ARRAY_AGG(caller_name ORDER BY created_at DESC))[1] AS last_note_by,
         MAX(created_at)                                      AS last_note_at,
         COUNT(*)                                             AS note_count
       FROM company_notes
       WHERE company_id = c.id
     ) n ON true
     WHERE c.demo_outcome = $1
     ORDER BY c.next_reach_out ASC NULLS LAST, c.company_name ASC`,
    [UNDER_CONSIDERATION],
  )

  const toDay = (v: unknown) =>
    v instanceof Date ? v.toISOString().slice(0, 10) : (v as string | null)

  return (rows as Record<string, unknown>[]).map(r => ({
    id: r.id as string,
    company_name: r.company_name as string | null,
    state: r.state as string | null,
    phone_number: r.phone_number as string | null,
    owners_name: r.owners_name as string | null,
    next_reach_out: toDay(r.next_reach_out),
    last_reach_out: toDay(r.last_reach_out),
    who_called: r.who_called as string | null,
    last_note: r.last_note as string | null,
    last_note_by: r.last_note_by as string | null,
    last_note_at: r.last_note_at instanceof Date ? r.last_note_at.toISOString() : (r.last_note_at as string | null),
    note_count: Number(r.note_count) || 0,
  }))
}

export default async function LeadBehandlingPage() {
  const leads = await fetchConsideringLeads()
  const today = new Date().toISOString().slice(0, 10)
  const due = leads.filter(l => l.next_reach_out && l.next_reach_out <= today).length
  const undated = leads.filter(l => !l.next_reach_out).length

  return (
    <div className="flex flex-col h-[100dvh] overflow-hidden bg-gray-950">
      <Nav />

      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="max-w-3xl mx-auto space-y-6">

          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-xl font-bold text-white">Lead behandling</h1>
              <p className="text-sm text-gray-500 mt-0.5">
                {leads.length} lead{leads.length !== 1 ? 's' : ''} under consideration
                {due > 0 && <span className="text-amber-300"> · {due} due now</span>}
                {undated > 0 && <span className="text-gray-500"> · {undated} without a date</span>}
              </p>
            </div>
            <div className="hidden sm:flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-gray-500">
              <span className="px-1.5 py-0.5 rounded bg-amber-400 text-black font-bold">Due</span>
              <span className="px-1.5 py-0.5 rounded border border-gray-700">Scheduled</span>
            </div>
          </div>

          {leads.length === 0 ? (
            <div className="text-center py-16">
              <div className="w-16 h-16 rounded-full bg-gray-800 border border-gray-700 flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h2 className="text-lg font-semibold text-white">Ingen leads under behandling</h2>
              <p className="text-sm text-gray-500 mt-1">
                Mark a demo &ldquo;{UNDER_CONSIDERATION}&rdquo; on the Demos page and it lands here.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {leads.map(l => (
                <LeadCard key={l.id} lead={l} today={today} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
