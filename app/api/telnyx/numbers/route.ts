import { NextRequest, NextResponse } from 'next/server'
import { eligibleFromNumbers, numberForCaller, poolForCaller, telnyxDialerConfigured } from '@/lib/telnyxDial'
import { query } from '@/lib/db'

// Numbers the dialer may cold-call FROM: the Telnyx account's numbers minus
// every number serving a KI Consult customer (fetched live, fail-closed).
// Session-gated by proxy.ts like the rest of the console.

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const missing = telnyxDialerConfigured()
  if (missing) return NextResponse.json({ configured: false, reason: missing, numbers: [] })

  try {
    const numbers = await eligibleFromNumbers()
    // ?caller=Leonard -> which number is THEIRS (fixed per caller), plus
    // how many they may rotate across right now (the whole pool when the
    // other caller is offline).
    const caller = request.nextUrl.searchParams.get('caller')
    let mine = null
    let poolSize = 0
    if (caller) {
      const rows = await query(
        `SELECT DISTINCT caller_name FROM company_claims
         WHERE claimed_at > NOW() - INTERVAL '90 seconds'`,
      )
      const pool = poolForCaller(caller, numbers, rows.map(r => String(r.caller_name)))
      mine = numberForCaller(caller, numbers)
      poolSize = pool.length
    }
    return NextResponse.json({ configured: true, numbers, mine, poolSize })
  } catch (e) {
    // Fail closed, loudly: no reserved list -> no eligible numbers.
    return NextResponse.json(
      { configured: true, numbers: [], error: e instanceof Error ? e.message : 'ukjent feil' },
      { status: 502 },
    )
  }
}
