import { NextRequest, NextResponse } from 'next/server'
import {
  eligibleFromNumbers,
  normalizeDigits,
  startClickToCall,
  telnyxDialerConfigured,
} from '@/lib/telnyxDial'

// Click-to-call: rings the agent's phone from the chosen Telnyx number,
// then bridges to the lead. The from-number is re-validated against the
// eligible list AT CALL TIME — the dropdown was rendered earlier, and a
// number can have been assigned to a customer in between.

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const missing = telnyxDialerConfigured()
  if (missing) return NextResponse.json({ error: missing }, { status: 503 })

  const body = await request.json().catch(() => null)
  const from = typeof body?.from === 'string' ? body.from.trim() : ''
  const to = typeof body?.to === 'string' ? normalizeDigits(body.to) : ''
  if (!from || to.length < 8) {
    return NextResponse.json({ error: 'Ugyldig from/to.' }, { status: 400 })
  }

  let eligible
  try {
    eligible = await eligibleFromNumbers()
  } catch (e) {
    return NextResponse.json(
      { error: `Får ikke verifisert at nummeret er ledig - ringer ikke. (${e instanceof Error ? e.message : e})` },
      { status: 502 },
    )
  }
  const chosen = eligible.find(n => n.digits === normalizeDigits(from))
  if (!chosen) {
    return NextResponse.json(
      { error: 'Nummeret er ikke tilgjengelig for outreach (kan være tatt i bruk av en kunde).' },
      { status: 409 },
    )
  }

  try {
    const origin = request.nextUrl.origin
    await startClickToCall(chosen.phoneNumber, to, origin)
    return NextResponse.json({ ok: true, from: chosen.phoneNumber })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Telnyx-kall feilet' },
      { status: 502 },
    )
  }
}
