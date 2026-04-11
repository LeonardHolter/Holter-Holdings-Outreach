import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { Company, CompanyFilters } from '@/types'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { searchParams } = new URL(request.url)

    const filters: CompanyFilters = {}

    const states = searchParams.get('states')
    if (states) filters.states = states.split(',')

    const responses = searchParams.get('responses')
    if (responses) filters.responses = responses.split(',')

    const whoCalled = searchParams.get('whoCalled')
    if (whoCalled) filters.whoCalled = whoCalled.split(',')

    const addedBy = searchParams.get('addedBy')
    if (addedBy) filters.addedBy = addedBy.split(',')

    const nextReachOutFrom = searchParams.get('nextReachOutFrom')
    if (nextReachOutFrom) filters.nextReachOutFrom = nextReachOutFrom

    const nextReachOutTo = searchParams.get('nextReachOutTo')
    if (nextReachOutTo) filters.nextReachOutTo = nextReachOutTo

    const search = searchParams.get('search')
    if (search) filters.search = search

    const notCalled = searchParams.get('notCalled')
    if (notCalled === 'true') filters.notCalled = true

    const introMeetings = searchParams.get('introMeetings')
    if (introMeetings === 'true') filters.introMeetings = true

    function buildQuery() {
      let query = supabase.from('companies').select('*')

      if (filters.states && filters.states.length > 0) {
        query = query.in('state', filters.states)
      }
      if (filters.responses && filters.responses.length > 0) {
        query = query.in('reach_out_response', filters.responses)
      }
      if (filters.whoCalled && filters.whoCalled.length > 0) {
        query = query.in('who_called', filters.whoCalled)
      }
      if (filters.addedBy && filters.addedBy.length > 0) {
        query = query.in('added_by', filters.addedBy)
      }
      if (filters.nextReachOutFrom) {
        query = query.gte('next_reach_out', filters.nextReachOutFrom)
      }
      if (filters.nextReachOutTo) {
        query = query.lte('next_reach_out', filters.nextReachOutTo)
      }
      if (filters.notCalled) {
        query = query.eq('reach_out_response', 'Not called')
      }
      if (filters.introMeetings) {
        query = query.eq('reach_out_response', 'Intro-meeting wanted')
      }
      if (filters.search) {
        const term = `%${filters.search}%`
        query = query.or(
          `company_name.ilike.${term},owners_name.ilike.${term},email.ilike.${term},notes.ilike.${term}`
        )
      }

      return query.order('google_reviews', { ascending: false, nullsFirst: false })
    }

    const offsetParam = searchParams.get('offset')
    const limitParam = searchParams.get('limit')

    if (limitParam) {
      const offset = parseInt(offsetParam ?? '0', 10)
      const limit = parseInt(limitParam, 10)

      let countQuery = supabase.from('companies').select('*', { count: 'exact', head: true })
      if (filters.states?.length) countQuery = countQuery.in('state', filters.states)
      if (filters.responses?.length) countQuery = countQuery.in('reach_out_response', filters.responses)
      if (filters.whoCalled?.length) countQuery = countQuery.in('who_called', filters.whoCalled)
      if (filters.addedBy?.length) countQuery = countQuery.in('added_by', filters.addedBy)
      if (filters.nextReachOutFrom) countQuery = countQuery.gte('next_reach_out', filters.nextReachOutFrom)
      if (filters.nextReachOutTo) countQuery = countQuery.lte('next_reach_out', filters.nextReachOutTo)
      if (filters.notCalled) countQuery = countQuery.eq('reach_out_response', 'Not called')
      else if (filters.introMeetings) countQuery = countQuery.eq('reach_out_response', 'Intro-meeting wanted')
      if (filters.search) {
        const t = `%${filters.search}%`
        countQuery = countQuery.or(`company_name.ilike.${t},owners_name.ilike.${t},email.ilike.${t},notes.ilike.${t}`)
      }

      const [countResult, dataResult] = await Promise.all([
        countQuery,
        buildQuery().range(offset, offset + limit - 1),
      ])

      if (dataResult.error) throw dataResult.error
      const total = countResult.count ?? 0
      const rows = (dataResult.data as Company[]) ?? []

      return NextResponse.json({ companies: rows, total, hasMore: offset + rows.length < total })
    }

    const all: Company[] = []
    const PAGE = 1000
    let from = 0
    while (true) {
      const { data, error } = await buildQuery().range(from, from + PAGE - 1)
      if (error) throw error
      const rows = (data as Company[]) ?? []
      all.push(...rows)
      if (rows.length < PAGE) break
      from += PAGE
    }

    return NextResponse.json(all)
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Failed to fetch companies' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const body: Partial<Company> = await request.json()

    const { data, error } = await supabase
      .from('companies')
      .insert(body)
      .select()
      .single()

    if (error) throw error
    return NextResponse.json(data, { status: 201 })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Failed to create company' }, { status: 500 })
  }
}
