import { describe, expect, it } from 'vitest'
import { callStreak, GOAL } from '@/components/DailyStats'

// The ±1 rule, carry model: every day owes 60; surplus and debt carry
// exactly one day and are SPENT when used — nothing counts twice. A streak
// is the one number on this page that punishes you, so the edges matter.

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

  it('has no streak at all when nothing was logged', () => {
    expect(streak({})).toBe(0)
  })

  it('a short day whose rescue window closed breaks the chain behind it', () => {
    // Two days ago: 59, one short. Yesterday made its own 60 but not the
    // extra 1, and yesterday is finished — so the 59-day is dead and the
    // chain restarts at yesterday. (Today, unfinished at 60, also counts.)
    expect(streak({ 0: GOAL, [-1]: GOAL, [-2]: GOAL - 1, [-3]: GOAL })).toBe(2)
  })
})

describe('the ±1 rule (surplus and debt carry one day, spent when used)', () => {
  it('a 120-day earns the NEXT day off', () => {
    expect(streak({ 0: 10, [-1]: DOUBLE, [-2]: GOAL })).toBe(3)
  })

  it('a make-up day pays the day BEFORE it', () => {
    expect(streak({ 0: GOAL, [-1]: DOUBLE, [-2]: 0 })).toBe(3)
  })

  it('splits the 120 freely across the pair — 8 then 112 works', () => {
    expect(streak({ 0: DOUBLE - 8, [-1]: 8, [-2]: GOAL })).toBe(3)
  })

  it('alternating 120 / 0 / 120 holds', () => {
    expect(streak({ 0: DOUBLE, [-1]: 0, [-2]: DOUBLE })).toBe(3)
  })

  it('the same surplus never counts twice', () => {
    // 8 / 112 / today: the 112 was consumed covering the 8-day, so it
    // cannot also cover today — today (unfinished, 8 calls in) is simply
    // not in the streak yet, and the two paid days count.
    expect(streak({ 0: 8, [-1]: DOUBLE - 8, [-2]: 8, [-3]: GOAL })).toBe(3)
  })

  it('a partial payment saves nobody', () => {
    // 8 / 104: the 104 covers its own 60 but only 44 of the 52 owed — the
    // 8-day dies, the 104-day starts a fresh chain of 1 (today, at 8 calls
    // so far, is pending on its 16 remaining).
    expect(streak({ 0: 8, [-1]: DOUBLE - 16, [-2]: 8, [-3]: GOAL })).toBe(1)
  })

  it('debt expires after one day — it never compounds', () => {
    // The 0-day is beyond rescue by the time today starts; yesterday paid
    // its own 60 and the chain restarted there.
    expect(streak({ 0: GOAL, [-1]: GOAL, [-2]: 0, [-3]: GOAL })).toBe(2)
  })

  it('does not invent streak days from before the first logged call', () => {
    expect(streak({ 0: DOUBLE })).toBe(1)
  })
})

describe('today is never counted against you', () => {
  it('keeps the streak alive while today is still unfinished', () => {
    expect(streak({ 0: 12, [-1]: GOAL, [-2]: GOAL })).toBe(2)
  })

  it('adds today to the streak as soon as it meets its requirement', () => {
    expect(streak({ 0: GOAL, [-1]: GOAL, [-2]: GOAL })).toBe(3)
  })

  it('still counts yesterday when nothing at all is logged today', () => {
    expect(streak({ [-1]: GOAL, [-2]: GOAL })).toBe(2)
  })

  it('counts a pending yesterday optimistically — today can still pay it', () => {
    // Yesterday 8: dead only if today ends below 112. At breakfast the
    // streak must not already read as broken.
    expect(streak({ [-1]: 8, [-2]: GOAL, [-3]: GOAL })).toBe(3)
  })
})
