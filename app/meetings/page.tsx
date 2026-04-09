export const dynamic = 'force-dynamic'

import { createClient } from '@/lib/supabase/server'
import type { Company } from '@/types'
import { Nav } from '@/components/Nav'
import MeetingCardClient from '@/components/MeetingCardClient'
import Link from 'next/link'

type PriorityFilter = 'all' | 'high' | 'low' | 'unset'

async function fetchIntroMeetings(): Promise<Company[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('companies')
    .select('*')
    .eq('reach_out_response', 'Intro-meeting wanted')
    .order('next_reach_out', { ascending: true, nullsFirst: false })
  const rows = (data as Company[]) ?? []
  const rank = (p: Company['meeting_priority']) => (p === 'high' ? 0 : p === 'low' ? 1 : 2)
  return [...rows].sort((a, b) => {
    const pr = rank(a.meeting_priority) - rank(b.meeting_priority)
    if (pr !== 0) return pr
    const aDate = a.next_reach_out ?? '9999-12-31'
    const bDate = b.next_reach_out ?? '9999-12-31'
    return aDate.localeCompare(bDate)
  })
}

export default async function MeetingsPage({ searchParams }: { searchParams: Promise<{ priority?: string }> }) {
  const { priority: rawPriority } = await searchParams
  const priority: PriorityFilter =
    rawPriority === 'high' || rawPriority === 'low' || rawPriority === 'unset' ? rawPriority : 'all'
  const allCompanies = await fetchIntroMeetings()
  const highCount = allCompanies.filter(c => c.meeting_priority === 'high').length
  const lowCount = allCompanies.filter(c => c.meeting_priority === 'low').length
  const unsetCount = allCompanies.filter(c => !c.meeting_priority).length
  const companies = allCompanies.filter(c => {
    if (priority === 'high') return c.meeting_priority === 'high'
    if (priority === 'low') return c.meeting_priority === 'low'
    if (priority === 'unset') return !c.meeting_priority
    return true
  })

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

          <div className="flex gap-1 bg-gray-900 border border-gray-800 rounded-xl p-1 w-fit">
            <FilterLink href="/meetings" active={priority === 'all'} label="All" />
            <FilterLink href="/meetings?priority=high" active={priority === 'high'} label={`High (${highCount})`} />
            <FilterLink href="/meetings?priority=low" active={priority === 'low'} label={`Low (${lowCount})`} />
            <FilterLink href="/meetings?priority=unset" active={priority === 'unset'} label={`Unset (${unsetCount})`} />
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
                <MeetingCardClient key={c.id} company={c} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function FilterLink({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link
      href={href}
      className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
        active ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-800'
      }`}
    >
      {label}
    </Link>
  )
}
