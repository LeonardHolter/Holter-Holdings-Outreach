import { NextRequest, NextResponse } from 'next/server'
import twilio from 'twilio'
import { query } from '@/lib/db'

const VoiceResponse = twilio.twiml.VoiceResponse

export async function POST(request: NextRequest) {
  const form = await request.formData()

  const callSid = form.get('CallSid') as string | null
  const from = form.get('From') as string | null
  const to = form.get('To') as string | null
  const status = form.get('CallStatus') as string | null

  if (from && to) {
    
    await query(
      `INSERT INTO incoming_calls (twilio_sid, from_number, to_number, status)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (twilio_sid) DO NOTHING`,
      [callSid, from, to, status ?? 'ringing']
    )
  }

  const forwardNumbers = (process.env.TWILIO_FORWARD_NUMBER ?? '')
    .split(',').map(n => n.trim()).filter(Boolean)

  const twiml = new VoiceResponse()

  if (forwardNumbers.length > 0) {
    const phoneDial = twiml.dial({ timeout: 30, callerId: to ?? undefined })
    for (const num of forwardNumbers) {
      phoneDial.number(num)
    }
  }

  twiml.say(
    { voice: 'Polly.Joanna', language: 'en-US' },
    "Hi, thanks for calling. No one is available right now — please leave a message after the tone."
  )
  twiml.record({ maxLength: 120, playBeep: true })
  twiml.hangup()

  return new NextResponse(twiml.toString(), {
    headers: { 'Content-Type': 'text/xml' },
  })
}
