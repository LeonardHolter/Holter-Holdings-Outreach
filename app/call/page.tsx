import { createClient } from '@/lib/supabase/server'
import { CallingSession } from '@/components/CallingSession'
import type { Company } from '@/types'

async function fetchQueue(): Promise<Company[]> {
  const supabase = await createClient()

  // Fetch "Not called" first (sorted by reviews), then the rest
  const [notCalled, rest] = await Promise.all([
    supabase
      .from('companies')
      .select('*')
      .eq('reach_out_response', 'Not called')
      .order('google_reviews', { ascending: false, nullsFirst: false }),
    supabase
      .from('companies')
      .select('*')
      .in('reach_out_response', ['Call back on Monday', 'Left a message to the owner', 'Did not pick up', 'Did not reach the Owner'])
      .order('google_reviews', { ascending: false, nullsFirst: false }),
  ])

  return [
    ...((notCalled.data as Company[]) ?? []),
    ...((rest.data as Company[]) ?? []),
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
