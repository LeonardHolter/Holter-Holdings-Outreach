import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { signLead } from '@/lib/telnyxDial'

// Route-level contracts for the three Telnyx endpoints. The db and Telnyx
// are mocked; what's pinned is the DECISIONS: who gets refused, what gets
// recorded, and that no path can dial or fetch something we didn't sign.

const { queryMock } = vi.hoisted(() => ({
  queryMock: vi.fn(async (_sql?: unknown, _params?: unknown): Promise<Record<string, unknown>[]> => []),
}))
vi.mock('@/lib/db', () => ({ query: queryMock }))

import { POST as twiml } from '@/app/api/telnyx/twiml/route'
import { POST as recording } from '@/app/api/telnyx/recording/route'
import { POST as call } from '@/app/api/telnyx/call/route'

const req = (url: string, init?: RequestInit) => new NextRequest(new Request(url, init))

const BASE = 'http://test'
const S3_OK =
  'https://s3.amazonaws.com/telephony-recorder-prod/x/y.mp3?X-Amz-Signature=abc'

beforeEach(() => {
  queryMock.mockReset()
  queryMock.mockResolvedValue([])
  process.env.APP_PASSWORD = 'test-pass'
  process.env.TELNYX_API_KEY = 'k'
  process.env.TELNYX_TEXML_ACCOUNT_SID = 'acc'
  process.env.TELNYX_TEXML_APP_SID = 'app'
  process.env.OUTREACH_AGENT_PHONE = '+4798361774'
})
afterEach(() => {
  vi.unstubAllGlobals()
  for (const k of ['APP_PASSWORD', 'TELNYX_API_KEY', 'TELNYX_TEXML_ACCOUNT_SID', 'TELNYX_TEXML_APP_SID', 'OUTREACH_AGENT_PHONE'])
    delete process.env[k]
})

describe('twiml route', () => {
  it('signed: dials the lead, recorded dual-channel, callback carries the same sig', async () => {
    const sig = signLead('4712345678')
    const res = await twiml(req(`${BASE}/api/telnyx/twiml?lead=4712345678&sig=${sig}&caller=Leonard&from=%2B4723509651`, { method: 'POST' }))
    const xml = await res.text()
    expect(xml).toContain('record="record-from-answer"')
    expect(xml).toContain('recordingChannels="dual"')
    expect(xml).toContain('/api/telnyx/recording?lead=4712345678')
    expect(xml).toContain(`sig=${sig}`)
    expect(xml).toContain('>+4712345678</Dial>')
    // The callback URL's & must be XML-escaped or Telnyx rejects the doc.
    expect(xml).toContain('&amp;')
  })

  it('unsigned: forwards to the agent phone (a lead calling back), never a caller-chosen number', async () => {
    const res = await twiml(req(`${BASE}/api/telnyx/twiml?lead=4712345678&sig=WRONG`, { method: 'POST' }))
    const xml = await res.text()
    expect(xml).toContain('<Dial>+4798361774</Dial>')
    expect(xml).not.toContain('4712345678')
  })

  it('unsigned with no agent configured: hangs up', async () => {
    delete process.env.OUTREACH_AGENT_PHONE
    const res = await twiml(req(`${BASE}/api/telnyx/twiml?lead=4712345678&sig=WRONG`, { method: 'POST' }))
    expect(await res.text()).toContain('<Hangup/>')
  })
})

describe('recording route', () => {
  const form = (fields: Record<string, string>) => {
    const fd = new URLSearchParams(fields)
    return { method: 'POST', body: fd, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  }
  const signedUrl = (lead = '4712345678') =>
    `${BASE}/api/telnyx/recording?lead=${lead}&sig=${signLead(lead)}&caller=Leonard&from=%2B4723509651`

  it('refuses unsigned callbacks', async () => {
    const res = await recording(req(`${BASE}/api/telnyx/recording?lead=4712345678&sig=nope`, form({})))
    expect(res.status).toBe(403)
  })

  it('rejects recording URLs outside Telnyx hosts/bucket (SSRF)', async () => {
    const res = await recording(req(signedUrl(), form({
      RecordingStatus: 'completed',
      RecordingSid: 'r1',
      RecordingUrl: 'https://s3.amazonaws.com/attacker-bucket/x.mp3',
    })))
    expect(res.status).toBe(400)
  })

  it('downloads within the 10-min window and stores BYTES in call_recordings', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'Content-Type': 'audio/mpeg' } }),
    ))
    // company match on the lead's number
    queryMock.mockImplementation(async (sql: unknown) => {
      const q = String(sql)
      if (q.includes('FROM companies')) return [{ id: 'c1', company_name: 'Notodden Bilpleiesenter AS' }]
      return []
    })
    const res = await recording(req(signedUrl(), form({
      RecordingStatus: 'completed',
      RecordingSid: 'r1',
      CallSid: 'call1',
      RecordingDuration: '42',
      RecordingUrl: S3_OK,
    })))
    expect(res.status).toBe(200)
    const insert = queryMock.mock.calls.find(c => String(c[0]).includes('INSERT INTO call_recordings'))
    expect(insert).toBeTruthy()
    const params = insert![1] as unknown as unknown[]
    expect(params[0]).toBe('c1') // matched company
    expect(params[2]).toBe('telnyx:r1') // idempotency key
    expect(Buffer.isBuffer(params[3])).toBe(true) // the AUDIO, not a dead URL
    expect(params[4]).toBe('audio/mpeg')
    expect(params[6]).toBe(42)
    expect(params[7]).toBe('Leonard')
  })

  it('a retried callback for a stored recording is acked without re-download', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    queryMock.mockImplementation(async (sql: unknown) =>
      String(sql).includes('SELECT id FROM call_recordings') ? [{ id: 'existing' }] : [],
    )
    const res = await recording(req(signedUrl(), form({
      RecordingStatus: 'completed',
      RecordingSid: 'r1',
      RecordingUrl: S3_OK,
    })))
    expect((await res.json()).duplicate).toBe(true)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('call route', () => {
  const post = (body: unknown) =>
    call(req(`${BASE}/api/telnyx/call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }))

  it('503 when the dialer is not configured', async () => {
    delete process.env.TELNYX_API_KEY
    expect((await post({ to: '4712345678', caller: 'Leonard' })).status).toBe(503)
  })

  it('refuses to call when the reserved list cannot be verified', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL) =>
      String(url).includes('api.telnyx.com')
        ? new Response(JSON.stringify({ data: [{ id: 'a', phone_number: '+4723509651' }] }), { status: 200 })
        : new Response('down', { status: 500 }),
    ))
    const res = await post({ to: '4712345678', caller: 'Leonard' })
    expect(res.status).toBe(502)
    expect((await res.json()).error).toContain('ringer ikke')
  })

  it('places the agent leg from the caller-resolved number with the signed TwiML url', async () => {
    const calls: { url: string; body?: string }[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL, init?: RequestInit) => {
      const u = String(url)
      calls.push({ url: u, body: init?.body as string | undefined })
      if (u.includes('/phone_numbers')) {
        return new Response(JSON.stringify({ data: [
          { id: 'a', phone_number: '+4723509651' },
          { id: 'b', phone_number: '+4723509652' },
        ] }), { status: 200 })
      }
      if (u.includes('/reserved-numbers')) {
        return new Response(JSON.stringify({ reserved: [] }), { status: 200 })
      }
      return new Response(JSON.stringify({ data: {} }), { status: 200 })
    }))
    queryMock.mockResolvedValue([{ caller_name: 'William' }]) // colleague active -> fixed number
    const res = await post({ to: '+47 12 34 56 78', caller: 'Leonard' })
    expect(res.status).toBe(200)
    expect((await res.json()).from).toBe('+4723509651')

    const texml = calls.find(c => c.url.includes('/texml/Accounts/acc/Calls'))
    expect(texml).toBeTruthy()
    const body = JSON.parse(texml!.body!)
    expect(body.From).toBe('+4723509651')
    expect(body.To).toBe('+4798361774')
    expect(body.ApplicationSid).toBe('app')
    expect(body.Url).toContain(`sig=${signLead('4712345678')}`)
  })

  it('rejects an explicit from-number that is not eligible (customer takeover guard)', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL) => {
      const u = String(url)
      if (u.includes('/phone_numbers')) {
        return new Response(JSON.stringify({ data: [
          { id: 'a', phone_number: '+4723509651' },
          { id: 'x', phone_number: '+4732994223' },
        ] }), { status: 200 })
      }
      return new Response(JSON.stringify({ reserved: ['4732994223'] }), { status: 200 })
    }))
    const res = await post({ to: '4712345678', from: '+4732994223' })
    expect(res.status).toBe(409)
  })
})
