export const dynamic = 'force-dynamic'

import { Suspense } from 'react'
import { createClient } from '@/lib/supabase/server'
import { CompanyTable } from '@/components/CompanyTable'
import { StatsPanel } from '@/components/StatsPanel'
import { Nav } from '@/components/Nav'
import type { Company, CompanyFilters } from '@/types'

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

async function fetchCompanies(filters: CompanyFilters): Promise<Company[]> {
  const supabase = await createClient()

  let query = supabase.from('companies').select('*').limit(10000)

  if (filters.states && filters.states.length > 0) {
    query = query.in('state', filters.states)
  }
  if (filters.responses && filters.responses.length > 0) {
    query = query.in('reach_out_response', filters.responses)
  }
  if (filters.whoCalled && filters.whoCalled.length > 0) {
    query = query.in('who_called', filters.whoCalled)
  }
  if (filters.nextReachOutFrom) {
    query = query.gte('next_reach_out', filters.nextReachOutFrom)
  }
  if (filters.nextReachOutTo) {
    query = query.lte('next_reach_out', filters.nextReachOutTo)
  }
  if (filters.notCalled) {
    query = query.eq('reach_out_response', 'Not called')
  } else if (filters.introMeetings) {
    query = query.eq('reach_out_response', 'Intro-meeting wanted')
  }
  if (filters.search) {
    const term = `%${filters.search}%`
    query = query.or(
      `company_name.ilike.${term},owners_name.ilike.${term},email.ilike.${term},notes.ilike.${term}`
    )
  }

  query = query.order('google_reviews', { ascending: false, nullsFirst: false })

  const { data, error } = await query
  if (error) {
    console.error('Error fetching companies:', error)
    return []
  }
  return (data as Company[]) ?? []
}

function parseFilters(sp: Record<string, string | string[] | undefined>): CompanyFilters {
  const str = (key: string) => (typeof sp[key] === 'string' ? (sp[key] as string) : undefined)
  const arr = (key: string) => {
    const v = str(key)
    return v ? v.split(',') : undefined
  }
  return {
    states: arr('states'),
    responses: arr('responses'),
    whoCalled: arr('whoCalled'),
    nextReachOutFrom: str('nextReachOutFrom'),
    nextReachOutTo: str('nextReachOutTo'),
    search: str('search'),
    notCalled: str('notCalled') === 'true',
    introMeetings: str('introMeetings') === 'true',
  }
}

async function TableSection({ filters }: { filters: CompanyFilters }) {
  const companies = await fetchCompanies(filters)

  return (
    <>
      <StatsPanel companies={companies} />
      <CompanyTable initialData={companies} />
    </>
  )
}

export default async function HomePage({ searchParams }: PageProps) {
  const sp = await searchParams
  const filters = parseFilters(sp)

  return (
    <div className="flex flex-col h-[100dvh] overflow-hidden bg-gray-950">
      <Nav />

      {/* Stats + Table */}
      <div className="flex flex-col flex-1 overflow-hidden px-4 pt-3 gap-3">
        <Suspense fallback={<TableSkeleton />}>
          <TableSection filters={filters} />
        </Suspense>
      </div>
    </div>
  )
}

function TableSkeleton() {
  return (
    <div className="animate-pulse space-y-2">
      <div className="h-24 bg-gray-900 rounded-xl" />
      <div className="h-8 bg-gray-900 rounded" />
      {Array.from({ length: 12 }).map((_, i) => (
        <div key={i} className="h-9 bg-gray-900/60 rounded" style={{ opacity: 1 - i * 0.06 }} />
      ))}
    </div>
  )
}
