export const dynamic = 'force-dynamic'

import { Suspense } from 'react'
import { createClient } from '@/lib/supabase/server'
import { CompanyTable } from '@/components/CompanyTable'
import { StatsPanel } from '@/components/StatsPanel'
import { FilterBar } from '@/components/FilterBar'
import { Nav } from '@/components/Nav'
import type { Company, CompanyFilters } from '@/types'

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

function applyFilters<T extends { in: (...a: never[]) => T; eq: (...a: never[]) => T; gte: (...a: never[]) => T; lte: (...a: never[]) => T; or: (...a: never[]) => T }>(query: T, filters: CompanyFilters): T {
  if (filters.states?.length) query = query.in('state' as never, filters.states as never)
  if (filters.responses?.length) query = query.in('reach_out_response' as never, filters.responses as never)
  if (filters.whoCalled?.length) query = query.in('who_called' as never, filters.whoCalled as never)
  if (filters.addedBy?.length) query = query.in('added_by' as never, filters.addedBy as never)
  if (filters.nextReachOutFrom) query = query.gte('next_reach_out' as never, filters.nextReachOutFrom as never)
  if (filters.nextReachOutTo) query = query.lte('next_reach_out' as never, filters.nextReachOutTo as never)
  if (filters.notCalled) query = query.eq('reach_out_response' as never, 'Not called' as never)
  else if (filters.introMeetings) query = query.eq('reach_out_response' as never, 'Intro-meeting wanted' as never)
  if (filters.search) {
    const term = `%${filters.search}%`
    query = query.or(`company_name.ilike.${term},owners_name.ilike.${term},email.ilike.${term},notes.ilike.${term}` as never)
  }
  return query
}

function buildQuery(supabase: Awaited<ReturnType<typeof createClient>>, filters: CompanyFilters) {
  const query = supabase.from('companies').select('*')
  return applyFilters(query, filters).order('google_reviews', { ascending: false, nullsFirst: false })
}

const INITIAL_PAGE_SIZE = 500

interface FetchResult {
  companies: Company[]
  totalCount: number
  stats: { total: number; called: number; notCalled: number; introMeetings: number; notInterested: number }
}

async function fetchCompanies(filters: CompanyFilters): Promise<FetchResult> {
  const supabase = await createClient()

  const dataQuery = buildQuery(supabase, filters).range(0, INITIAL_PAGE_SIZE - 1)

  const [statsResult, dataResult] = await Promise.all([
    (async () => {
      const all: { reach_out_response: string | null }[] = []
      const PAGE = 5000
      let from = 0
      while (true) {
        const q = applyFilters(
          supabase.from('companies').select('reach_out_response'),
          filters,
        )
        const { data, error } = await q.range(from, from + PAGE - 1)
        if (error) { console.error('Stats query error:', error); break }
        const rows = (data ?? []) as { reach_out_response: string | null }[]
        all.push(...rows)
        if (rows.length < PAGE) break
        from += PAGE
      }
      return all
    })(),
    dataQuery,
  ])

  if (dataResult.error) {
    console.error('Error fetching companies:', dataResult.error)
    return { companies: [], totalCount: 0, stats: { total: 0, called: 0, notCalled: 0, introMeetings: 0, notInterested: 0 } }
  }

  const companies = (dataResult.data as Company[]) ?? []
  const totalCount = statsResult.length

  let called = 0, introMeetings = 0, notInterested = 0
  for (const r of statsResult) {
    const resp = r.reach_out_response
    if (resp && resp !== 'Not called') called++
    if (resp === 'Intro-meeting wanted') introMeetings++
    if (resp === 'Owner is not interested') notInterested++
  }

  return {
    companies,
    totalCount,
    stats: { total: totalCount, called, notCalled: totalCount - called, introMeetings, notInterested },
  }
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
    addedBy: arr('addedBy'),
    nextReachOutFrom: str('nextReachOutFrom'),
    nextReachOutTo: str('nextReachOutTo'),
    search: str('search'),
    notCalled: str('notCalled') === 'true',
    introMeetings: str('introMeetings') === 'true',
  }
}

async function TableSection({ filters }: { filters: CompanyFilters }) {
  const { companies, totalCount, stats } = await fetchCompanies(filters)

  return (
    <>
      <StatsPanel stats={stats} />
      <FilterBar />
      <CompanyTable initialData={companies} totalCount={totalCount} />
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
