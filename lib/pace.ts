import { GOAL } from '@/lib/goals'

// Pace math for the banner above the dialer: how many calls today's goal
// actually requires, how fast the team is dialling, and when they'll be done.
// Pure functions — the API supplies counts and timestamps, the client
// supplies "now".

/** Ignore gaps longer than this when averaging call pace: a 40-minute hole
 *  is lunch, not how long a call takes, and counting it would push the
 *  estimate into fiction. */
const BREAK_GAP_SECONDS = 15 * 60

/**
 * Today's target under the ±1 rule, carry model: every day owes 60, and
 * surplus or debt carries exactly ONE day — and is SPENT when used, never
 * counted twice.
 *
 *  - 8 yesterday → 112 today (own 60 + yesterday's missing 52).
 *  - 8 two days ago, 113 yesterday → 59 today: 112 of the 113 were consumed
 *    covering the 8-day, so today starts fresh at 60 minus the 1 left over.
 *    (The old mistake: letting the same 113 also subsidise today.)
 *  - 120 yesterday with no debt to pay → 0 today, the day off is earned;
 *    the day after a day off is a plain 60.
 *
 * A day that made its own 60 but couldn't also cover yesterday's debt lets
 * yesterday die without owing today anything extra — debt only carries one
 * day, so it expires unpaid rather than compounding.
 *
 * Crucially, surplus never RELAYS: what a day passes on is capped at what
 * that day itself rang beyond 60. A 113-day discounts the next day, but if
 * that next day just rings its plain 60, the leftover 53 dies there — it
 * cannot travel through to the day after. (The bug this cap fixed: 113,
 * then 60, and the banner offered day three for 7.)
 *
 * Implemented as a two-day walk of the same simulation callStreak runs, so
 * the banner and the streak can never disagree about what today requires.
 */
export function todaysTarget(yesterdayCalls: number, dayBeforeCalls: number, goal = GOAL): number {
  let carry = 0
  let debt = 0
  for (const calls of [dayBeforeCalls, yesterdayCalls]) {
    const need = Math.max(0, goal + debt - carry)
    if (calls >= need) {
      // Surplus out = what's left after obligations, capped at what THIS
      // day rang beyond its own goal — inherited carry expires, no relay.
      carry = Math.max(0, Math.min(calls - need, calls - goal))
      debt = 0
    } else if (calls >= goal) {
      // Own day fine, inherited debt unpayable — it expires, chain resets.
      carry = calls - goal
      debt = 0
    } else {
      debt = Math.max(0, goal - calls - carry)
      carry = 0
    }
  }
  return Math.max(0, goal + debt - carry)
}

/**
 * Average seconds per call from today's call timestamps (ISO, ascending),
 * using the gaps between consecutive calls minus anything that looks like a
 * break. Null until there are at least 3 calls — one gap is an anecdote,
 * not a pace.
 */
export function avgSecondsPerCall(timestamps: string[]): number | null {
  if (timestamps.length < 3) return null
  const gaps: number[] = []
  for (let i = 1; i < timestamps.length; i++) {
    const gap = (new Date(timestamps[i]).getTime() - new Date(timestamps[i - 1]).getTime()) / 1000
    if (gap > 0 && gap <= BREAK_GAP_SECONDS) gaps.push(gap)
  }
  if (gaps.length < 2) return null
  return gaps.reduce((s, g) => s + g, 0) / gaps.length
}

/** Estimated finish time, or null when there's no pace yet or nothing left. */
export function estimatedFinish(
  now: Date,
  callsToday: number,
  target: number,
  secondsPerCall: number | null,
): Date | null {
  const remaining = target - callsToday
  if (remaining <= 0 || secondsPerCall == null) return null
  return new Date(now.getTime() + remaining * secondsPerCall * 1000)
}
