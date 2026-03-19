import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Twilio posts here when an SMS is received on one of our numbers.
// We log it to incoming_messages and return an empty TwiML response.
export async function POST(request: NextRequest) {
  const form = await request.formData()

  const messageSid  = form.get('MessageSid')  as string | null
  const from        = form.get('From')         as string | null
  const to          = form.get('To')           as string | null
  const body        = form.get('Body')         as string | null

  if (from && to) {
    const supabase = await createClient()
    await supabase.from('incoming_messages').upsert(
      {
        twilio_sid:   messageSid,
        from_number:  from,
        to_number:    to,
        body:         body ?? '',
        direction:    'inbound',
        status:       'received',
      },
      { onConflict: 'twilio_sid', ignoreDuplicates: true }
    )
  }

  // Empty TwiML — no auto-reply
  return new NextResponse('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
    headers: { 'Content-Type': 'text/xml' },
  })
}
