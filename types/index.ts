export interface Company {
  id: string
  company_name: string
  phone_number: string | null
  email: string | null
  reach_out_response: string | null
  last_reach_out: string | null
  next_reach_out: string | null
  owners_name: string | null
  amount_of_calls: number
  who_called: string | null
  notes: string | null
  last_call_sid: string | null
  callback_day: string | null
  callback_time: string | null
  website: string | null
  state: string | null
  google_reviews: number | null
  google_rating: number | null
  org_nr: string | null
  revenue: number | null
  employees: string | null
  calls_leonard: number
  calls_william: number
  total_dialed: number
  added_by: string | null
  created_at: string
  updated_at: string
}

export interface CompanyNote {
  id: string
  company_id: string
  note: string
  caller_name: string | null
  created_at: string
}

export interface CallRecording {
  id: string
  company_id: string
  call_sid: string
  caller_name: string | null
  recording_url: string | null
  duration_seconds: number | null
  called_at: string
  called_by: string | null
}

export interface TeamMember {
  id: string
  name: string
}

export interface ResponseStatus {
  id: string
  label: string
}

export interface CompanyFilters {
  regions?: string[]
  responses?: string[]
  whoCalled?: string[]
  search?: string
}

export const REGIONS = [
  'Oslo',
  'Bergen',
  'Trondheim',
  'Stavanger',
  'Kristiansand',
  'Tromsø',
  'Drammen',
  'Fredrikstad',
  'Sandnes',
  'Ålesund',
  'Bodø',
  'Tønsberg',
  'Haugesund',
  'Sandefjord',
  'Moss',
  'Skien',
  'Molde',
  'Harstad',
  'Lillehammer',
  'Gjøvik',
]

export const RESPONSE_STATUSES = [
  'Demo booked',
  'Not interested',
  'No answer',
  'Call back later',
  'Wrong number',
  'Not needed',
]

export const TEAM_MEMBERS = [
  'Leonard',
  'William',
]
