import { describe, expect, it } from 'vitest'
import {
  isTerminalLead,
  responseStatusesFor,
  EXIT_HORIZONS,
  TARGET_RESPONSE_STATUSES,
  INTERMEDIARY_RESPONSE_STATUSES,
  RESPONSE_STATUSES,
} from '@/types'
import type { Company } from '@/types'

type LeadBits = Pick<Company, 'reach_out_response' | 'exit_horizon' | 'lead_type'>
const lead = (b: Partial<LeadBits> = {}): LeadBits => ({
  reach_out_response: null,
  exit_horizon: null,
  lead_type: 'target',
  ...b,
})

describe('a target that said no is not a dead lead', () => {
  // The rule this file exists to protect. In a proprietary acquisition search
  // the modal answer from a good target is "not right now", and three years
  // later that is the deal. Burning it on the first no threw away exactly the
  // leads the search exists to find.
  it('keeps "Not interested" targets in the queue', () => {
    expect(isTerminalLead(lead({ reach_out_response: 'Not interested' }))).toBe(false)
  })

  it('closes the file only when the owner actually closed it', () => {
    expect(isTerminalLead(lead({ reach_out_response: 'Not interested', exit_horizon: 'never' }))).toBe(true)
    expect(isTerminalLead(lead({ reach_out_response: 'Not interested', exit_horizon: 'sold' }))).toBe(true)
  })

  it('still drops bad records and wrong profiles', () => {
    for (const r of ['Wrong number', 'Not needed', 'Not a fit']) {
      expect(isTerminalLead(lead({ reach_out_response: r }))).toBe(true)
    }
  })

  it('treats a lead with nothing recorded yet as dialable', () => {
    // The SQL mirror of this predicate (QUEUE_TERMINAL_SQL) has to COALESCE
    // every column: `exit_horizon IN ('never','sold')` is NULL, not false, on
    // the rows where exit_horizon IS NULL — which is nearly all of them — and
    // `NOT NULL` is NULL, so an un-COALESCEd version empties the whole queue.
    expect(isTerminalLead(lead())).toBe(false)
    expect(isTerminalLead(lead({ lead_type: null }))).toBe(false)
    expect(isTerminalLead(lead({ reach_out_response: 'No answer', exit_horizon: null }))).toBe(false)
  })

  it('a dated horizon keeps the lead alive, however far out', () => {
    for (const h of ['now', '<1y', '1-3y', '3-5y']) {
      expect(isTerminalLead(lead({ reach_out_response: 'Not interested', exit_horizon: h }))).toBe(false)
    }
  })
})

describe('the two funnels behave differently', () => {
  it('a booked demo parks a target but not an accountant', () => {
    // A target with a booked demo is in an active process on /demos and must
    // not be re-dialled from the cold queue. A booked intro with an accountant
    // is the START of a referral relationship — it has to keep recurring.
    expect(isTerminalLead(lead({ reach_out_response: 'Demo booked' }))).toBe(true)
    expect(isTerminalLead(lead({ reach_out_response: 'Demo booked', lead_type: 'intermediary' }))).toBe(false)
  })

  it('serves each funnel its own outcome vocabulary', () => {
    expect(responseStatusesFor('intermediary')).toBe(INTERMEDIARY_RESPONSE_STATUSES)
    expect(responseStatusesFor('target')).toBe(TARGET_RESPONSE_STATUSES)
    // Unset lead_type (pre-migration rows) must fall back to target, never crash.
    expect(responseStatusesFor(null)).toBe(TARGET_RESPONSE_STATUSES)
    expect(responseStatusesFor(undefined)).toBe(TARGET_RESPONSE_STATUSES)
  })

  it('offers no "Not interested" to an accountant, and no "Not a fit" to a target', () => {
    expect(INTERMEDIARY_RESPONSE_STATUSES).not.toContain('Not interested')
    expect(TARGET_RESPONSE_STATUSES).not.toContain('Not a fit')
  })

  it('the union covers both, without duplicates, for the pipeline filters', () => {
    for (const s of [...TARGET_RESPONSE_STATUSES, ...INTERMEDIARY_RESPONSE_STATUSES]) {
      expect(RESPONSE_STATUSES).toContain(s)
    }
    expect(new Set(RESPONSE_STATUSES).size).toBe(RESPONSE_STATUSES.length)
  })
})

describe('exit horizons drive when a lead comes back', () => {
  it('schedules sooner the closer the owner is to selling', () => {
    const days = (v: string) => EXIT_HORIZONS.find(h => h.value === v)!.days
    expect(days('now')).toBeLessThan(days('<1y')!)
    expect(days('<1y')).toBeLessThan(days('1-3y')!)
    expect(days('1-3y')).toBeLessThan(days('3-5y')!)
  })

  it('marks only never/sold as terminal, so every other answer is requeued', () => {
    const terminal = EXIT_HORIZONS.filter(h => h.days == null).map(h => h.value)
    expect(terminal).toEqual(['never', 'sold'])
  })

  it('every horizon a caller can pick is one isTerminalLead understands', () => {
    for (const h of EXIT_HORIZONS) {
      expect(isTerminalLead(lead({ exit_horizon: h.value }))).toBe(h.days == null)
    }
  })
})
