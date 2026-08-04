import { describe, expect, it } from 'vitest'
import { industryPerf } from '@/components/DailyStats'
import type { CallEvent } from '@/app/stats/page'

// Industry performance follows the same discipline as every other rate on
// /stats: demo rate divides by ANSWERED calls, pickup by dials. These tests
// pin the grouping, the null-industry bucket, and the best-first ordering.

const ev = (e: Partial<CallEvent>): CallEvent => ({
  company_id: 'x',
  caller_name: 'Leonard',
  response: 'No answer',
  reached_decision_maker: null,
  revenue_at_call: null,
  industry: null,
  created_at: '2026-08-04T10:00:00Z',
  ...e,
})

describe('industryPerf', () => {
  it('groups by industry with answered-based demo rate and dial-based pickup', () => {
    const events = [
      // Rørlegger: 4 dials, 2 answered, 1 demo
      ev({ industry: 'Rørlegger', response: 'No answer' }),
      ev({ industry: 'Rørlegger', response: 'No answer' }),
      ev({ industry: 'Rørlegger', response: 'Not interested' }),
      ev({ industry: 'Rørlegger', response: 'Demo booked' }),
      // Bilverksted: 2 dials, 1 answered, 0 demos
      ev({ industry: 'Bilverksted', response: 'No answer' }),
      ev({ industry: 'Bilverksted', response: 'Call back later' }),
    ]
    const [ror, bil] = industryPerf(events)
    expect(ror).toEqual({
      industry: 'Rørlegger', dials: 4, answered: 2, demos: 1,
      pickupRate: 0.5, demoRate: 0.5,
    })
    expect(bil).toEqual({
      industry: 'Bilverksted', dials: 2, answered: 1, demos: 0,
      pickupRate: 0.5, demoRate: 0,
    })
  })

  it('ranks the best demo rate first', () => {
    const events = [
      ev({ industry: 'A', response: 'Not interested' }),
      ev({ industry: 'B', response: 'Demo booked' }),
    ]
    expect(industryPerf(events).map(i => i.industry)).toEqual(['B', 'A'])
  })

  it('breaks demo-rate ties on pickup, so demo-less industries still order', () => {
    const events = [
      ev({ industry: 'A', response: 'No answer' }),
      ev({ industry: 'A', response: 'No answer' }),
      ev({ industry: 'B', response: 'Not interested' }), // 100% pickup, 0 demos
      ev({ industry: 'A', response: 'Not interested' }), // A: 33% pickup
    ]
    expect(industryPerf(events).map(i => i.industry)).toEqual(['B', 'A'])
  })

  it('buckets untagged and deleted companies as Ukjent', () => {
    const events = [ev({ industry: null, response: 'Not interested' })]
    const [row] = industryPerf(events)
    expect(row.industry).toBe('Ukjent')
    expect(row.demoRate).toBe(0)
  })

  it('demo rate is null, not zero, when nothing was answered', () => {
    const events = [ev({ industry: 'A', response: 'No answer' })]
    expect(industryPerf(events)[0].demoRate).toBeNull()
  })
})
