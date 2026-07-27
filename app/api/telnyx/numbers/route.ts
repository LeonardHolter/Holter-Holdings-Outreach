import { NextResponse } from 'next/server'
import { eligibleFromNumbers, telnyxDialerConfigured } from '@/lib/telnyxDial'

// Numbers the dialer may cold-call FROM: the Telnyx account's numbers minus
// every number serving a KI Consult customer (fetched live, fail-closed).
// Session-gated by proxy.ts like the rest of the console.

export const dynamic = 'force-dynamic'

export async function GET() {
  const missing = telnyxDialerConfigured()
  if (missing) return NextResponse.json({ configured: false, reason: missing, numbers: [] })

  try {
    const numbers = await eligibleFromNumbers()
    return NextResponse.json({ configured: true, numbers })
  } catch (e) {
    // Fail closed, loudly: no reserved list -> no eligible numbers.
    return NextResponse.json(
      { configured: true, numbers: [], error: e instanceof Error ? e.message : 'ukjent feil' },
      { status: 502 },
    )
  }
}
