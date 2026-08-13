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
  /** 'target' (a business we might buy) | 'intermediary' (accountant/adviser). */
  lead_type: string | null
  /** 'now' | '<1y' | '1-3y' | '3-5y' | 'never' | 'sold' — drives the requeue date. */
  exit_horizon: string | null
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

export type LeadType = 'target' | 'intermediary'

/** Outcomes for a TARGET — a business we might buy. */
export const TARGET_RESPONSE_STATUSES = [
  'Demo booked',
  'Not interested',
  'No answer',
  'Call back later',
  'Email sendt',
  'Wrong number',
  'Not needed',
]

/**
 * Outcomes for an INTERMEDIARY — an accountant or adviser who refers deals.
 * A different funnel: there is no sale to close, so there is no "Not
 * interested" that ends the relationship. "Intro booked" is the START of one,
 * and the firm keeps recurring on a ~90-day touch until it says "Not a fit".
 */
export const INTERMEDIARY_RESPONSE_STATUSES = [
  'Intro booked',
  'Will refer',
  'Has client now',
  'No answer',
  'Call back later',
  'Email sendt',
  'Wrong number',
  'Not a fit',
]

export function responseStatusesFor(leadType: string | null | undefined): string[] {
  return leadType === 'intermediary' ? INTERMEDIARY_RESPONSE_STATUSES : TARGET_RESPONSE_STATUSES
}

/** Union, for the pipeline filters and inline editors that span both funnels. */
export const RESPONSE_STATUSES = [
  ...TARGET_RESPONSE_STATUSES,
  ...INTERMEDIARY_RESPONSE_STATUSES.filter(s => !TARGET_RESPONSE_STATUSES.includes(s)),
]

/**
 * How soon the owner would consider stepping back. `value` is what is stored;
 * `days` is how far out to requeue the lead — the whole point of capturing
 * it. null days = terminal, the file is closed.
 */
export const EXIT_HORIZONS: { value: string; label: string; days: number | null }[] = [
  { value: 'now', label: 'Now', days: 14 },
  { value: '<1y', label: '< 1 yr', days: 30 },
  { value: '1-3y', label: '1–3 yr', days: 120 },
  { value: '3-5y', label: '3–5 yr', days: 240 },
  { value: 'never', label: 'Never', days: null },
  { value: 'sold', label: 'Just sold', days: null },
]

/** Intermediaries are a standing relationship, not a conversion — ~quarterly. */
export const INTERMEDIARY_TOUCH_DAYS = 90

/**
 * Does this lead never come back into the call queue? Mirrors
 * QUEUE_TERMINAL_SQL in lib/db.ts — keep the two in sync.
 *
 * Note what is NOT here: 'Not interested'. A target that said no today is
 * requeued on its exit horizon, because that is where a proprietary search
 * finds its deals.
 */
export function isTerminalLead(
  c: Pick<Company, 'reach_out_response' | 'exit_horizon' | 'lead_type'>
): boolean {
  if (['Wrong number', 'Not needed', 'Not a fit'].includes(c.reach_out_response ?? '')) return true
  if (['never', 'sold'].includes(c.exit_horizon ?? '')) return true
  return c.reach_out_response === 'Demo booked' && c.lead_type !== 'intermediary'
}

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
