export const dynamic = 'force-dynamic'

import { createClient } from '@/lib/supabase/server'
import type { Company } from '@/types'
import { Nav } from '@/components/Nav'
import MeetingCardClient from '@/components/MeetingCardClient'
import Link from 'next/link'

async function fetchIntroMeetings(): Promise<Company[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('companies')
    .select('*')
    .eq('reach_out_response', 'Intro-meeting wanted')
    .order('next_reach_out', { ascending: true, nullsFirst: false })
  return (data as Company[]) ?? []
}

export default async function MeetingsPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const { view } = await searchParams
  const showAll = view === 'all'

  const all   = await fetchIntroMeetings()
  const high  = all.filter(c => c.meeting_priority === 'high')
  const other = all.filter(c => c.meeting_priority !== 'high')

  const displayed = showAll ? other : high

  return (
    <div className="flex flex-col h-[100dvh] overflow-hidden bg-gray-950">
      <Nav />

      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="max-w-5xl mx-auto space-y-6">

          {/* Page header */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold text-white">Intro Meetings</h1>
              <p className="text-sm text-gray-500 mt-0.5">
                {all.length} compan{all.length === 1 ? 'y' : 'ies'} total
              </p>
            </div>
            <div className="flex items-center gap-3 text-xs text-gray-500">
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-red-500 inline-block" />Overdue</span>
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-yellow-500 inline-block" />Today</span>
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-green-500 inline-block" />Upcoming</span>
            </div>
          </div>

          {/* Toggle tabs */}
          <div className="flex gap-1 bg-gray-900 border border-gray-800 rounded-xl p-1 w-fit">
            <Link
              href="/meetings"
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${
                !showAll ? 'bg-red-600 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-800'
              }`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-current opacity-80" />
              High Priority
              <span className={`text-xs ${!showAll ? 'text-red-200' : 'text-gray-600'}`}>{high.length}</span>
            </Link>
            <Link
              href="/meetings?view=all"
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${
                showAll ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-800'
              }`}
            >
              Other
              <span className={`text-xs ${showAll ? 'text-gray-300' : 'text-gray-600'}`}>{other.length}</span>
            </Link>
          </div>

          {all.length === 0 && (
            <div className="text-center py-24 text-gray-600">
              <svg className="w-12 h-12 mx-auto mb-3 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <p className="font-medium">No intro meetings yet</p>
            </div>
          )}

          {all.length > 0 && displayed.length === 0 && (
            <div className="text-center py-16 text-gray-600">
              <p className="text-sm">{showAll ? 'No other leads.' : 'No high priority leads yet — mark some as high priority.'}</p>
            </div>
          )}

          {displayed.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {displayed.map(c => (
                <MeetingCardClient key={c.id} company={c} />
              ))}
            </div>
          )}

        </div>
      </div>
    </div>
  )
}
