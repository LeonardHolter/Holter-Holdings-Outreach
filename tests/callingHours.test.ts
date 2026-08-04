import { describe, expect, it } from 'vitest'
import { isCallingClosed, osloHour } from '@/lib/callingHours'

// The 16:00 cutoff is pinned to Oslo time, so what matters here is that the
// conversion from an absolute instant honours Norway's UTC offset in both
// halves of the year: CEST (UTC+2) in summer, CET (UTC+1) in winter.

describe('calling hours (16:00 Oslo cutoff)', () => {
  it('is open during the workday', () => {
    // 13:00 UTC in August = 15:00 Oslo (CEST)
    expect(isCallingClosed(new Date('2026-08-04T13:00:00Z'))).toBe(false)
  })

  it('closes exactly at 16:00 Oslo', () => {
    // 14:00 UTC in August = 16:00 Oslo (CEST)
    expect(isCallingClosed(new Date('2026-08-04T14:00:00Z'))).toBe(true)
  })

  it('is still open at 15:59 Oslo', () => {
    expect(isCallingClosed(new Date('2026-08-04T13:59:00Z'))).toBe(false)
  })

  it('stays closed through the evening', () => {
    // 21:30 UTC = 23:30 Oslo
    expect(isCallingClosed(new Date('2026-08-04T21:30:00Z'))).toBe(true)
  })

  it('reopens after midnight Oslo', () => {
    // 23:00 UTC Aug 4 = 01:00 Oslo Aug 5
    expect(isCallingClosed(new Date('2026-08-04T23:00:00Z'))).toBe(false)
  })

  it('respects winter time (CET, UTC+1)', () => {
    // 15:30 UTC in January = 16:30 Oslo → closed
    expect(isCallingClosed(new Date('2026-01-15T15:30:00Z'))).toBe(true)
    // 14:30 UTC in January = 15:30 Oslo → open
    expect(isCallingClosed(new Date('2026-01-15T14:30:00Z'))).toBe(false)
  })

  it('osloHour handles midnight without returning 24', () => {
    // 22:00 UTC in August = 00:00 Oslo next day
    expect(osloHour(new Date('2026-08-04T22:00:00Z'))).toBe(0)
  })
})
