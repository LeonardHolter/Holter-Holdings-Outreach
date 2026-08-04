import { NextRequest, NextResponse } from 'next/server'
import {
  eligibleFromNumbers,
  normalizeDigits,
  pickFromPool,
  poolForCaller,
  startClickToCall,
  telnyxDialerConfigured,
} from '@/lib/telnyxDial'
import { query } from '@/lib/db'
import { CALL_CUTOFF_HOUR, isCallingClosed } from '@/lib/callingHours'

/** Callers with a fresh heartbeat (same 90s staleness the claim system
 *  uses) — decides whether the caller is alone and gets the whole pool. */
async function activeCallers(): Promise<string[]> {
  const rows = await query(
    `SELECT DISTINCT caller_name FROM company_claims
     WHERE claimed_at > NOW() - INTERVAL '90 seconds'`,
  )
  return rows.map(r => String(r.caller_name))
}

// Click-to-call: rings the agent's phone from the chosen Telnyx number,
// then bridges to the lead. The from-number is re-validated against the
// eligible list AT CALL TIME — the dropdown was rendered earlier, and a
// number can have been assigned to a customer in between.

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const missing = telnyxDialerConfigured()
  if (missing) return NextResponse.json({ error: missing }, { status: 503 })

  // The UI gate on /call hides the dialer after hours; this is the backstop
  // for stale tabs and direct API calls.
  if (isCallingClosed()) {
    return NextResponse.json(
      { error: `Ringetiden er over — ingen samtaler etter kl. ${CALL_CUTOFF_HOUR}:00 (Oslo-tid).` },
      { status: 403 },
    )
  }

  const body = await request.json().catch(() => null)
  const from = typeof body?.from === 'string' ? body.from.trim() : ''
  const caller = typeof body?.caller === 'string' ? body.caller.trim() : ''
  const to = typeof body?.to === 'string' ? normalizeDigits(body.to) : ''
  if ((!from && !caller) || to.length < 8) {
    return NextResponse.json({ error: 'Ugyldig from/caller/to.' }, { status: 400 })
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
  // Explicit from (manual panel), or rotate within the caller's pool —
  // their own fixed number when a colleague is active, every number when
  // they're alone on shift.
  const chosen = from
    ? eligible.find(n => n.digits === normalizeDigits(from))
    : pickFromPool(poolForCaller(caller, eligible, await activeCallers()))
  if (!chosen) {
    return NextResponse.json(
      { error: 'Ingen tilgjengelige outreach-numre (kundenumre er utelukket).' },
      { status: 409 },
    )
  }

  try {
    const origin = request.nextUrl.origin
    const placed = await startClickToCall(chosen.phoneNumber, to, origin, caller || undefined)
    // sid lets the UI poll for the REAL outcome — Telnyx accepting the
    // request is not the same as the phone ringing.
    return NextResponse.json({ ok: true, from: chosen.phoneNumber, sid: placed.sid })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Telnyx-kall feilet' },
      { status: 502 },
    )
  }
}
