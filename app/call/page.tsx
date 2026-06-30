export const dynamic = 'force-dynamic'

import { query, PRIORITY_ORDER_BY } from '@/lib/db'
import { CallingSession } from '@/components/CallingSession'
import { Nav } from '@/components/Nav'
import type { Company } from '@/types'

async function fetchQueue(): Promise<Company[]> {
  
  const today = new Date().toISOString().slice(0, 10)

  const [notCalled, previouslyContacted] = await Promise.all([
    query(
      `SELECT * FROM companies
       WHERE reach_out_response = 'Not called' OR reach_out_response IS NULL
       ORDER BY ${PRIORITY_ORDER_BY}
       LIMIT 5000`
    ),
    query(
      `SELECT * FROM companies
       WHERE reach_out_response IS NOT NULL
         AND reach_out_response != 'Not called'
         AND reach_out_response NOT IN ('Not interested', 'Demo booked', 'Wrong number', 'Not needed')
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

  const TERMINAL_STATUSES = new Set([
    'Not interested',
    'Demo booked',
    'Wrong number',
    'Not needed',
  ])

  let finalQueue = queue
  if (params.dial) {
    const normalized = params.dial.replace(/\D/g, '')
    const alreadyInQueue = queue.some(c => c.phone_number?.replace(/\D/g, '') === normalized)
    if (!alreadyInQueue) {
      const target = await fetchByPhone(params.dial)
      if (target && !TERMINAL_STATUSES.has(target.reach_out_response ?? '')) {
        finalQueue = [target, ...queue]
      }
    }
  }

  return (
    <div className="flex flex-col h-[100dvh] overflow-hidden bg-gray-950">
      <Nav />
      <CallingSession initialQueue={finalQueue} dialNumber={params.dial} />
    </div>
  )
}
