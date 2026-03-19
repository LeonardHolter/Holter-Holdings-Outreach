import { NextRequest, NextResponse } from 'next/server'
import twilio from 'twilio'
import { createClient } from '@/lib/supabase/server'

const VoiceResponse = twilio.twiml.VoiceResponse

// Twilio posts here when one of our numbers receives an inbound call.
// We log it, then either forward to TWILIO_FORWARD_NUMBER or play a message.
export async function POST(request: NextRequest) {
  const form = await request.formData()

  const callSid = form.get('CallSid') as string | null
  const from    = form.get('From')    as string | null
  const to      = form.get('To')      as string | null
  const status  = form.get('CallStatus') as string | null

  if (from && to) {
    const supabase = await createClient()
    await supabase.from('incoming_calls').upsert(
      { twilio_sid: callSid, from_number: from, to_number: to, status: status ?? 'ringing' },
      { onConflict: 'twilio_sid', ignoreDuplicates: true }
    )
  }

  const twiml   = new VoiceResponse()
  const forward = process.env.TWILIO_FORWARD_NUMBER?.trim()

  if (forward) {
    // Forward the call to a physical phone number
    const dial = twiml.dial({ callerId: to ?? undefined })
    dial.number(forward)
  } else {
    // No forwarding configured — play a brief message and hang up
    twiml.say(
      { voice: 'Polly.Joanna', language: 'en-US' },
      "Thanks for calling. We're not available right now — please leave a message after the tone or call back later."
    )
    twiml.record({ maxLength: 120, playBeep: true })
    twiml.hangup()
  }

  return new NextResponse(twiml.toString(), {
    headers: { 'Content-Type': 'text/xml' },
  })
}
