export const dynamic = 'force-dynamic'

import { createClient } from '@/lib/supabase/server'
import { Nav } from '@/components/Nav'
import NumberHealthClient from '@/components/NumberHealthClient'
import NumbersInbox from '@/components/NumbersInbox'

async function fetchTodayUsage(): Promise<Record<string, number>> {
  const supabase = await createClient()
  const today = new Date().toISOString().slice(0, 10)
  const { data } = await supabase
    .from('number_daily_usage')
    .select('number, dial_count')
    .eq('date', today)
  const map: Record<string, number> = {}
  for (const row of data ?? []) map[row.number] = row.dial_count
  return map
}

async function fetchInboxData() {
  const supabase = await createClient()
  const [{ data: msgs }, { data: calls }] = await Promise.all([
    supabase
      .from('incoming_messages')
      .select('id, twilio_sid, from_number, to_number, body, direction, status, created_at')
      .order('created_at', { ascending: true })
      .limit(500),
    supabase
      .from('incoming_calls')
      .select('id, twilio_sid, from_number, to_number, status, duration_seconds, called_at')
      .order('called_at', { ascending: false })
      .limit(200),
  ])
  return { messages: msgs ?? [], calls: calls ?? [] }
}

export default async function NumbersPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>
}) {
  const { tab: rawTab } = await searchParams
  const tab = rawTab === 'inbox' ? 'inbox' : 'health'

  const numbers = (process.env.TWILIO_PHONE_NUMBERS ?? '')
    .split(',').map(n => n.trim()).filter(Boolean)

  const [usageMap, { messages, calls }] = await Promise.all([
    fetchTodayUsage(),
    fetchInboxData(),
  ])

  const initial = numbers.map(n => ({
    number: n,
    dialCount: usageMap[n] ?? 0,
    dailyCap: 80,
  }))

  const inboundCount = (messages as { direction: string }[]).filter(m => m.direction === 'inbound').length

  return (
    <div className="flex flex-col min-h-[100dvh] bg-gray-950">
      <Nav />
      <main className="flex-1 max-w-4xl w-full mx-auto px-4 sm:px-6 py-8 space-y-6">

        {/* Header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-white">Numbers</h1>
            <p className="text-gray-500 text-sm mt-1">
              {numbers.length} number{numbers.length !== 1 ? 's' : ''} configured
            </p>
          </div>
        </div>

        {numbers.length === 0 ? (
          <div className="text-center py-16 text-gray-600">
            <p>No phone numbers configured.</p>
            <p className="text-sm mt-1">Set <code className="text-gray-400">TWILIO_PHONE_NUMBERS</code> in your environment.</p>
          </div>
        ) : (
          <>
            {/* Tab bar */}
            <div className="flex gap-1 bg-gray-900 border border-gray-800 rounded-xl p-1 w-fit">
              <TabLink href="/numbers?tab=health" active={tab === 'health'} label="Health" />
              <TabLink
                href="/numbers?tab=inbox"
                active={tab === 'inbox'}
                label="Inbox"
                badge={inboundCount > 0 ? String(inboundCount) : undefined}
              />
            </div>

            {/* Content */}
            {tab === 'health' ? (
              <NumberHealthClient initial={initial} />
            ) : (
              <NumbersInbox
                numbers={numbers}
                initialMessages={messages as Parameters<typeof NumbersInbox>[0]['initialMessages']}
                initialCalls={calls as Parameters<typeof NumbersInbox>[0]['initialCalls']}
              />
            )}
          </>
        )}
      </main>
    </div>
  )
}

function TabLink({
  href, active, label, badge,
}: { href: string; active: boolean; label: string; badge?: string }) {
  return (
    <a
      href={href}
      className={`relative px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
        active ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-800'
      }`}
    >
      {label}
      {badge && (
        <span className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 rounded-full text-xs text-white flex items-center justify-center font-bold">
          {Number(badge) > 9 ? '9+' : badge}
        </span>
      )}
    </a>
  )
}
