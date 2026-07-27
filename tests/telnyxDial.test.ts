import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CALLERS,
  eligibleFromNumbers,
  normalizeDigits,
  numberForCaller,
  pickFromPool,
  poolForCaller,
  signLead,
  verifyLeadSignature,
  type FromNumber,
} from '@/lib/telnyxDial'

// The dialer's promises, in order of blast radius:
// 1. NEVER dial out from a KI Consult customer's number (fail closed).
// 2. Each caller owns a fixed number; alone on shift you get the pool.
// 3. The public TwiML/recording routes only act on OUR signatures.

const n = (num: string): FromNumber => ({ id: num, phoneNumber: `+${num}`, digits: num })
const ELIGIBLE = [n('4723509652'), n('4723509651')] // deliberately unsorted

beforeEach(() => {
  process.env.APP_PASSWORD = 'test-pass'
  process.env.TELNYX_API_KEY = 'test-key'
})
afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.APP_PASSWORD
  delete process.env.TELNYX_API_KEY
})

describe('per-caller numbers', () => {
  it('gives Leonard and William each their own fixed number (sorted order)', () => {
    expect(numberForCaller('Leonard', ELIGIBLE)?.digits).toBe('4723509651')
    expect(numberForCaller('William', ELIGIBLE)?.digits).toBe('4723509652')
    // Case-insensitive: the UI stores whatever the human typed.
    expect(numberForCaller('william', ELIGIBLE)?.digits).toBe('4723509652')
  })

  it('an unknown caller falls back to the first number rather than none', () => {
    expect(numberForCaller('Vikar', ELIGIBLE)?.digits).toBe('4723509651')
  })

  it('roster order is the contract other systems assume', () => {
    expect(CALLERS).toEqual(['Leonard', 'William'])
  })
})

describe('solo-caller pool', () => {
  it('with the colleague active, each caller keeps ONLY their own number', () => {
    const pool = poolForCaller('Leonard', ELIGIBLE, ['William'])
    expect(pool.map(p => p.digits)).toEqual(['4723509651'])
  })

  it('alone on shift, the whole pool opens for rotation', () => {
    const pool = poolForCaller('Leonard', ELIGIBLE, ['Leonard'])
    expect(pool.map(p => p.digits)).toEqual(['4723509651', '4723509652'])
  })

  it('a non-roster name in the claims table does not lock the pool', () => {
    // Old/stale claims can carry arbitrary names; only real colleagues count.
    const pool = poolForCaller('Leonard', ELIGIBLE, ['Leonard', 'test-x'])
    expect(pool).toHaveLength(2)
  })

  it('pickFromPool only ever returns a member of the pool', () => {
    const pool = poolForCaller('Leonard', ELIGIBLE, [])
    for (let i = 0; i < 50; i++) {
      expect(pool).toContain(pickFromPool(pool))
    }
    expect(pickFromPool([])).toBeNull()
  })
})

describe('eligible numbers (the customer-number guardrail)', () => {
  it('excludes every reserved number from KI Consult', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL) => {
      const u = String(url)
      if (u.includes('api.telnyx.com')) {
        return new Response(JSON.stringify({ data: [
          { id: 'a', phone_number: '+4723509651' },
          { id: 'b', phone_number: '+4732994223' }, // Handz On — customer line
        ] }), { status: 200 })
      }
      return new Response(JSON.stringify({ reserved: ['4732994223'] }), { status: 200 })
    }))
    const eligible = await eligibleFromNumbers()
    expect(eligible.map(e => e.digits)).toEqual(['4723509651'])
  })

  it('FAILS CLOSED when the reserved list is unreachable — throws, never "all free"', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL) =>
      String(url).includes('api.telnyx.com')
        ? new Response(JSON.stringify({ data: [{ id: 'a', phone_number: '+4723509651' }] }), { status: 200 })
        : new Response('oops', { status: 500 }),
    ))
    await expect(eligibleFromNumbers()).rejects.toThrow(/reserved-numbers/)
  })

  it('fails closed on a malformed reserved response too', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL) =>
      String(url).includes('api.telnyx.com')
        ? new Response(JSON.stringify({ data: [] }), { status: 200 })
        : new Response(JSON.stringify({ nonsense: true }), { status: 200 }),
    ))
    await expect(eligibleFromNumbers()).rejects.toThrow(/uventet svar/)
  })
})

describe('lead signature', () => {
  it('roundtrips, and normalization is part of the contract', () => {
    const sig = signLead(normalizeDigits('+47 12 34 56 78'))
    expect(verifyLeadSignature('4712345678', sig)).toBe(true)
  })

  it('rejects tampered leads and truncated signatures', () => {
    const sig = signLead('4712345678')
    expect(verifyLeadSignature('4712345679', sig)).toBe(false)
    expect(verifyLeadSignature('4712345678', sig.slice(0, 10))).toBe(false)
    expect(verifyLeadSignature('4712345678', '')).toBe(false)
  })
})

describe('call outcome explanations', () => {
  it('stays silent for states that are fine', async () => {
    const { explainCall } = await import('@/lib/telnyxDial')
    for (const s of ['queued', 'initiated', 'ringing', 'in-progress', 'completed']) {
      expect(explainCall(s, null)).toBeNull()
    }
  })

  it('names the Norwegian CLI block for 603/busy instead of silent failure', async () => {
    const { explainCall } = await import('@/lib/telnyxDial')
    expect(explainCall('busy', '603')).toMatch(/norsk avsendernummer/i)
    expect(explainCall('failed', '603')).toMatch(/603/)
  })

  it('reports no-answer and generic failures distinctly', async () => {
    const { explainCall } = await import('@/lib/telnyxDial')
    expect(explainCall('no-answer', null)).toMatch(/Ingen svarte/)
    expect(explainCall('failed', '480')).toMatch(/480/)
  })
})
