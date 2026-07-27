import { NextRequest, NextResponse } from 'next/server'
import { normalizeDigits, verifyLeadSignature } from '@/lib/telnyxDial'

// TeXML for the second leg: when the agent answers, dial the lead with the
// same caller ID. PUBLIC path (Telnyx fetches it server-to-server, no
// session cookie) — authenticated instead by the HMAC signature our own
// /api/telnyx/call put in the URL, so it only ever dials leads we asked
// it to. An unsigned request gets an empty hangup, not a dial tone.

export const dynamic = 'force-dynamic'

const xml = (body: string) =>
  new NextResponse(`<?xml version="1.0" encoding="UTF-8"?>\n${body}`, {
    status: 200,
    headers: { 'Content-Type': 'application/xml' },
  })

export async function POST(request: NextRequest) {
  return respond(request)
}

export async function GET(request: NextRequest) {
  return respond(request)
}

function respond(request: NextRequest) {
  const lead = normalizeDigits(request.nextUrl.searchParams.get('lead') ?? '')
  const sig = request.nextUrl.searchParams.get('sig') ?? ''
  if (!process.env.OUTREACH_SHARED_SECRET || lead.length < 8 || !verifyLeadSignature(lead, sig)) {
    return xml('<Response><Hangup/></Response>')
  }
  return xml(`<Response><Dial>+${lead}</Dial></Response>`)
}
