export const dynamic = 'force-dynamic'

import { createClient } from '@/lib/supabase/server'
import type { Company } from '@/types'
import { format, parseISO, isPast, isToday } from 'date-fns'
import { Nav } from '@/components/Nav'

async function fetchIntroMeetings(): Promise<Company[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('companies')
    .select('*')
    .eq('reach_out_response', 'Intro-meeting wanted')
    .order('next_reach_out', { ascending: true, nullsFirst: false })
  return (data as Company[]) ?? []
}

function formatDate(d: string | null) {
  if (!d) return null
  try { return format(parseISO(d), 'MMM d, yyyy') } catch { return d }
}

function NextReachOutBadge({ date }: { date: string | null }) {
  if (!date) return <span className="text-gray-600 text-sm">—</span>
  const parsed = parseISO(date)
  const overdue = isPast(parsed) && !isToday(parsed)
  const today = isToday(parsed)
  return (
    <span className={`inline-flex items-center gap-1 text-sm font-medium ${
      overdue ? 'text-red-400' : today ? 'text-yellow-400' : 'text-green-400'
    }`}>
      {overdue && (
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
        </svg>
      )}
      {formatDate(date)}
    </span>
  )
}

export default async function MeetingsPage() {
  const companies = await fetchIntroMeetings()

  return (
    <div className="flex flex-col h-[100dvh] overflow-hidden bg-gray-950">
      <Nav />

      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="max-w-5xl mx-auto space-y-4">

          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-xl font-bold text-white">Intro Meetings</h1>
              <p className="text-sm text-gray-500 mt-0.5">
                {companies.length} compan{companies.length === 1 ? 'y' : 'ies'} want an intro meeting
              </p>
            </div>
            <div className="flex items-center gap-3 text-xs text-gray-500">
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-red-500 inline-block" />Overdue</span>
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-yellow-500 inline-block" />Today</span>
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-green-500 inline-block" />Upcoming</span>
            </div>
          </div>

          {companies.length === 0 ? (
            <div className="text-center py-24 text-gray-600">
              <svg className="w-12 h-12 mx-auto mb-3 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <p className="font-medium">No intro meetings yet</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {companies.map(c => (
                <MeetingCard key={c.id} company={c} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function MeetingCard({ company: c }: { company: Company }) {
  const nextDate = c.next_reach_out ? parseISO(c.next_reach_out) : null
  const overdue = nextDate && isPast(nextDate) && !isToday(nextDate)
  const today = nextDate && isToday(nextDate)

  return (
    <div className={`bg-gray-900 border rounded-2xl p-5 space-y-4 transition-colors ${
      overdue ? 'border-red-900/60' : today ? 'border-yellow-800/60' : 'border-gray-800'
    }`}>
      {/* Top row */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-white truncate">{c.company_name}</h2>
          {c.state && (
            <span className="text-xs text-gray-500 font-medium uppercase tracking-wider">{c.state}</span>
          )}
        </div>
        <span className="shrink-0 inline-flex items-center gap-1 px-2 py-1 bg-green-950/60 border border-green-800/50 rounded-full text-xs text-green-400 font-medium">
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          Intro wanted
        </span>
      </div>

      {/* Details grid */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-3">
        <Detail label="Owner">
          <span className="text-sm text-white">{c.owners_name || '—'}</span>
        </Detail>

        <Detail label="Phone">
          {c.phone_number ? (
            <a href={`tel:${c.phone_number}`} className="text-sm text-blue-400 hover:text-blue-300 transition-colors font-medium">
              {c.phone_number}
            </a>
          ) : (
            <span className="text-sm text-gray-600">—</span>
          )}
        </Detail>

        <Detail label="Last Contact">
          <span className="text-sm text-gray-300">{formatDate(c.last_reach_out) ?? '—'}</span>
        </Detail>

        <Detail label="Next Reach Out">
          <NextReachOutBadge date={c.next_reach_out} />
        </Detail>

        {c.google_reviews != null && (
          <Detail label="Google Reviews">
            <span className="text-sm text-gray-300">{c.google_reviews.toLocaleString()}</span>
          </Detail>
        )}

        {c.who_called && (
          <Detail label="Called By">
            <span className="text-sm text-gray-300">{c.who_called}</span>
          </Detail>
        )}
      </div>

      {/* Notes */}
      {c.notes && (
        <div className="pt-1 border-t border-gray-800">
          <p className="text-xs text-gray-500 uppercase tracking-wide font-medium mb-1">Notes</p>
          <p className="text-sm text-gray-300 whitespace-pre-wrap leading-relaxed">{c.notes}</p>
        </div>
      )}
    </div>
  )
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-gray-600 uppercase tracking-wide font-medium mb-0.5">{label}</p>
      {children}
    </div>
  )
}
