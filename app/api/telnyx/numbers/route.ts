import { NextRequest, NextResponse } from 'next/server'
import { eligibleFromNumbers, numberForCaller, telnyxDialerConfigured } from '@/lib/telnyxDial'

// Numbers the dialer may cold-call FROM: the Telnyx account's numbers minus
// every number serving a KI Consult customer (fetched live, fail-closed).
// Session-gated by proxy.ts like the rest of the console.

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const missing = telnyxDialerConfigured()
  if (missing) return NextResponse.json({ configured: false, reason: missing, numbers: [] })

  try {
    const numbers = await eligibleFromNumbers()
    // ?caller=Leonard -> which number is THEIRS (fixed per caller, so the
    // same person always presents the same caller ID).
    const caller = request.nextUrl.searchParams.get('caller')
    const mine = caller ? numberForCaller(caller, numbers) : null
    return NextResponse.json({ configured: true, numbers, mine })
  } catch (e) {
    // Fail closed, loudly: no reserved list -> no eligible numbers.
    return NextResponse.json(
      { configured: true, numbers: [], error: e instanceof Error ? e.message : 'ukjent feil' },
      { status: 502 },
    )
  }
}
