export const dynamic = 'force-dynamic'

import { createClient } from '@/lib/supabase/server'
import type { Company } from '@/types'
import { Nav } from '@/components/Nav'
import DemoCard from '@/components/DemoCard'

async function fetchBookedDemos(): Promise<Company[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('companies')
    .select('*')
    .eq('reach_out_response', 'Demo booked')
    .order('next_reach_out', { ascending: true, nullsFirst: false })
  return (data as Company[]) ?? []
}

export default async function DemosPage() {
  const demos = await fetchBookedDemos()

  return (
    <div className="flex flex-col h-[100dvh] overflow-hidden bg-gray-950">
      <Nav />

      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="max-w-3xl mx-auto space-y-6">

          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold text-white">Booked Demos</h1>
              <p className="text-sm text-gray-500 mt-0.5">
                {demos.length} demo{demos.length !== 1 ? 's' : ''} scheduled
              </p>
            </div>
            <div className="flex items-center gap-3 text-xs text-gray-500">
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-red-500 inline-block" />Overdue</span>
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-yellow-500 inline-block" />Today</span>
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-green-500 inline-block" />Upcoming</span>
            </div>
          </div>

          {demos.length === 0 ? (
            <div className="text-center py-16">
              <div className="w-16 h-16 rounded-full bg-gray-800 border border-gray-700 flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </div>
              <h2 className="text-lg font-semibold text-white">No demos booked yet</h2>
              <p className="text-sm text-gray-500 mt-1">Companies with &quot;Demo booked&quot; outcome will appear here</p>
            </div>
          ) : (
            <div className="space-y-3">
              {demos.map(c => (
                <DemoCard key={c.id} company={c} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
