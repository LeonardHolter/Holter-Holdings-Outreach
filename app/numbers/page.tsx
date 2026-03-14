export const dynamic = 'force-dynamic'

import { createClient } from '@/lib/supabase/server'
import { Nav } from '@/components/Nav'
import NumberHealthClient from '@/components/NumberHealthClient'

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

export default async function NumbersPage() {
  const numbers = (process.env.TWILIO_PHONE_NUMBERS ?? '')
    .split(',').map(n => n.trim()).filter(Boolean)

  const usageMap = await fetchTodayUsage()

  const initial = numbers.map(n => ({
    number: n,
    dialCount: usageMap[n] ?? 0,
    dailyCap: 80,
  }))

  return (
    <div className="flex flex-col min-h-[100dvh] bg-gray-950">
      <Nav />
      <main className="flex-1 max-w-2xl w-full mx-auto px-4 py-8 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Number Health</h1>
          <p className="text-gray-500 text-sm mt-1">
            Daily dial usage and spam status for all {numbers.length} number{numbers.length !== 1 ? 's' : ''}
          </p>
        </div>
        {numbers.length === 0 ? (
          <div className="text-center py-16 text-gray-600">
            <p>No phone numbers configured.</p>
            <p className="text-sm mt-1">Set <code className="text-gray-400">TWILIO_PHONE_NUMBERS</code> in your environment.</p>
          </div>
        ) : (
          <NumberHealthClient initial={initial} />
        )}
      </main>
    </div>
  )
}
