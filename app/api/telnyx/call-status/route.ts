import { NextRequest, NextResponse } from 'next/server'
import { callStatus, telnyxDialerConfigured } from '@/lib/telnyxDial'

// Truth about a placed call. POST /api/telnyx/call returns as soon as Telnyx
// ACCEPTS the request — the call can still die two seconds later (carrier
// rejection, busy, no answer), and the first version reported those as
// success. The panel polls this to replace optimism with the real outcome.

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  if (telnyxDialerConfigured()) return NextResponse.json({ error: 'not_configured' }, { status: 503 })
  const sid = request.nextUrl.searchParams.get('sid')
  if (!sid) return NextResponse.json({ error: 'missing_sid' }, { status: 400 })
  try {
    return NextResponse.json(await callStatus(sid))
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'ukjent' }, { status: 502 })
  }
}
