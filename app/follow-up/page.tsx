export const dynamic = 'force-dynamic'

import { createClient } from '@/lib/supabase/server'
import type { Company } from '@/types'
import { Nav } from '@/components/Nav'
import FollowUpQueue from '@/components/FollowUpQueue'

async function fetchDueFollowUps(): Promise<Company[]> {
  const supabase = await createClient()
  const today = new Date().toISOString().slice(0, 10)

  const { data } = await supabase
    .from('companies')
    .select('*')
    .eq('reach_out_response', 'Intro-meeting wanted')
    .lte('next_reach_out', today)
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

async function fetchUpcoming(): Promise<Company[]> {
  const supabase = await createClient()
  const today = new Date().toISOString().slice(0, 10)

  const { data } = await supabase
    .from('companies')
    .select('*')
    .eq('reach_out_response', 'Intro-meeting wanted')
    .gt('next_reach_out', today)
    .order('next_reach_out', { ascending: true })
    .limit(10)

  return (data as Company[]) ?? []
}

export default async function FollowUpPage() {
  const [due, upcoming] = await Promise.all([fetchDueFollowUps(), fetchUpcoming()])

  return (
    <div className="flex flex-col h-[100dvh] overflow-hidden bg-gray-950">
      <Nav />
      <div className="flex-1 overflow-y-auto">
        <FollowUpQueue initialDue={due} upcoming={upcoming} />
      </div>
    </div>
  )
}
