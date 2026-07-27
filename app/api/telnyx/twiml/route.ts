import { NextRequest, NextResponse } from 'next/server'
import { normalizeDigits, verifyLeadSignature } from '@/lib/telnyxDial'

// TeXML for two situations, told apart by the HMAC signature:
//
//  SIGNED (minted by our /api/telnyx/call): second leg of click-to-call —
//  the agent answered, dial the lead. Recorded from answer (dual channel),
//  and Telnyx posts the finished recording to /api/telnyx/recording with
//  the caller metadata carried through the query string.
//
//  UNSIGNED: an INBOUND call to an outreach number (this route is the
//  outreach TeXML app's voice_url) — i.e. a lead calling back. Forward it
//  to the agent's own phone instead of hanging up on a warm lead.
//
// PUBLIC path (Telnyx fetches it cookie-less). The signature is what stops
// strangers from using us to dial arbitrary numbers; the unsigned branch
// only ever dials OUR OWN configured phone, so there is nothing to steal.

export const dynamic = 'force-dynamic'

const xml = (body: string) =>
  new NextResponse(`<?xml version="1.0" encoding="UTF-8"?>\n${body}`, {
    status: 200,
    headers: { 'Content-Type': 'application/xml' },
  })

/** XML attribute escaping — the callback URL carries '&'. */
const attr = (v: string) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;')

export async function POST(request: NextRequest) {
  return respond(request)
}

export async function GET(request: NextRequest) {
  return respond(request)
}

function respond(request: NextRequest) {
  const q = request.nextUrl.searchParams
  const lead = normalizeDigits(q.get('lead') ?? '')
  const sig = q.get('sig') ?? ''
  if (process.env.APP_PASSWORD && lead.length >= 8 && verifyLeadSignature(lead, sig)) {
    const meta = `lead=${lead}&sig=${sig}&caller=${encodeURIComponent(q.get('caller') ?? '')}&from=${encodeURIComponent(q.get('from') ?? '')}`
    const cb = `${request.nextUrl.origin}/api/telnyx/recording?${meta}`
    return xml(
      `<Response><Dial record="record-from-answer" recordingChannels="dual" recordingStatusCallback="${attr(cb)}" recordingStatusCallbackMethod="POST">+${lead}</Dial></Response>`,
    )
  }
  // Lead calling back -> ring the agent. Never a caller-chosen number.
  const agent = normalizeDigits(process.env.OUTREACH_AGENT_PHONE ?? '')
  if (agent.length >= 8) {
    return xml(`<Response><Dial>+${agent}</Dial></Response>`)
  }
  return xml('<Response><Hangup/></Response>')
}
