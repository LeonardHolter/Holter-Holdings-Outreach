import { describe, expect, it } from 'vitest'
import { aggregate, aggregateEvents, revenueTierPerf } from '@/components/DailyStats'
import type { StatRow, CallEvent } from '@/app/stats/page'

// The rule these tests exist to protect: pickup is the ONLY rate measured
// against every dial. Everything else describes what happened inside a
// conversation, so it divides by answered calls — otherwise every conversion
// number is silently multiplied by the pickup rate and a bad-pickup day looks
// like a bad-pitch day.

const row = (r: Partial<StatRow> & { n: number }): StatRow => ({
  date: '2026-07-30',
  who_called: 'Leonard',
  reach_out_response: null,
  demo_outcome: null,
  ...r,
})

// 100 calls: 40 no-answer, 60 answered — of which 12 demos (6 won), 18 not interested.
const ROWS: StatRow[] = [
  row({ n: 40, reach_out_response: 'No answer' }),
  row({ n: 12, reach_out_response: 'Demo booked' }),
  row({ n: 6, reach_out_response: 'Demo booked', demo_outcome: 'Won' }),
  row({ n: 18, reach_out_response: 'Not interested' }),
  row({ n: 24, reach_out_response: 'Call back later' }),
]

describe('conversation rates divide by answered calls', () => {
  const m = aggregate(ROWS)

  it('counts calls and answered correctly', () => {
    expect(m.calls).toBe(100)
    expect(m.answered).toBe(60)
  })

  it('pickup — and only pickup — is measured against every dial', () => {
    expect(m.pickupRate).toBeCloseTo(60 / 100, 6)
  })

  it('demo rate uses answered, not total dials', () => {
    // 18 demos of 60 answered = 30%. Against 100 dials it would read 18%.
    expect(m.demos).toBe(18)
    expect(m.demoRate).toBeCloseTo(18 / 60, 6)
    expect(m.demoRate).not.toBeCloseTo(18 / 100, 6)
  })

  it('won rate uses answered, not total dials', () => {
    expect(m.won).toBe(6)
    expect(m.wonRate).toBeCloseTo(6 / 60, 6)
    expect(m.wonRate).not.toBeCloseTo(6 / 100, 6)
  })

  it('not-interested uses answered — an unanswered phone cannot decline', () => {
    expect(m.notInterestedRate).toBeCloseTo(18 / 60, 6)
    expect(m.notInterestedRate).not.toBeCloseTo(18 / 100, 6)
  })

  it('a day with zero answered calls yields 0, never NaN or Infinity', () => {
    const none = aggregate([row({ n: 25, reach_out_response: 'No answer' })])
    expect(none.answered).toBe(0)
    for (const r of [none.demoRate, none.wonRate, none.notInterestedRate]) {
      expect(Number.isFinite(r)).toBe(true)
      expect(r).toBe(0)
    }
    expect(none.pickupRate).toBe(0)
  })
})

const ev = (response: string, extra: Partial<CallEvent> = {}): CallEvent => ({
  company_id: 'c1',
  caller_name: 'Leonard',
  response,
  reached_decision_maker: false,
  revenue_at_call: null,
  created_at: '2026-07-30T10:00:00Z',
  ...extra,
})

describe('event-derived rates', () => {
  // 10 dials: 6 answered, 4 no-answer. 3 reached the decision-maker, 2 booked.
  const EVENTS: CallEvent[] = [
    ...Array.from({ length: 4 }, () => ev('No answer')),
    ev('Demo booked', { reached_decision_maker: true }),
    ev('Demo booked', { reached_decision_maker: true }),
    ev('Not interested', { reached_decision_maker: true }),
    ev('Not interested'),
    ev('Call back later'),
    ev('Call back later'),
  ]

  it('DM-reached rate uses answered — you cannot reach anyone on a dead line', () => {
    const em = aggregateEvents(EVENTS)
    expect(em.dials).toBe(10)
    expect(em.answered).toBe(6)
    expect(em.dmReached).toBe(3)
    expect(em.dmReachedRate).toBeCloseTo(3 / 6, 6)
    expect(em.dmReachedRate).not.toBeCloseTo(3 / 10, 6)
  })

  it('dials-per-demo stays per DIAL — it is a volume metric, not a conversion one', () => {
    expect(aggregateEvents(EVENTS).dialsPerDemo).toBeCloseTo(10 / 2, 6)
  })

  it('DM→demo divides by DM-reached calls, the pure closing number', () => {
    expect(aggregateEvents(EVENTS).dmToDemoRate).toBeCloseTo(2 / 3, 6)
  })

  it('revenue-tier demo rate uses answered, so a tier that just picks up more does not look better', () => {
    const tierEvents: CallEvent[] = [
      ...Array.from({ length: 8 }, () => ev('No answer', { revenue_at_call: 2000 })),
      ev('Demo booked', { revenue_at_call: 2000 }),
      ev('Not interested', { revenue_at_call: 2000 }),
    ]
    const [tier] = revenueTierPerf(tierEvents)
    expect(tier.tier).toBe('1–5M')
    expect(tier.dials).toBe(10)
    expect(tier.answered).toBe(2)
    // 1 demo of 2 answered = 50%; per dial it would read a misleading 10%.
    expect(tier.demoRate).toBeCloseTo(1 / 2, 6)
    expect(tier.demoRate).not.toBeCloseTo(1 / 10, 6)
  })
})
