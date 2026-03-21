import { NextRequest, NextResponse } from 'next/server'
import twilio from 'twilio'
import { createClient } from '@/lib/supabase/server'

const VoiceResponse = twilio.twiml.VoiceResponse

// Known agent identities — must match what /api/twilio/token generates
// (callerName.replace(/\s+/g, '-').toLowerCase())
const AGENT_IDENTITIES = ['leonard', 'tommaso', 'john', 'sunzim', 'daniel', 'ellison']

// Twilio posts here when one of our numbers receives an inbound call.
// Simultaneously rings ALL registered browser clients — first to answer gets the call.
// Falls back to a voicemail message if nobody picks up within the timeout.
export async function POST(request: NextRequest) {
  const form = await request.formData()

  const callSid = form.get('CallSid')    as string | null
  const from    = form.get('From')       as string | null
  const to      = form.get('To')         as string | null
  const status  = form.get('CallStatus') as string | null

  if (from && to) {
    const supabase = await createClient()
    await supabase.from('incoming_calls').upsert(
      { twilio_sid: callSid, from_number: from, to_number: to, status: status ?? 'ringing' },
      { onConflict: 'twilio_sid', ignoreDuplicates: true }
    )
  }

  const twiml = new VoiceResponse()

  // Ring all browser clients simultaneously (30 s timeout).
  // Twilio connects the call to whichever agent answers first.
  const dial = twiml.dial({ timeout: 30 })
  for (const identity of AGENT_IDENTITIES) {
    dial.client(identity)
  }

  // If nobody answers, play a voicemail prompt
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
