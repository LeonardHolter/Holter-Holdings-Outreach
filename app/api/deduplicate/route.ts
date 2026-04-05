import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { Company } from '@/types'

function normalizePhone(p: string): string {
  return p.replace(/\D/g, '')
}

export async function POST() {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('companies')
    .select('*')
    .order('amount_of_calls', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const companies = (data as Company[]) ?? []
  const seen = new Map<string, Company>()
  const toDelete: string[] = []

  for (const c of companies) {
    if (!c.phone_number) continue
    const key = normalizePhone(c.phone_number)
    if (!key) continue

    const existing = seen.get(key)
    if (!existing) {
      seen.set(key, c)
      continue
    }

    // Keep the one with more calls; on tie keep the one already stored (first seen = most calls due to sort)
    if ((c.amount_of_calls ?? 0) > (existing.amount_of_calls ?? 0)) {
      toDelete.push(existing.id)
      seen.set(key, c)
    } else {
      toDelete.push(c.id)
    }
  }

  if (toDelete.length === 0) {
    return NextResponse.json({ deleted: 0 })
  }

  // Delete in batches of 100 to avoid query size limits
  let deleted = 0
  for (let i = 0; i < toDelete.length; i += 100) {
    const batch = toDelete.slice(i, i + 100)
    const { error: delError } = await supabase
      .from('companies')
      .delete()
      .in('id', batch)
    if (!delError) deleted += batch.length
  }

  return NextResponse.json({ deleted })
}
