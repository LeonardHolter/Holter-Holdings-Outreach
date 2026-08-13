export const dynamic = 'force-dynamic'

import { query, PRIORITY_ORDER_BY, QUEUE_TERMINAL_SQL } from '@/lib/db'
import { CallingSession } from '@/components/CallingSession'
import { TelnyxDialPanel } from '@/components/TelnyxDialPanel'
import { CallingHoursGate } from '@/components/CallingHoursGate'
import { PaceBanner } from '@/components/PaceBanner'
import { Nav } from '@/components/Nav'
import { isTerminalLead, type Company } from '@/types'

async function fetchQueue(): Promise<Company[]> {
  
  const today = new Date().toISOString().slice(0, 10)

  const [notCalled, previouslyContacted] = await Promise.all([
    query(
      // next_reach_out also gates never-called leads — the "pops up
      // tomorrow" snooze sets it, and without this filter a snoozed
      // not-called lead would reappear immediately.
      `SELECT * FROM companies
       WHERE (reach_out_response = 'Not called' OR reach_out_response IS NULL)
         AND (next_reach_out IS NULL OR next_reach_out <= $1)
       ORDER BY ${PRIORITY_ORDER_BY}
       LIMIT 5000`,
      [today]
    ),
    query(
      // 'Not interested' is absent from the terminal set on purpose — see
      // QUEUE_TERMINAL_SQL. A target that said no comes back on the date its
      // exit horizon implies, which is where the deals actually come from.
      `SELECT * FROM companies
       WHERE reach_out_response IS NOT NULL
         AND reach_out_response != 'Not called'
         AND NOT ${QUEUE_TERMINAL_SQL}
         AND (next_reach_out <= $1 OR next_reach_out IS NULL)
       ORDER BY next_reach_out ASC NULLS FIRST
       LIMIT 2000`,
      [today]
    ),
  ])

  return [
    ...(notCalled as Company[]),
    ...(previouslyContacted as Company[]),
  ]
}

async function fetchByPhone(phone: string): Promise<Company | null> {
  
  const rows = await query('SELECT * FROM companies WHERE phone_number = $1 LIMIT 1', [phone])
  if (rows[0]) return rows[0] as Company

  const digits = phone.replace(/\D/g, '')
  const variants = [
    digits,
    `+${digits}`,
    `+47${digits}`,
    digits.length === 10 && digits.startsWith('47') ? `+${digits}` : null,
    digits.length === 10 && digits.startsWith('47') ? digits.slice(2) : null,
  ].filter(Boolean) as string[]

  for (const v of variants) {
    const found = await query('SELECT * FROM companies WHERE phone_number = $1 LIMIT 1', [v])
    if (found[0]) return found[0] as Company
  }
  return null
}

export default async function CallPage({ searchParams }: { searchParams: Promise<{ dial?: string }> }) {
  const [queue, params] = await Promise.all([fetchQueue(), searchParams])

  let finalQueue = queue
  if (params.dial) {
    const normalized = params.dial.replace(/\D/g, '')
    const alreadyInQueue = queue.some(c => c.phone_number?.replace(/\D/g, '') === normalized)
    if (!alreadyInQueue) {
      const target = await fetchByPhone(params.dial)
      if (target && !isTerminalLead(target)) {
        finalQueue = [target, ...queue]
      }
    }
  }

  return (
    <div className="flex flex-col h-[100dvh] overflow-hidden bg-gray-950">
      <Nav />
      <CallingHoursGate>
        <PaceBanner />
        <TelnyxDialPanel prefillNumber={params.dial} />
        <CallingSession initialQueue={finalQueue} dialNumber={params.dial} />
      </CallingHoursGate>
    </div>
  )
}
