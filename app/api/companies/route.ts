import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import type { Company, CompanyFilters } from '@/types'

export async function GET(request: NextRequest) {
  try {
    
    const { searchParams } = new URL(request.url)

    const filters: CompanyFilters = {}

    const regions = searchParams.get('regions')
    if (regions) filters.regions = regions.split(',')

    const responses = searchParams.get('responses')
    if (responses) filters.responses = responses.split(',')

    const whoCalled = searchParams.get('whoCalled')
    if (whoCalled) filters.whoCalled = whoCalled.split(',')

    const search = searchParams.get('search')
    if (search) filters.search = search

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
      paramIdx++
      params.push(term)
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    const rows = await query(`SELECT * FROM companies ${where} ORDER BY created_at DESC NULLS LAST`, params)

    return NextResponse.json(rows as Company[])
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Failed to fetch companies' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    
    const body: Partial<Company> = await request.json()
    const keys = Object.keys(body)
    const cols = keys.join(', ')
    const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ')
    const values = keys.map(k => (body as Record<string, unknown>)[k])

    const rows = await query(
      `INSERT INTO companies (${cols}) VALUES (${placeholders}) RETURNING *`,
      values
    )
    return NextResponse.json(rows[0], { status: 201 })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Failed to create company' }, { status: 500 })
  }
}
