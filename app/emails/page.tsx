export const dynamic = 'force-dynamic'

import { createClient } from '@/lib/supabase/server'
import { Nav } from '@/components/Nav'
import type { Company } from '@/types'
import { EmailChecklist } from '@/components/EmailChecklist'

async function fetchEmailCompanies(): Promise<Company[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('companies')
    .select('*')
    .not('email', 'is', null)
    .neq('email', '')
    .order('company_name', { ascending: true })
  return (data as Company[]) ?? []
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
