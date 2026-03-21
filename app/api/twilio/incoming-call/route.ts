import { NextRequest, NextResponse } from 'next/server'
import twilio from 'twilio'
import { createClient } from '@/lib/supabase/server'

const VoiceResponse = twilio.twiml.VoiceResponse

// Known agent browser-client identities (must match token identity format)
const AGENT_IDENTITIES = ['leonard', 'tommaso', 'john', 'sunzim', 'daniel', 'ellison']

// Twilio posts here when one of our numbers receives an inbound call.
//
// Strategy — Option B (browser first, phones as fallback):
//   1. Ring all browser clients for 15 s — first to click Accept wins
//   2. If nobody answered, ring all personal phones simultaneously for 30 s
//   3. Still no answer → voicemail
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

  // Personal fallback numbers (comma-separated in TWILIO_FORWARD_NUMBER)
  const forwardNumbers = (process.env.TWILIO_FORWARD_NUMBER ?? '')
    .split(',').map(n => n.trim()).filter(Boolean)

  const twiml = new VoiceResponse()

  // ── Step 1: ring browser clients (15 s) ──────────────────────────────────
  const browserDial = twiml.dial({ timeout: 15 })
  for (const identity of AGENT_IDENTITIES) {
    browserDial.client(identity)
  }

  // ── Step 2: ring personal phones (30 s) ──────────────────────────────────
  if (forwardNumbers.length > 0) {
    const phoneDial = twiml.dial({ timeout: 30, callerId: to ?? undefined })
    for (const num of forwardNumbers) {
      phoneDial.number(num)
    }
  }

  // ── Step 3: voicemail ─────────────────────────────────────────────────────
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
