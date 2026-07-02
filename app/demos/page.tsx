export const dynamic = 'force-dynamic'

import { query } from '@/lib/db'
import type { Company } from '@/types'
import { Nav } from '@/components/Nav'
import DemoCard from '@/components/DemoCard'

async function fetchBookedDemos(): Promise<Company[]> {
  // Resolved demos (Won/Lost) drop off the active list once an outcome is set.
  const rows = await query(
    `SELECT * FROM companies
     WHERE reach_out_response = 'Demo booked'
       AND (demo_outcome IS NULL OR demo_outcome NOT IN ('Won', 'Lost'))
     ORDER BY next_reach_out ASC NULLS LAST`
  )
  return rows as Company[]
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
            <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-gray-500">
              <span className="px-1.5 py-0.5 rounded bg-white text-black font-bold">Overdue</span>
              <span className="px-1.5 py-0.5 rounded border border-white text-white">Today</span>
              <span className="px-1.5 py-0.5 rounded border border-gray-700">Upcoming</span>
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
