export const dynamic = 'force-dynamic'

import { createClient } from '@/lib/supabase/server'
import { Nav } from '@/components/Nav'
import type { Company } from '@/types'
import { EmailChecklist } from '@/components/EmailChecklist'

export interface CompanyWithRecording extends Company {
  latestRecordingUrl: string | null
}

async function fetchEmailCompanies(): Promise<CompanyWithRecording[]> {
  const supabase = await createClient()

  const [{ data: companies }, { data: recordings }] = await Promise.all([
    supabase
      .from('companies')
      .select('*')
      .not('email', 'is', null)
      .neq('email', '')
      .order('company_name', { ascending: true }),
    supabase
      .from('call_recordings')
      .select('company_id, recording_url, called_at')
      .not('recording_url', 'is', null)
      .order('called_at', { ascending: false }),
  ])

  // Keep only the most recent recording per company (rows already sorted desc)
  const latestByCompany = new Map<string, string>()
  for (const r of (recordings ?? []) as { company_id: string; recording_url: string }[]) {
    if (!latestByCompany.has(r.company_id)) {
      latestByCompany.set(r.company_id, r.recording_url)
    }
  }

  return ((companies as Company[]) ?? []).map(c => ({
    ...c,
    latestRecordingUrl: latestByCompany.get(c.id) ?? null,
  }))
}

export default async function EmailsPage() {
  const companies = await fetchEmailCompanies()

  return (
    <div className="flex flex-col h-[100dvh] overflow-hidden bg-gray-950">
      <Nav />
      <EmailChecklist initialCompanies={companies} />
    </div>
  )
}
