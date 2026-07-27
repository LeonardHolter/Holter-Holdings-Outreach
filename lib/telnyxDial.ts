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
  return data
}
