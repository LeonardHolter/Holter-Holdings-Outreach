// Calling hours: no outbound calls after 16:00 Oslo time.
//
// The cutoff is about the person answering, so it's pinned to Europe/Oslo
// regardless of where the caller happens to sit. Enforced in two places: the
// /call page UI (CallingHoursGate replaces the dialer) and the Telnyx call
// API (a click-to-call request after hours is refused server-side).

export const CALL_CUTOFF_HOUR = 16

/** Hour of day (0–23) in Oslo for the given moment. */
export function osloHour(now: Date = new Date()): number {
  return Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Oslo',
      hour: 'numeric',
      hour12: false,
    }).format(now),
  )
}

/** True from 16:00 Oslo time until midnight — no calls in that window. */
export function isCallingClosed(now: Date = new Date()): boolean {
  return osloHour(now) >= CALL_CUTOFF_HOUR
}
