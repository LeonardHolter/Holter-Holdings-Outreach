import { describe, expect, it } from 'vitest'
import { avgSecondsPerCall, estimatedFinish, todaysTarget } from '@/lib/pace'
import { GOAL } from '@/components/DailyStats'

// The banner's three questions, pinned: what does today actually require
// (60 or the 120 ±1 debt), how fast are we going (breaks must not count),
// and when will we be done.

const DOUBLE = GOAL * 2

describe('todaysTarget (120 over two consecutive days)', () => {
  it('is the plain goal in steady state', () => {
    expect(todaysTarget(GOAL, GOAL)).toBe(GOAL)
    expect(todaysTarget(GOAL, 0)).toBe(GOAL)
  })

  it('owes exactly the two-day remainder — 8 yesterday means 112 today', () => {
    expect(todaysTarget(8, 0)).toBe(DOUBLE - 8)
  })

  it('owes the full 120 when yesterday was zero and unrescued', () => {
    expect(todaysTarget(0, 0)).toBe(DOUBLE)
  })

  it('shrinks below the goal when yesterday overshot — 90 yesterday means 30 today', () => {
    expect(todaysTarget(90, 0)).toBe(DOUBLE - 90)
  })

  it('earns a day off after a 120-day', () => {
    expect(todaysTarget(DOUBLE, 0)).toBe(0)
    expect(todaysTarget(DOUBLE + 15, 0)).toBe(0)
  })

  it('is back to the plain goal the day after an earned day off', () => {
    // 120, then 0 (covered by the 120), then a normal day again.
    expect(todaysTarget(0, DOUBLE)).toBe(GOAL)
  })

  it("a short yesterday already covered by the day before doesn't re-charge today", () => {
    // 120 two days ago covered yesterday's 8 (128 ≥ 120); today just owes
    // its own share of the next window: 120 − 8 capped at 60.
    expect(todaysTarget(8, DOUBLE)).toBe(GOAL)
  })

  it('needs the full pair sum — 119 across two days rescues nothing', () => {
    expect(todaysTarget(0, DOUBLE - 1)).toBe(DOUBLE)
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
