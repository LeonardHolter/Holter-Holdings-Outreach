// Calling hours: 16:00 Oslo time is the target end of the calling day.
//
// Pinned to Europe/Oslo regardless of where the caller sits. It is no longer
// enforced — PaceBanner only uses it to warn when the pace runs past it.

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
