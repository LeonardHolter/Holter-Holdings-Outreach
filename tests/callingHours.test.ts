import { describe, expect, it } from 'vitest'
import { osloHour } from '@/lib/callingHours'

describe('osloHour', () => {
  it('honours summer time (CEST, UTC+2)', () => {
    expect(osloHour(new Date('2026-08-04T14:00:00Z'))).toBe(16)
  })

  it('honours winter time (CET, UTC+1)', () => {
    expect(osloHour(new Date('2026-01-15T15:30:00Z'))).toBe(16)
  })

  it('handles midnight without returning 24', () => {
    // 22:00 UTC in August = 00:00 Oslo next day
    expect(osloHour(new Date('2026-08-04T22:00:00Z'))).toBe(0)
  })
})
