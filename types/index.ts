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
  reached_decision_maker: boolean | null
  demo_outcome: string | null
  industry: string | null // 'Bilverksted' | 'Rørlegger' | … (set by importers)
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
  'Email sendt',
  'Wrong number',
  'Not needed',
]

export const TEAM_MEMBERS = [
  'Leonard',
  'William',
]

// Marking a demo "Under consideration" parks the lead: it leaves the active
// /demos cadence and shows up on /lead-behandling instead, where it gets a
// logged follow-up and a next follow-up date until it turns into Won or Lost.
export const UNDER_CONSIDERATION = 'Under consideration'

export const DEMO_OUTCOMES = [
  'Held',
  'No-show',
  'Won',
  'Lost',
  UNDER_CONSIDERATION,
]

// Follow-up cadence after a demo is booked. Offsets are days after the
// booking call ("same day" = day of booking).
export const DEMO_TOUCHPOINTS = [
  { key: 'same_day',  label: 'Same day',  from: 0,  to: 0  },
  { key: 'day_2',     label: 'Day 2',     from: 2,  to: 2  },
  { key: 'day_4',     label: 'Day 4',     from: 4,  to: 4  },
  { key: 'day_7',     label: 'Day 7',     from: 7,  to: 7  },
  { key: 'day_10_12', label: 'Day 10–12', from: 10, to: 12 },
] as const

export type TouchpointKey = (typeof DEMO_TOUCHPOINTS)[number]['key']
