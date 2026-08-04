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
 * Today's target under the ±1 rule: 60, or double if yesterday fell short
 * AND wasn't already rescued by a double the day before it. (If yesterday
 * missed and the day before didn't double, only a 120 today saves the
 * streak — that's the debt this banner surfaces.)
 */
export function todaysTarget(yesterdayCalls: number, dayBeforeCalls: number, goal = GOAL): number {
  const yesterdayFine = yesterdayCalls >= goal || dayBeforeCalls >= goal * 2
  return yesterdayFine ? goal : goal * 2
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
