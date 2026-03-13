import { createClient } from '@/lib/supabase/server'
import type { Company, CompanyFilters } from '@/types'

export async function getCompanies(filters?: CompanyFilters): Promise<Company[]> {
  const supabase = await createClient()

  let query = supabase.from('companies').select('*')

  if (filters?.states && filters.states.length > 0) {
    query = query.in('state', filters.states)
  }

  if (filters?.responses && filters.responses.length > 0) {
    query = query.in('reach_out_response', filters.responses)
  }

  if (filters?.whoCalled && filters.whoCalled.length > 0) {
    query = query.in('who_called', filters.whoCalled)
  }

  if (filters?.nextReachOutFrom) {
    query = query.gte('next_reach_out', filters.nextReachOutFrom)
  }

  if (filters?.nextReachOutTo) {
    query = query.lte('next_reach_out', filters.nextReachOutTo)
  }

  if (filters?.notCalled) {
    query = query.eq('reach_out_response', 'Not called')
  }

  if (filters?.introMeetings) {
    query = query.eq('reach_out_response', 'Intro-meeting wanted')
  }

  if (filters?.search) {
    const term = `%${filters.search}%`
    query = query.or(
      `company_name.ilike.${term},owners_name.ilike.${term},email.ilike.${term},notes.ilike.${term}`
    )
  }

  query = query.order('google_reviews', { ascending: false, nullsFirst: false })

  const { data, error } = await query

  if (error) throw error
  return (data as Company[]) ?? []
}

export async function getCompanyById(id: string): Promise<Company | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('companies')
    .select('*')
    .eq('id', id)
    .single()

  if (error) return null
  return data as Company
}

export async function updateCompany(
  id: string,
  payload: Partial<Company>
): Promise<Company> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('companies')
    .update(payload)
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return data as Company
}

export async function createCompany(
  payload: Partial<Company>
): Promise<Company> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('companies')
    .insert(payload)
    .select()
    .single()

  if (error) throw error
  return data as Company
}

export async function deleteCompany(id: string): Promise<void> {
  const supabase = await createClient()
  const { error } = await supabase.from('companies').delete().eq('id', id)
  if (error) throw error
}
