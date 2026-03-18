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
  calls_sunzim: number
  calls_daniel: number
  calls_ellison: number
  total_dialed: number
  last_call_sid: string | null
  andre_lead_given: boolean
  andre_lead_date: string | null
  andre_heard_back: string | null
  callback_day: string | null
  callback_time: string | null
  created_at: string
  updated_at: string
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
  nextReachOutFrom?: string
  nextReachOutTo?: string
  search?: string
  notCalled?: boolean
  introMeetings?: boolean
}

export const STATES = ['MI', 'MN', 'PA', 'OH', 'WI', 'WA']

export const RESPONSE_STATUSES = [
  'Did not reach the Owner',
  'Intro-meeting wanted',
  'Owner is not interested',
  'Already acquired',
  'Not a garage door service company',
  'Number does not exist',
]

export const TEAM_MEMBERS = [
  'Leonard',
  'Tommaso',
  'John',
  'Sunzim',
  'Daniel',
  'Ellison',
]
