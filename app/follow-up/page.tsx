export const dynamic = 'force-dynamic'

import { createClient } from '@/lib/supabase/server'
import type { Company } from '@/types'
import { Nav } from '@/components/Nav'
import FollowUpQueue from '@/components/FollowUpQueue'

async function fetchDue(): Promise<{ high: Company[]; low: Company[] }> {
  const supabase = await createClient()
  const today = new Date().toISOString().slice(0, 10)

  const { data } = await supabase
    .from('companies')
    .select('*')
    .eq('reach_out_response', 'Intro-meeting wanted')
    .lte('next_reach_out', today)
    .order('next_reach_out', { ascending: true, nullsFirst: false })

  const rows = (data as Company[]) ?? []
  const byDate = (a: Company, b: Company) =>
    (a.next_reach_out ?? '9999-12-31').localeCompare(b.next_reach_out ?? '9999-12-31')

  return {
    high: rows.filter(c => c.meeting_priority === 'high').sort(byDate),
    low: rows.filter(c => c.meeting_priority !== 'high').sort(byDate),
  }
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
  const [{ high, low }, upcoming] = await Promise.all([fetchDue(), fetchUpcoming()])

  return (
    <div className="flex flex-col h-[100dvh] overflow-hidden bg-gray-950">
      <Nav />
      <div className="flex-1 overflow-y-auto">
        <FollowUpQueue highDue={high} lowDue={low} upcoming={upcoming} />
      </div>
    </div>
  )
}
