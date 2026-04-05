export const dynamic = 'force-dynamic'

import { createClient } from '@/lib/supabase/server'
import type { Company } from '@/types'
import { Nav } from '@/components/Nav'
import { CimClient } from '@/components/CimClient'

async function fetchNdaCompanies(): Promise<Company[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('companies')
    .select('*')
    .eq('reach_out_response', 'NDA received')
    .order('company_name', { ascending: true })
  return (data as Company[]) ?? []
}

export default async function CimPage() {
  const companies = await fetchNdaCompanies()

  return (
    <div className="flex flex-col h-[100dvh] overflow-hidden bg-gray-950">
      <Nav />
      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="max-w-5xl mx-auto space-y-4">
          <div className="mb-6">
            <h1 className="text-xl font-bold text-white">CIM Documents</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              {companies.length} compan{companies.length === 1 ? 'y' : 'ies'} with NDA received
            </p>
          </div>

          {companies.length === 0 ? (
            <div className="text-center py-24 text-gray-600">
              <svg className="w-12 h-12 mx-auto mb-3 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <p className="font-medium">No companies with NDA received yet</p>
              <p className="text-sm mt-1">Mark a lead as &ldquo;Received NDA&rdquo; to see it here</p>
            </div>
          ) : (
            <CimClient companies={companies} />
          )}
        </div>
      </div>
    </div>
  )
}
