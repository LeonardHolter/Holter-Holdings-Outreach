import { describe, expect, it } from 'vitest'
import { avgSecondsPerCall, estimatedFinish, todaysTarget } from '@/lib/pace'
import { GOAL } from '@/components/DailyStats'

// The banner's three questions, pinned: what does today actually require
// (60 or the 120 ±1 debt), how fast are we going (breaks must not count),
// and when will we be done.

const DOUBLE = GOAL * 2

describe('todaysTarget', () => {
  it('is the plain goal when yesterday made it', () => {
    expect(todaysTarget(GOAL, 0)).toBe(GOAL)
  })

  it('doubles when yesterday fell short and nothing rescued it', () => {
    expect(todaysTarget(GOAL - 1, 0)).toBe(DOUBLE)
    expect(todaysTarget(0, 0)).toBe(DOUBLE)
  })

  it('stays at the plain goal when the day before already rescued yesterday', () => {
    expect(todaysTarget(0, DOUBLE)).toBe(GOAL)
  })

  it('needs the full double from the day before — 119 rescues nothing', () => {
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
