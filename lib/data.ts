import { query } from '@/lib/db'
import type { Company, CompanyFilters } from '@/types'

export async function getCompanies(filters?: CompanyFilters): Promise<Company[]> {
  
  const conditions: string[] = []
  const params: unknown[] = []
  let paramIdx = 1

  if (filters?.regions && filters.regions.length > 0) {
    conditions.push(`state = ANY($${paramIdx++})`)
    params.push(filters.regions)
  }
  if (filters?.responses && filters.responses.length > 0) {
    conditions.push(`reach_out_response = ANY($${paramIdx++})`)
    params.push(filters.responses)
  }
  if (filters?.whoCalled && filters.whoCalled.length > 0) {
    conditions.push(`who_called = ANY($${paramIdx++})`)
    params.push(filters.whoCalled)
  }
  if (filters?.search) {
    const term = `%${filters.search}%`
    conditions.push(`(company_name ILIKE $${paramIdx} OR owners_name ILIKE $${paramIdx} OR email ILIKE $${paramIdx} OR notes ILIKE $${paramIdx})`)
    params.push(term)
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const rows = await query(`SELECT * FROM companies ${where} ORDER BY created_at DESC NULLS LAST`, params)
  return rows as Company[]
}

export async function getCompanyById(id: string): Promise<Company | null> {
  
  const rows = await query('SELECT * FROM companies WHERE id = $1 LIMIT 1', [id])
  return (rows[0] as Company) ?? null
}

export async function updateCompany(id: string, payload: Partial<Company>): Promise<Company> {
  
  const keys = Object.keys(payload)
  const sets = keys.map((k, i) => `${k} = $${i + 2}`)
  const values = keys.map(k => (payload as Record<string, unknown>)[k])
  const rows = await query(
    `UPDATE companies SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
    [id, ...values]
  )
  return rows[0] as Company
}

export async function createCompany(payload: Partial<Company>): Promise<Company> {
  
  const keys = Object.keys(payload)
  const cols = keys.join(', ')
  const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ')
  const values = keys.map(k => (payload as Record<string, unknown>)[k])
  const rows = await query(
    `INSERT INTO companies (${cols}) VALUES (${placeholders}) RETURNING *`,
    values
  )
  return rows[0] as Company
}

export async function deleteCompany(id: string): Promise<void> {
  
  await query('DELETE FROM companies WHERE id = $1', [id])
}
