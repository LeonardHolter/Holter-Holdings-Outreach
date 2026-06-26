export const dynamic = 'force-dynamic'

import { Suspense } from 'react'
import { query, PRIORITY_ORDER_BY } from '@/lib/db'
import { CompanyTable } from '@/components/CompanyTable'
import { StatsPanel } from '@/components/StatsPanel'
import { FilterBar } from '@/components/FilterBar'
import { Nav } from '@/components/Nav'
import type { Company, CompanyFilters } from '@/types'

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

async function fetchCompanies(filters: CompanyFilters): Promise<Company[]> {
  
  const conditions: string[] = []
  const params: unknown[] = []
  let paramIdx = 1

  if (filters.regions && filters.regions.length > 0) {
    conditions.push(`state = ANY($${paramIdx++})`)
    params.push(filters.regions)
  }
  if (filters.responses && filters.responses.length > 0) {
    conditions.push(`reach_out_response = ANY($${paramIdx++})`)
    params.push(filters.responses)
  }
  if (filters.whoCalled && filters.whoCalled.length > 0) {
    conditions.push(`who_called = ANY($${paramIdx++})`)
    params.push(filters.whoCalled)
  }
  if (filters.search) {
    const term = `%${filters.search}%`
    conditions.push(`(company_name ILIKE $${paramIdx} OR owners_name ILIKE $${paramIdx} OR email ILIKE $${paramIdx} OR notes ILIKE $${paramIdx})`)
    params.push(term)
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const rows = await query(`SELECT * FROM companies ${where} ORDER BY ${PRIORITY_ORDER_BY}`, params)
  return rows as Company[]
}

function parseFilters(sp: Record<string, string | string[] | undefined>): CompanyFilters {
  const str = (key: string) => (typeof sp[key] === 'string' ? (sp[key] as string) : undefined)
  const arr = (key: string) => {
    const v = str(key)
    return v ? v.split(',') : undefined
  }
  return {
    regions: arr('regions'),
    responses: arr('responses'),
    whoCalled: arr('whoCalled'),
    search: str('search'),
  }
}

async function TableSection({ filters }: { filters: CompanyFilters }) {
  const companies = await fetchCompanies(filters)

  return (
    <>
      <StatsPanel companies={companies} />
      <FilterBar />
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
