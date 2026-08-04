import { GOAL } from '@/components/DailyStats'

// Pace math for the banner above the dialer: how many calls today's goal
// actually requires, how fast the team is dialling, and when they'll be done.
// Pure functions — the API supplies counts and timestamps, the client
// supplies "now".

/** Ignore gaps longer than this when averaging call pace: a 40-minute hole
 *  is lunch, not how long a call takes, and counting it would push the
 *  estimate into fiction. */
const BREAK_GAP_SECONDS = 15 * 60

/**
 * Today's target under the ±1 rule: 120 over two consecutive days,
 * distributed however you like. Two obligations decide the number:
 *
 *  - If yesterday fell short of 60 and yesterday + the day before didn't
 *    reach 120, yesterday is still uncovered and only today can save it:
 *    today must bring the two-day sum to 120 (8 yesterday → 112 today).
 *  - Today itself needs covering too: 60 on its own, or enough that
 *    yesterday + today reaches 120 — whichever is less. After a 120-day,
 *    that's 0: the day off is earned.
 *
 * The target is whichever obligation is larger. Steady state is 60.
 */
export function todaysTarget(yesterdayCalls: number, dayBeforeCalls: number, goal = GOAL): number {
  const double = goal * 2
  const yesterdayCovered = yesterdayCalls >= goal || yesterdayCalls + dayBeforeCalls >= double
  const oweForYesterday = yesterdayCovered ? 0 : double - yesterdayCalls
  const oweForToday = Math.min(goal, Math.max(0, double - yesterdayCalls))
  return Math.max(oweForYesterday, oweForToday)
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
