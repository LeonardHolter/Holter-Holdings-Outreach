import crypto from 'crypto'

// Telnyx click-to-call for the sales console. Two legs over TeXML REST:
// we call the AGENT's phone first (From = the chosen Telnyx number), and
// when the agent answers, the TwiML at /api/telnyx/twiml dials the lead
// with the same caller ID. No WebRTC SDK, no new connection types.
//
// GUARDRAIL — the reason this file exists at all: the same Telnyx account
// hosts numbers that belong to KI Consult CUSTOMERS (their AI receptionist
// lines). Cold calls must never go out from one of those. The reserved
// list is fetched live from KI Consult's /api/telephony/reserved-numbers
// (same map that routes their inbound calls), and this module FAILS
// CLOSED: if that fetch fails, no number is eligible and no call is
// placed. Guessing "probably free" is how a customer's business number
// ends up cold-calling strangers.

const TELNYX = 'https://api.telnyx.com/v2'

export type FromNumber = { id: string; phoneNumber: string; digits: string }

export function telnyxDialerConfigured(): string | null {
  const missing = [
    'TELNYX_API_KEY',
    'TELNYX_TEXML_ACCOUNT_SID',
    'TELNYX_TEXML_APP_SID',
    'OUTREACH_AGENT_PHONE',
    'APP_PASSWORD', // doubles as the TwiML HMAC key - no extra secret to manage
  ].filter(k => !process.env[k])
  return missing.length ? `Mangler env: ${missing.join(', ')}` : null
}

export const normalizeDigits = (raw: string) => raw.replace(/\D/g, '')

// Same caller roster as the Twilio token route. Each caller OWNS a number
// (sorted eligible list indexed by roster position) so the same person
// always shows the same caller ID — leads recognize the number on the
// second attempt, and missed-call returns land with the right person.
export const CALLERS = ['Leonard', 'William']

export function numberForCaller(caller: string, eligible: FromNumber[]): FromNumber | null {
  if (eligible.length === 0) return null
  const sorted = [...eligible].sort((a, b) => a.digits.localeCompare(b.digits))
  const idx = CALLERS.findIndex(c => c.toLowerCase() === caller.trim().toLowerCase())
  return sorted[(idx >= 0 ? idx : 0) % sorted.length]
}

/** The numbers a caller may dial from RIGHT NOW. With a colleague active
 *  (fresh company_claims heartbeat), everyone keeps their own fixed number.
 *  Alone on shift, the whole pool is yours, rotated per call — twice the
 *  sustainable volume per number's reputation (carriers spam-flag numbers
 *  that dial too much too fast), and no line sits idle. */
export function poolForCaller(
  caller: string,
  eligible: FromNumber[],
  activeCallers: string[],
): FromNumber[] {
  if (eligible.length === 0) return []
  const me = caller.trim().toLowerCase()
  const othersActive = activeCallers.some(
    a => a.trim().toLowerCase() !== me && CALLERS.some(c => c.toLowerCase() === a.trim().toLowerCase()),
  )
  if (othersActive) {
    const mine = numberForCaller(caller, eligible)
    return mine ? [mine] : []
  }
  return [...eligible].sort((a, b) => a.digits.localeCompare(b.digits))
}

/** Per-call rotation within the pool. Random rather than stateful: the
 *  functions run serverless with no shared memory, and over any real call
 *  volume random splits ~evenly — which is all number hygiene needs. */
export function pickFromPool(pool: FromNumber[]): FromNumber | null {
  if (pool.length === 0) return null
  return pool[Math.floor(Math.random() * pool.length)]
}

async function telnyx(method: string, path: string, body?: Record<string, string>) {
  const res = await fetch(`${TELNYX}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.TELNYX_API_KEY}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`Telnyx ${res.status}: ${(await res.text()).slice(0, 200)}`)
  return res.json()
}

async function fetchReservedDigits(): Promise<Set<string>> {
  // Public endpoint (digits of published business numbers only); the
  // protection is on OUR side - any failure here means nothing is eligible.
  const url =
    process.env.KICONSULT_RESERVED_URL ??
    'https://www.kiconsult.no/api/telephony/reserved-numbers'
  const res = await fetch(url, {
    cache: 'no-store',
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) throw new Error(`reserved-numbers svarte ${res.status}`)
  const body = (await res.json()) as { reserved?: string[] }
  if (!Array.isArray(body.reserved)) throw new Error('reserved-numbers: uventet svar')
  return new Set(body.reserved.map(normalizeDigits))
}

/** Telnyx numbers on the account that are NOT serving a KI Consult
 *  customer. Throws (rather than returning everything) when the reserved
 *  list can't be fetched — fail closed. */
export async function eligibleFromNumbers(): Promise<FromNumber[]> {
  const [numbers, reserved] = await Promise.all([
    telnyx('GET', '/phone_numbers?page[size]=100'),
    fetchReservedDigits(),
  ])
  const rows = (numbers.data ?? []) as { id: string; phone_number: string }[]
  return rows
    .map(n => ({ id: n.id, phoneNumber: n.phone_number, digits: normalizeDigits(n.phone_number) }))
    .filter(n => !reserved.has(n.digits))
}

/** HMAC over the lead number so the public TwiML endpoint only dials leads
 *  WE asked it to — Telnyx fetches it without a session cookie. Keyed on
 *  APP_PASSWORD (already required for login) so no second secret exists. */
export function signLead(leadDigits: string): string {
  return crypto
    .createHmac('sha256', process.env.APP_PASSWORD!)
    .update(leadDigits)
    .digest('hex')
    .slice(0, 32)
}

export function verifyLeadSignature(leadDigits: string, sig: string): boolean {
  const expected = signLead(leadDigits)
  return (
    sig.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
  )
}

/** Human explanation for the failure modes that actually happen, so the
 *  console says WHY instead of leaving a silent dead call. 603 is the one
 *  that bit us first: Norwegian operators reject calls that carry a
 *  Norwegian caller ID but arrive over an international route (Telnyx),
 *  which is a carrier/regulatory block, not something our code can retry. */
export function explainCall(status: string, sipCause?: string | null): string | null {
  if (['queued', 'initiated', 'ringing', 'in-progress', 'completed'].includes(status)) return null
  if (sipCause === '603' || status === 'busy') {
    return 'Avvist av mottakers operatør (SIP 603). Norske operatører blokkerer samtaler med norsk avsendernummer som kommer via utenlandsk rute - se notatet om Telnyx og norsk CLI.'
  }
  if (status === 'no-answer') return 'Ingen svarte.'
  if (status === 'failed') return `Samtalen feilet${sipCause ? ` (SIP ${sipCause})` : ''}.`
  if (status === 'canceled') return 'Samtalen ble avbrutt.'
  return `Uventet status: ${status}${sipCause ? ` (SIP ${sipCause})` : ''}.`
}

export type CallStatus = {
  sid: string
  status: string
  sipCause: string | null
  problem: string | null
}

/** Reads back a placed call. TeXML call resources live under the account. */
export async function callStatus(sid: string): Promise<CallStatus> {
  const data = await telnyx(
    'GET',
    `/texml/Accounts/${encodeURIComponent(process.env.TELNYX_TEXML_ACCOUNT_SID!)}/Calls/${encodeURIComponent(sid)}.json`,
  )
  const status = String(data.status ?? 'unknown')
  const sipCause = data.sip_hangup_cause ? String(data.sip_hangup_cause) : null
  return { sid, status, sipCause, problem: explainCall(status, sipCause) }
}

/** Places the agent leg: rings OUTREACH_AGENT_PHONE from the chosen number;
 *  on answer, TeXML at `twimlUrl` dials the lead — recorded, with caller
 *  metadata threaded through to the recording callback. Endpoint shape
 *  verified against Telnyx docs: POST /texml/Accounts/{account_sid}/Calls
 *  with To/From/ApplicationSid(+Url). */
export async function startClickToCall(
  fromE164: string,
  leadDigits: string,
  origin: string,
  caller?: string,
) {
  const sig = signLead(leadDigits)
  const meta = `lead=${leadDigits}&sig=${sig}&caller=${encodeURIComponent(caller ?? '')}&from=${encodeURIComponent(fromE164)}`
  const twimlUrl = `${origin}/api/telnyx/twiml?${meta}`
  const data = await telnyx(
    'POST',
    `/texml/Accounts/${encodeURIComponent(process.env.TELNYX_TEXML_ACCOUNT_SID!)}/Calls`,
    {
      From: fromE164,
      To: process.env.OUTREACH_AGENT_PHONE!,
      ApplicationSid: process.env.TELNYX_TEXML_APP_SID!,
      Url: twimlUrl,
    },
  )
  return { sid: String(data.sid ?? data.call_sid ?? ''), raw: data }
}
