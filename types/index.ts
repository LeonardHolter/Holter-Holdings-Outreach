export interface Company {
  id: string
  company_name: string
  google_reviews: number | null
  state: string | null
  phone_number: string | null
  reach_out_response: string | null
  last_reach_out: string | null
  next_reach_out: string | null
  owners_name: string | null
  amount_of_calls: number
  who_called: string | null
  email: string | null
  notes: string | null
  calls_leonard: number
  calls_tommaso: number
  calls_john: number
  calls_henry: number
  total_dialed: number
  last_call_sid: string | null
  andre_lead_given: boolean
  andre_lead_date: string | null
  andre_heard_back: string | null
  meeting_priority: 'high' | 'low' | null
  loi_sent: boolean
  loi_sent_date: string | null
  follow_up_calls: number
  follow_up_emails: number
  callback_day: string | null
  callback_time: string | null
  added_by: string | null
  google_place_id: string | null
  address: string | null
  website: string | null
  latitude: number | null
  longitude: number | null
  google_rating: number | null
  county: string | null
  estimated_revenue_low: number | null
  estimated_revenue_high: number | null
  revenue_confidence: string | null
  technician_count_estimate: number | null
  enrichment_reasoning: string | null
  enrichment_signals: string[] | null
  enriched_at: string | null
  emailed_at: string | null
  priority_reason: string | null
  created_at: string
  updated_at: string
}

export interface CompanyWithRecording extends Company {
  latestRecordingUrl: string | null
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
  states?: string[]
  responses?: string[]
  whoCalled?: string[]
  addedBy?: string[]
  nextReachOutFrom?: string
  nextReachOutTo?: string
  search?: string
  notCalled?: boolean
  introMeetings?: boolean
}

export const STATES = [
  'AK', 'AL', 'AR', 'AZ', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'IA', 'ID', 'IL', 'IN', 'KS', 'KY', 'LA', 'MA', 'MD',
  'ME', 'MI', 'MN', 'MO', 'MS', 'MT', 'NC', 'ND', 'NE', 'NH',
  'NJ', 'NM', 'NV', 'NY', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VA', 'VT', 'WA', 'WI', 'WV', 'WY',
]

export const RESPONSE_STATUSES = [
  'Did not reach the Owner',
  'Intro-meeting wanted',
  'NDA received',
  'Owner is not interested',
  'Already acquired',
  'Not a garage door service company',
  'Number does not exist',
]

export const TEAM_MEMBERS = [
  'Leonard',
  'Tommaso',
  'John',
  'Henry',
]
