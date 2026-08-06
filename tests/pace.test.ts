import { describe, expect, it } from 'vitest'
import { avgSecondsPerCall, estimatedFinish, todaysTarget } from '@/lib/pace'
import { GOAL } from '@/components/DailyStats'

// The banner's three questions, pinned: what does today actually require
// (60 or the 120 ±1 debt), how fast are we going (breaks must not count),
// and when will we be done.

const DOUBLE = GOAL * 2

describe('todaysTarget (carry model: surplus and debt carry one day, spent when used)', () => {
  it('is the plain goal in steady state', () => {
    expect(todaysTarget(GOAL, GOAL)).toBe(GOAL)
  })

  it('owes the two-day remainder — 8 yesterday means 112 today', () => {
    expect(todaysTarget(8, GOAL)).toBe(DOUBLE - 8)
  })

  it('owes the full 120 when yesterday was zero and unrescued', () => {
    expect(todaysTarget(0, 0)).toBe(DOUBLE)
  })

  it("a make-up day's surplus is spent — after 8 then 113, today is 59, not 7", () => {
    // The William case: 112 of the 113 were consumed covering the 8-day.
    // Only the single leftover call discounts today.
    expect(todaysTarget(113, 8)).toBe(GOAL - 1)
    expect(todaysTarget(DOUBLE - 8, 8)).toBe(GOAL) // exact payment, nothing left
  })

  it('unspent surplus discounts today — 90 yesterday means 30 today', () => {
    expect(todaysTarget(90, GOAL)).toBe(30)
  })

  it('earns a day off after an unencumbered 120-day', () => {
    expect(todaysTarget(DOUBLE, GOAL)).toBe(0)
    expect(todaysTarget(DOUBLE + 15, GOAL)).toBe(0)
  })

  it('a 120-day that also had debt to pay does NOT earn the day off', () => {
    // 0 two days ago: yesterday's 120 went 60 to itself, 60 to the debt.
    expect(todaysTarget(DOUBLE, 0)).toBe(GOAL)
  })

  it('is back to the plain goal the day after an earned day off', () => {
    expect(todaysTarget(0, DOUBLE)).toBe(GOAL)
  })

  it('surplus never relays through a day that just did its job', () => {
    // 113 Monday, 60 Tuesday: Monday's leftover discounted Tuesday's
    // requirement, but Tuesday rang nothing beyond its own 60 — so nothing
    // carries to Wednesday. (The bug: Wednesday was offered for 7.)
    expect(todaysTarget(GOAL, 113)).toBe(GOAL)
  })

  it('a day passes on at most what it rang beyond its own goal', () => {
    // Free day (after a 120) with 8 calls on it: 8 < 60, nothing carries.
    expect(todaysTarget(8, DOUBLE)).toBe(GOAL)
    // Debt day paid with room to spare: 150 covers 60 own + 52 debt, and
    // the genuine leftover 38 discounts today.
    expect(todaysTarget(150, 8)).toBe(GOAL - 38)
  })

  it('debt expires after one day — today never inherits two-day-old misses', () => {
    // Yesterday made its own 60 but not the day-before's missing 60; that
    // debt died with yesterday. Today owes a plain 60.
    expect(todaysTarget(GOAL, 0)).toBe(GOAL)
  })

  it('a near-miss yesterday costs today exactly the shortfall', () => {
    expect(todaysTarget(GOAL - 1, GOAL)).toBe(GOAL + 1)
  })
})

const at = (minutes: number) => new Date(2026, 7, 4, 9, minutes).toISOString()

describe('avgSecondsPerCall', () => {
  it('averages the gaps between consecutive calls', () => {
    // gaps: 4 min, 6 min → 5 min average
    expect(avgSecondsPerCall([at(0), at(4), at(10)])).toBe(300)
  })

  it('ignores break-length gaps so lunch does not count as a call', () => {
    // gaps: 4, 40 (break — dropped), 6 → avg of [4, 6] = 5 min
    expect(avgSecondsPerCall([at(0), at(4), at(44), at(50)])).toBe(300)
  })

  it('needs at least 3 calls before claiming a pace', () => {
    expect(avgSecondsPerCall([])).toBeNull()
    expect(avgSecondsPerCall([at(0), at(4)])).toBeNull()
  })

  it('gives up when breaks leave fewer than two usable gaps', () => {
    expect(avgSecondsPerCall([at(0), at(20), at(40)])).toBeNull()
  })
})

describe('estimatedFinish', () => {
  const now = new Date(2026, 7, 4, 12, 0)

  it('projects remaining calls at the measured pace', () => {
    // 50 done of 60, 2 min per call → done in 20 minutes
    const eta = estimatedFinish(now, 50, 60, 120)
    expect(eta?.getHours()).toBe(12)
    expect(eta?.getMinutes()).toBe(20)
  })

  it('is null once the target is met', () => {
    expect(estimatedFinish(now, 60, 60, 120)).toBeNull()
  })

  it('is null without a pace', () => {
    expect(estimatedFinish(now, 10, 60, null)).toBeNull()
  })
})
