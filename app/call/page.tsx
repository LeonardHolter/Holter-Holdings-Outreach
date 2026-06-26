export const dynamic = 'force-dynamic'

import { createClient } from '@/lib/supabase/server'
import { CallingSession } from '@/components/CallingSession'
import { Nav } from '@/components/Nav'
import type { Company } from '@/types'

async function fetchQueue(): Promise<Company[]> {
  const supabase = await createClient()
  const today = new Date().toISOString().slice(0, 10)

  const [notCalled, previouslyContacted] = await Promise.all([
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
      .not('reach_out_response', 'in', '("Not interested","Demo booked","Wrong number")')
      .or(`next_reach_out.lte.${today},next_reach_out.is.null`)
      .order('next_reach_out', { ascending: true, nullsFirst: true })
      .limit(2000),
  ])

  return [
    ...((notCalled.data as Company[]) ?? []),
    ...((previouslyContacted.data as Company[]) ?? []),
  ]
}

async function fetchByPhone(phone: string): Promise<Company | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('companies')
    .select('*')
    .eq('phone_number', phone)
    .limit(1)
    .single()
  if (data) return data as Company

  const digits = phone.replace(/\D/g, '')
  const variants = [
    digits,
    `+${digits}`,
    `+47${digits}`,
    digits.length === 10 && digits.startsWith('47') ? `+${digits}` : null,
    digits.length === 10 && digits.startsWith('47') ? digits.slice(2) : null,
  ].filter(Boolean) as string[]

  for (const v of variants) {
    const { data: row } = await supabase
      .from('companies')
      .select('*')
      .eq('phone_number', v)
      .limit(1)
      .single()
    if (row) return row as Company
  }
  return null
}

export default async function CallPage({ searchParams }: { searchParams: Promise<{ dial?: string }> }) {
  const [queue, params] = await Promise.all([fetchQueue(), searchParams])

  const TERMINAL_STATUSES = new Set([
    'Not interested',
    'Demo booked',
    'Wrong number',
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
