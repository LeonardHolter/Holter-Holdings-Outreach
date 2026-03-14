import { NextRequest, NextResponse } from 'next/server'
import twilio from 'twilio'

const { AccessToken } = twilio.jwt
const { VoiceGrant } = AccessToken

// Assign each caller their own dedicated number (round-robin by index)
function getCallerId(callerName: string): string {
  const numbers = (process.env.TWILIO_PHONE_NUMBERS ?? '').split(',').map(n => n.trim()).filter(Boolean)
  if (numbers.length === 0) throw new Error('TWILIO_PHONE_NUMBERS is not set')

  const callers = ['Leonard', 'Tommaso', 'John', 'Sunzim', 'Daniel', 'Ellison']
  const idx = callers.findIndex(c => c.toLowerCase() === callerName.toLowerCase())
  return numbers[idx >= 0 ? idx % numbers.length : 0]
}

export async function POST(request: NextRequest) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID
  const apiKey    = process.env.TWILIO_API_KEY
  const apiSecret = process.env.TWILIO_API_SECRET
  const twimlAppSid = process.env.TWILIO_TWIML_APP_SID

  if (!accountSid || !apiKey || !apiSecret || !twimlAppSid) {
    return NextResponse.json({ error: 'Twilio env vars missing' }, { status: 500 })
  }

  const { callerName } = await request.json()
  const identity = (callerName ?? 'user').replace(/\s+/g, '-').toLowerCase()

  let callerId: string
  try {
    callerId = getCallerId(callerName ?? '')
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }

  const grant = new VoiceGrant({
    outgoingApplicationSid: twimlAppSid,
    incomingAllow: false,
  })

  const token = new AccessToken(accountSid, apiKey, apiSecret, {
    identity,
    ttl: 3600,
  })
  token.addGrant(grant)

  return NextResponse.json({ token: token.toJwt(), callerId, identity })
}
