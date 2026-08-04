import { describe, expect, it } from 'vitest'
import { callStreak, GOAL } from '@/components/DailyStats'

// The ±1 rule, pinned down. A streak is the one number on this page that
// punishes you, so the edges matter: what exactly rescues a missed day, what
// doesn't, and the fact that an unfinished today must never look like a break.

const TODAY = '2026-08-03'
const DOUBLE = GOAL * 2

/** Days keyed by offset from TODAY: { 0: 60, '-1': 120 } reads as "today 60,
 *  yesterday 120". */
const days = (spec: Record<number, number>): Map<string, number> => {
  const m = new Map<string, number>()
  for (const [offset, calls] of Object.entries(spec)) {
    const d = new Date(2026, 7, 3)
    d.setDate(d.getDate() + Number(offset))
    m.set(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
      calls,
    )
  }
  return m
}

const streak = (spec: Record<number, number>) => callStreak(days(spec), TODAY)

describe('goal streak', () => {
  it('counts consecutive days that hit the goal', () => {
    expect(streak({ 0: GOAL, [-1]: GOAL, [-2]: GOAL })).toBe(3)
  })

  it('counts a day that lands exactly on the goal', () => {
    expect(streak({ 0: GOAL })).toBe(1)
  })

  it('breaks on a short day with no double beside it', () => {
    expect(streak({ 0: GOAL, [-1]: GOAL - 1, [-2]: GOAL })).toBe(1)
  })

  it('has no streak at all when nothing was logged', () => {
    expect(streak({})).toBe(0)
  })
})

describe('the ±1 rule (120 over two consecutive days)', () => {
  it('rescues a missed day when the day BEFORE doubled', () => {
    expect(streak({ 0: 10, [-1]: DOUBLE, [-2]: GOAL })).toBe(3)
  })

  it('rescues a missed day when the day AFTER doubled', () => {
    expect(streak({ 0: GOAL, [-1]: DOUBLE, [-2]: 0 })).toBe(3)
  })

  it('splits the 120 freely across the pair — 8 then 112 works', () => {
    expect(streak({ 0: DOUBLE - 8, [-1]: 8, [-2]: GOAL })).toBe(3)
  })

  it('rescues a day with zero calls on it — that is the point of the rule', () => {
    expect(streak({ 0: DOUBLE, [-1]: 0, [-2]: DOUBLE })).toBe(3)
  })

  it('needs the full pair sum: 119 across two days rescues nothing', () => {
    expect(streak({ 0: GOAL, [-1]: 10, [-2]: DOUBLE - 11 })).toBe(1)
  })

  it('a surplus cannot be spent twice on the same side pair', () => {
    // 8 / 112 / 8: the 112 covers BOTH neighbours (8+112 ≥ 120 each way) —
    // that is what "max one day buffer" allows, and no more: the outer 8s
    // would each need their other neighbour to chip in.
    expect(streak({ 0: 8, [-1]: DOUBLE - 8, [-2]: 8, [-3]: GOAL })).toBe(4)
    // …but with 8 / 104 / 8 the pairs only reach 112: the 104-day stands on
    // its own (≥ 60), while both 8-days fall — streak is that one day.
    expect(streak({ 0: 8, [-1]: DOUBLE - 16, [-2]: 8, [-3]: GOAL })).toBe(1)
  })

  it('reaches exactly one day — a double two days away does not carry', () => {
    // -3 doubled, but the day that fell short is -1, two days off. It would
    // have rescued -2; the streak never gets that far.
    expect(streak({ 0: GOAL, [-1]: 0, [-2]: 0, [-3]: DOUBLE })).toBe(1)
  })

  it('does not invent streak days from before the first logged call', () => {
    // A first-ever day of 120 must not rescue the empty day before it.
    expect(streak({ 0: DOUBLE })).toBe(1)
  })
})

describe('today is never counted against you', () => {
  it('keeps the streak alive while today is still unfinished', () => {
    // 12 calls in so far — the day is not over, so it must not read as a break.
    expect(streak({ 0: 12, [-1]: GOAL, [-2]: GOAL })).toBe(2)
  })

  it('adds today to the streak as soon as it makes the goal', () => {
    expect(streak({ 0: GOAL, [-1]: GOAL, [-2]: GOAL })).toBe(3)
  })

  it('still counts yesterday when nothing at all is logged today', () => {
    expect(streak({ [-1]: GOAL, [-2]: GOAL })).toBe(2)
  })
})
