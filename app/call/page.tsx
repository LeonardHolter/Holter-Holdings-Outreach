import { createClient } from '@/lib/supabase/server'
import { CallingSession } from '@/components/CallingSession'
import type { Company } from '@/types'

async function fetchQueue(): Promise<Company[]> {
  const supabase = await createClient()

  // 1. "Not called" — sorted by google reviews desc
  // 2. Everyone else (already contacted) — sorted by last_reach_out asc (oldest first)
  const [notCalled, previouslyContacted] = await Promise.all([
    supabase
      .from('companies')
      .select('*')
      .eq('reach_out_response', 'Not called')
      .order('google_reviews', { ascending: false, nullsFirst: false }),
    supabase
      .from('companies')
      .select('*')
      .not('reach_out_response', 'eq', 'Not called')
      .not('reach_out_response', 'is', null)
      .not('reach_out_response', 'in', '("Owner is not interested","Intro-meeting wanted")')
      .order('last_reach_out', { ascending: true, nullsFirst: true }),
  ])

  return [
    ...((notCalled.data as Company[]) ?? []),
    ...((previouslyContacted.data as Company[]) ?? []),
  ]
}

export default async function CallPage() {
  const queue = await fetchQueue()

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-gray-950">
      <header className="shrink-0 flex items-center justify-between px-4 h-12 border-b border-gray-800 bg-gray-900">
        <div className="flex items-center gap-4">
          <span className="font-semibold text-white text-sm">Holter Holdings</span>
          <nav className="flex items-center gap-1">
            <a href="/" className="text-sm text-gray-400 hover:text-gray-200 px-3 py-1.5 rounded-lg hover:bg-gray-800 transition-colors">Pipeline</a>
            <span className="text-sm font-medium text-white bg-gray-800 px-3 py-1.5 rounded-lg">Calling</span>
            <a href="/meetings" className="text-sm text-gray-400 hover:text-gray-200 px-3 py-1.5 rounded-lg hover:bg-gray-800 transition-colors">Meetings</a>
            <a href="/stats" className="text-sm text-gray-400 hover:text-gray-200 px-3 py-1.5 rounded-lg hover:bg-gray-800 transition-colors">Stats</a>
          </nav>
        </div>
        <form action="/api/auth/signout" method="POST">
          <button type="submit" className="text-gray-400 hover:text-gray-200 text-sm px-3 py-1.5 rounded-lg hover:bg-gray-800 transition-colors">
            Sign out
          </button>
        </form>
      </header>

      <CallingSession initialQueue={queue} />
    </div>
  )
}
