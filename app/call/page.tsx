export const dynamic = 'force-dynamic'

import { createClient } from '@/lib/supabase/server'
import { CallingSession } from '@/components/CallingSession'
import { Nav } from '@/components/Nav'
import type { Company } from '@/types'

async function fetchQueue(): Promise<Company[]> {
  const supabase = await createClient()

  // 1. "Not called" — sorted by google reviews desc
  // 2. Everyone else (already contacted) — sorted by last_reach_out asc (oldest first)
  const [notCalled, previouslyContacted] = await Promise.all([
    // Include both explicit "Not called" and null (freshly imported companies)
    supabase
      .from('companies')
      .select('*')
      .or('reach_out_response.eq.Not called,reach_out_response.is.null')
      .order('google_reviews', { ascending: false, nullsFirst: false })
      .limit(5000),
    supabase
      .from('companies')
      .select('*')
      .not('reach_out_response', 'eq', 'Not called')
      .not('reach_out_response', 'is', null)
      .not('reach_out_response', 'in', '("Owner is not interested","Intro-meeting wanted","Already acquired","Not a garage door service company","Number does not exist")')
      .order('last_reach_out', { ascending: true, nullsFirst: true })
      .limit(2000),
  ])

  return [
    ...((notCalled.data as Company[]) ?? []),
    ...((previouslyContacted.data as Company[]) ?? []),
  ]
}

export default async function CallPage({ searchParams }: { searchParams: Promise<{ dial?: string }> }) {
  const [queue, params] = await Promise.all([fetchQueue(), searchParams])

  return (
    <div className="flex flex-col h-[100dvh] overflow-hidden bg-gray-950">
      <Nav />
      <CallingSession initialQueue={queue} dialNumber={params.dial} />
    </div>
  )
}
